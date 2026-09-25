/**
 * Splitting spectra into magnitude and phase, F = |F| · e^{iφ}, and recombining them.
 *
 * Conventions (see src/shared/fft.ts):
 *  - Spectra, magnitudes and phases use the DFT layout (DC at index 0).
 *  - The spectrum of a real image is conjugate symmetric: |F| is even and φ is odd in (u, v). Every combination below
 *    keeps both properties, so the inverse transforms are real images again.
 */

import { type Spectrum, centeredFreq, fft2 } from '../../src/shared/fft';
import { type Plane, createPlane } from '../../src/shared/image';

export const magnitude = (S: Spectrum): Float64Array => S.re.map((re, i) => Math.hypot(re, S.im[i]));

export const phase = (S: Spectrum): Float64Array => S.re.map((re, i) => Math.atan2(S.im[i], re));

/** The spectrum |F| · e^{iφ} = |F| cos φ + i |F| sin φ. */
export function fromPolar(width: number, height: number, mag: Float64Array, phi: Float64Array): Spectrum {
  return { width, height, re: mag.map((m, i) => m * Math.cos(phi[i])), im: mag.map((m, i) => m * Math.sin(phi[i])) };
}

/** Deterministic pseudo-random numbers in [0, 1), so the same seed gives the same phase. */
function random(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Random phases that are odd in (u, v), taken from the spectrum of white noise. */
export function randomPhase(width: number, height: number, seed: number): Float64Array {
  const rand = random(seed);
  const noise = createPlane(width, height);
  for (let i = 0; i < noise.data.length; i++) noise.data[i] = rand();
  return phase(fft2(noise));
}

/**
 * Every magnitude replaced by the mean over its ring D = round(√(u² + v²)): the average magnitude per frequency,
 * without any preferred direction.
 */
export function radialAverage(mag: Float64Array, width: number, height: number): Float64Array {
  const ring = new Int32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) ring[y * width + x] = Math.round(Math.hypot(centeredFreq(x, width), centeredFreq(y, height)));
  const rings = ring.reduce((m, r) => Math.max(m, r), 0) + 1;
  const sum = new Float64Array(rings);
  const count = new Float64Array(rings);
  ring.forEach((r, i) => {
    sum[r] += mag[i];
    count[r]++;
  });
  return mag.map((_, i) => sum[ring[i]] / count[ring[i]]);
}

/** Pearson correlation coefficient: 1 for the same image up to brightness and contrast, 0 for unrelated images. */
export function correlation(a: Plane, b: Plane): number {
  const n = a.data.length;
  const meanA = a.data.reduce((s, v) => s + v, 0) / n;
  const meanB = b.data.reduce((s, v) => s + v, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const da = a.data[i] - meanA;
    const db = b.data[i] - meanB;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** Maps the range between the `clip` and 1 − `clip` quantiles linearly to [0, 1], for images without a natural range. */
export function stretch(p: Plane, clip = 0.005): Plane {
  const sorted = Float32Array.from(p.data).sort();
  const lo = sorted[Math.floor(clip * (sorted.length - 1))];
  const hi = sorted[Math.ceil((1 - clip) * (sorted.length - 1))];
  const scale = hi > lo ? 1 / (hi - lo) : 0;
  return { ...p, data: p.data.map((v) => Math.min(1, Math.max(0, (v - lo) * scale))) };
}
