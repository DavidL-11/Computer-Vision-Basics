/**
 * Looking at and filtering the 2D spectrum of a square N × N image.
 *
 * Conventions (see src/shared/fft.ts):
 *  - Frequencies (u, v) are signed, in cycles per image width/height, u to the right and v down.
 *  - Spectra and transfer functions H(u, v) use the DFT layout (DC at index 0); fftShift() centers them for display.
 *  - Filtering multiplies the spectrum by a real transfer function: G(u, v) = F(u, v) · H(u, v).
 *    A real H with H(u, v) = H(−u, −v) keeps the filtered image real.
 */

import { type Spectrum, centeredFreq, fft2, fftShift, freqIndex } from '../../src/shared/fft';
import { type Plane, createPlane } from '../../src/shared/image';

export type RadialKind = 'low-pass' | 'high-pass' | 'band-pass';
export type Profile = 'ideal' | 'gaussian';

/** The w × h region in the middle of p. */
export function centerCrop(p: Plane, w: number, h: number): Plane {
  const out = createPlane(w, h);
  const x0 = Math.floor((p.width - w) / 2);
  const y0 = Math.floor((p.height - h) / 2);
  for (let y = 0; y < h; y++) out.data.set(p.data.subarray((y0 + y) * p.width + x0, (y0 + y) * p.width + x0 + w), y * w);
  return out;
}

/**
 * log(1 + |F|) scaled to [0, 1] and centered; the logarithm makes the weak high frequencies visible. The scale ignores
 * the DC term, which is far larger than everything else and is clipped to 1.
 */
export function logMagnitude(S: Spectrum): Plane {
  const out = createPlane(S.width, S.height);
  let max = 0;
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = Math.log1p(Math.hypot(S.re[i], S.im[i]));
    if (i > 0) max = Math.max(max, out.data[i]);
  }
  if (max > 0) for (let i = 0; i < out.data.length; i++) out.data[i] = Math.min(1, out.data[i] / max);
  return fftShift(out);
}

/** The phase φ ∈ (−π, π] mapped to [0, 1], centered. */
export function phaseImage(S: Spectrum): Plane {
  const out = createPlane(S.width, S.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = (Math.atan2(S.im[i], S.re[i]) + Math.PI) / (2 * Math.PI);
  return fftShift(out);
}

/** The basis function cos(2π(ux + vy)/N) of frequency (u, v), mapped to [0, 1]. */
export function basisImage(u: number, v: number, n: number): Plane {
  const out = createPlane(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.data[y * n + x] = 0.5 + 0.5 * Math.cos((2 * Math.PI * (u * x + v * y)) / n);
  return out;
}

export interface Component {
  re: number;
  im: number;
  magnitude: number;
  phase: number;
  /**
   * Amplitude A of the cosine A·cos(2π(ux + vy)/N + φ) that F(u, v) and F(−u, −v) contribute to the image together:
   * 2|F|/N², or |F|/N² where (u, v) and (−u, −v) are the same coefficient (DC and Nyquist).
   */
  amplitude: number;
}

export function component(S: Spectrum, u: number, v: number): Component {
  const { width: M, height: N } = S;
  const i = freqIndex(v, N) * M + freqIndex(u, M);
  const re = S.re[i];
  const im = S.im[i];
  const magnitude = Math.hypot(re, im);
  const selfConjugate = freqIndex(u, M) === freqIndex(-u, M) && freqIndex(v, N) === freqIndex(-v, N);
  return { re, im, magnitude, phase: Math.atan2(im, re), amplitude: ((selfConjugate ? 1 : 2) * magnitude) / (M * N) };
}

/** p + a·cos(2π(ux + vy)/N): a stripe pattern, i.e. a pair of peaks at ±(u, v) in the spectrum. */
export function addPeriodicNoise(p: Plane, u: number, v: number, amplitude: number): Plane {
  const out = createPlane(p.width, p.height);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      out.data[y * p.width + x] = p.data[y * p.width + x] + amplitude * Math.cos(2 * Math.PI * ((u * x) / p.width + (v * y) / p.height));
  return out;
}

/** H as a function of the distance D = √(u² + v²) from DC, with radii D₀ and, for band-pass, D₁. */
export function radialFilter(n: number, kind: RadialKind, profile: Profile, d0: number, d1: number): Plane {
  const lowPass = (d: number, r: number) => (profile === 'ideal' ? (d <= r ? 1 : 0) : Math.exp(-(d * d) / (2 * r * r)));
  const inner = Math.min(d0, d1);
  const outer = Math.max(d0, d1);
  const H = createPlane(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(centeredFreq(x, n), centeredFreq(y, n));
      H.data[y * n + x] =
        kind === 'low-pass' ? lowPass(d, d0) : kind === 'high-pass' ? 1 - lowPass(d, d0) : lowPass(d, outer) - lowPass(d, inner);
    }
  return H;
}

export const allPass = (n: number): Plane => ({ width: n, height: n, data: new Float32Array(n * n).fill(1) });

/** Sets H to `value` on a disc around (u, v) and on the mirrored disc around (−u, −v), in place. */
export function paintDisc(H: Plane, u: number, v: number, radius: number, value: number): void {
  const r = Math.floor(radius);
  for (let dv = -r; dv <= r; dv++)
    for (let du = -r; du <= r; du++) {
      if (du * du + dv * dv > radius * radius) continue;
      H.data[freqIndex(v + dv, H.height) * H.width + freqIndex(u + du, H.width)] = value;
      H.data[freqIndex(-v - dv, H.height) * H.width + freqIndex(-u - du, H.width)] = value;
    }
}

/**
 * Transfer function of a spatial filter kernel: the kernel placed with its center at the origin, wrapped around the
 * borders, and transformed. For kernels with h[k, l] = h[−k, −l] the result is real, so only the real part is kept.
 */
export function kernelTransfer(kernel: Plane, n: number): Plane {
  const padded = createPlane(n, n);
  const rx = (kernel.width - 1) / 2;
  const ry = (kernel.height - 1) / 2;
  for (let l = 0; l < kernel.height; l++)
    for (let k = 0; k < kernel.width; k++) padded.data[freqIndex(l - ry, n) * n + freqIndex(k - rx, n)] = kernel.data[l * kernel.width + k];
  const S = fft2(padded);
  return { width: n, height: n, data: Float32Array.from(S.re) };
}

/** G = F · H. */
export function applyFilter(S: Spectrum, H: Plane): Spectrum {
  const re = new Float64Array(S.re.length);
  const im = new Float64Array(S.im.length);
  for (let i = 0; i < re.length; i++) {
    re[i] = S.re[i] * H.data[i];
    im[i] = S.im[i] * H.data[i];
  }
  return { width: S.width, height: S.height, re, im };
}

/** Share of the image's energy Σ|F|² that passes the filter (by Parseval, the same as in the image domain). */
export function energyFraction(S: Spectrum, H: Plane): number {
  let kept = 0;
  let total = 0;
  for (let i = 0; i < S.re.length; i++) {
    const e = S.re[i] ** 2 + S.im[i] ** 2;
    total += e;
    kept += e * H.data[i] ** 2;
  }
  return total > 0 ? kept / total : 1;
}
