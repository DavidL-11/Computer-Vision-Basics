/**
 * Blurring an image with a known kernel and undoing it in the frequency domain.
 *
 * Conventions (see src/shared/fft.ts):
 *  - Model: g = h ∗ f + n, i.e. G = H · F + N, with periodic borders so that the model is exactly a product of spectra.
 *  - Transfer functions H(u, v) and restoration filters R(u, v) are real, in the DFT layout (DC at index 0), and kept
 *    in double precision: H gets as small as 10⁻⁶⁹ and 1/H as large as 10⁶⁹. The estimate is F̂ = R · G.
 */

import { type Spectrum, centeredFreq, fft2, ifft2 } from '../../src/shared/fft';
import { type Plane, createPlane } from '../../src/shared/image';

export type Blur = 'gaussian' | 'motion';
export type Method = 'inverse' | 'truncated' | 'wiener';

export interface Filter {
  width: number;
  height: number;
  data: Float64Array;
}

function filter(n: number, h: (u: number, v: number) => number): Filter {
  const data = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[y * n + x] = h(centeredFreq(x, n), centeredFreq(y, n));
  return { width: n, height: n, data };
}

/**
 * Transfer function of a Gaussian blur with σ pixels: the Fourier transform of a Gaussian is again a Gaussian,
 * H(u, v) = exp(−2π²σ²(u² + v²) / N²). It is never 0, but tiny at high frequencies.
 */
export const gaussianTransfer = (n: number, sigma: number): Filter =>
  filter(n, (u, v) => Math.exp((-2 * Math.PI ** 2 * sigma ** 2 * (u * u + v * v)) / (n * n)));

/**
 * Transfer function of horizontal motion blur, a centered box of odd `length` L along x:
 * H(u) = 1/L · Σ_k cos(2πuk / N) for k = −(L−1)/2 … (L−1)/2. It passes close to 0 near u = N/L, 2N/L, …
 */
export function motionTransfer(n: number, length: number): Filter {
  const r = (length - 1) / 2;
  return filter(n, (u) => {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += Math.cos((2 * Math.PI * u * k) / n);
    return sum / length;
  });
}

/** S · H for a real H, i.e. filtering by the convolution theorem. */
export function multiply(S: Spectrum, H: Filter): Spectrum {
  return { width: S.width, height: S.height, re: S.re.map((v, i) => v * H.data[i]), im: S.im.map((v, i) => v * H.data[i]) };
}

/** Deterministic Gaussian noise via the Box–Muller transform, so the same seed gives the same noise. */
export function gaussianNoise(width: number, height: number, sigma: number, seed: number): Plane {
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const out = createPlane(width, height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = sigma * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return out;
}

/** Stores the image with 8 bits: every value rounded to the nearest of 256 levels in [0, 1]. */
export const quantize8 = (p: Plane): Plane => ({ ...p, data: p.data.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255) / 255) });

export interface Degraded {
  /** The observed image g. */
  g: Plane;
  /** Its spectrum G. */
  G: Spectrum;
}

/**
 * g = h ∗ f + n, optionally rounded to 8 bits. Without noise and rounding, G = H · F is kept at full precision:
 * storing g with single precision alone would add errors that the inverse filter amplifies visibly.
 */
export function degrade(F: Spectrum, H: Filter, noise: number, seed: number, round8: boolean): Degraded {
  const clean = multiply(F, H);
  const blurred = ifft2(clean);
  if (noise === 0 && !round8) return { g: blurred, G: clean };
  const n = gaussianNoise(F.width, F.height, noise, seed);
  let g: Plane = { ...blurred, data: blurred.data.map((v, i) => v + n.data[i]) };
  if (round8) g = quantize8(g);
  return { g, G: fft2(g) };
}

/**
 * The restoration filter R(u, v):
 *  - inverse:   R = 1 / H
 *  - truncated: R = 1 / H where |H| ≥ ε, else 0 (pseudo-inverse)
 *  - wiener:    R = H / (H² + K), the Wiener filter with a constant noise-to-signal ratio K. It minimizes
 *               ‖h ∗ f̂ − g‖² + K ‖f̂‖², so it is also Tikhonov regularization.
 */
export function restorationFilter(H: Filter, method: Method, param: number): Filter {
  const data = H.data.map((h) =>
    method === 'inverse' ? 1 / h : method === 'truncated' ? (Math.abs(h) >= param ? 1 / h : 0) : h / (h * h + param),
  );
  return { width: H.width, height: H.height, data };
}

/** f̂ = F⁻¹{R · G}. */
export const restore = (G: Spectrum, R: Filter): Plane => ifft2(multiply(G, R));

/** Values along the positive u axis (v = 0), u = 0 … N/2. */
export const alongU = (P: Filter): number[] => Array.from(P.data.subarray(0, P.width / 2 + 1));
