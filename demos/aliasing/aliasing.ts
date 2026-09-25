/**
 * Sampling a sinusoid and subsampling an image.
 *
 *  - The 1D signal is x(t) = cos(2πft + φ), sampled at rate f_s: x[n] = x(n / f_s).
 *  - Sampling makes the spectrum periodic: the lines at ±f repeat at every multiple of f_s. The alias is the copy that
 *    lands in [0, f_s/2]; a copy that comes from −f also flips the sign of the phase.
 *  - Image frequencies are in cycles per pixel; subsampling by k keeps every k-th pixel in x and y.
 */

import { type Plane, createPlane } from '../../src/shared/image';

export const nyquist = (fs: number) => fs / 2;

export const signal = (f: number, phase: number) => (t: number) => Math.cos(2 * Math.PI * f * t + phase);

export interface Alias {
  f: number;
  phase: number;
  /** Index k of the replica k·f_s ± f that lands in [0, f_s/2]. */
  k: number;
  /** True if the alias comes from the mirrored line k·f_s − f. */
  folded: boolean;
}

/** The frequency and phase that the samples of cos(2πft + φ) at rate f_s appear to have. */
export function alias(f: number, fs: number, phase: number): Alias {
  const k = Math.round(f / fs);
  const d = f - k * fs;
  return d >= 0 ? { f: d, phase, k, folded: false } : { f: -d, phase: -phase, k, folded: true };
}

/** Sample times n / f_s in [0, duration]. */
export function sampleTimes(fs: number, duration: number): number[] {
  return Array.from({ length: Math.floor(duration * fs + 1e-9) + 1 }, (_, n) => n / fs);
}

/** All spectral lines k·f_s ± f of the sampled signal within [−maxF, maxF]. */
export function replicas(f: number, fs: number, maxF: number): number[] {
  const out: number[] = [];
  const kMax = Math.ceil((maxF + f) / fs);
  for (let k = -kMax; k <= kMax; k++)
    for (const s of [f, -f]) {
      const x = k * fs + s;
      if (Math.abs(x) <= maxF + 1e-9 && !out.some((o) => Math.abs(o - x) < 1e-9)) out.push(x);
    }
  return out.sort((a, b) => a - b);
}

/** Every k-th pixel in x and y, starting at the first. */
export function subsample(p: Plane, k: number): Plane {
  const out = createPlane(Math.ceil(p.width / k), Math.ceil(p.height / k));
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.data[y * out.width + x] = p.data[y * k * p.width + x * k];
  return out;
}

/** Repeats every pixel k × k times and crops to width × height, so the result lines up with the original. */
export function enlarge(p: Plane, k: number, width: number, height: number): Plane {
  const out = createPlane(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) out.data[y * width + x] = p.data[Math.floor(y / k) * p.width + Math.floor(x / k)];
  return out;
}

/** Frequency response of a Gaussian with standard deviation σ (px) at f cycles/px: the Gaussian e^{−2π²σ²f²}. */
export const gaussianResponse = (sigma: number, f: number) => Math.exp(-2 * Math.PI ** 2 * sigma ** 2 * f ** 2);
