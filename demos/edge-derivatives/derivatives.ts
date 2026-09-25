/**
 * Derivatives of an image along x, with and without Gaussian smoothing.
 *
 * Conventions:
 *  - Each row is a 1D signal f[m], m being the column (x). Pixels outside the image copy the nearest edge pixel.
 *  - The derivative is the central difference ∂f/∂x[m] ≈ (f[m + 1] − f[m − 1]) / 2.
 *  - Convolution (f ∗ h)[m] = Σ_k h[k] · f[m − k], with the kernel origin in the middle of an odd-length array.
 *  - Smoothing is along the row only, g = G_σ(x), or along x and y, g = G_σ(x) G_σ(y).
 */

import { correlateSeparable, gaussianKernel } from '../../src/shared/filter';
import { type Plane, createPlane } from '../../src/shared/image';

export type Smoothing = 'row' | 'xy';

const IDENTITY = Float32Array.of(1);

export const row = (p: Plane, y: number) => p.data.subarray(y * p.width, (y + 1) * p.width);

/** f ∗ g. The Gaussian is symmetric, so correlation and convolution agree. */
export function smooth(f: Plane, sigma: number, smoothing: Smoothing): Plane {
  const g = gaussianKernel(sigma);
  return correlateSeparable(f, g, smoothing === 'xy' ? g : IDENTITY, 'clamp');
}

export function derivativeX(f: Plane): Plane {
  const { width: w, height: h } = f;
  const out = createPlane(w, h);
  for (let y = 0; y < h; y++) {
    const i = y * w;
    for (let x = 0; x < w; x++) out.data[i + x] = (f.data[i + Math.min(x + 1, w - 1)] - f.data[i + Math.max(x - 1, 0)]) / 2;
  }
  return out;
}

/**
 * Discrete derivative of Gaussian: the central difference of the sampled G_σ, one sample wider on each side,
 * dg[x] = (g[x + 1] − g[x − 1]) / 2. It closely follows G'_σ(x).
 */
export function gaussianDerivative(sigma: number): Float32Array {
  const g = gaussianKernel(sigma);
  // Index m of dg is x = m − r − 1, which is index m − 1 of g.
  return Float32Array.from({ length: g.length + 2 }, (_, m) => ((g[m] ?? 0) - (g[m - 2] ?? 0)) / 2);
}

/** G'_σ(x) = −x / σ² · G_σ(x), the derivative of the continuous 1D Gaussian. */
export const gaussianDerivativeAt = (x: number, sigma: number) =>
  ((-x / (sigma * sigma)) * Math.exp(-(x * x) / (2 * sigma * sigma))) / (Math.sqrt(2 * Math.PI) * sigma);

/** f ∗ ∂g/∂x in a single filtering step, with ∂g/∂x = dg(x) or dg(x) G_σ(y). */
export function filterWithGaussianDerivative(f: Plane, sigma: number, smoothing: Smoothing): Plane {
  const g = gaussianKernel(sigma);
  // Convolution is correlation with the flipped kernel; dg is odd, so flipping it changes its sign.
  const flipped = gaussianDerivative(sigma).reverse();
  return correlateSeparable(f, flipped, smoothing === 'xy' ? g : IDENTITY, 'clamp');
}

/** Columns where |d| has a local maximum of at least `threshold`: the edges along a row. */
export function edgePeaks(d: ArrayLike<number>, threshold: number): number[] {
  const peaks: number[] = [];
  for (let m = 0; m < d.length; m++) {
    const a = Math.abs(d[m]);
    // Strictly greater on the left only, so a flat top of two equal samples counts once.
    if (a > 0 && a >= threshold && a > Math.abs(d[m - 1] ?? 0) && a >= Math.abs(d[m + 1] ?? 0)) peaks.push(m);
  }
  return peaks;
}

/** 1 where a pixel is an edge peak of its row in the derivative image d, 0 elsewhere. */
export function edgeMap(d: Plane, threshold: number): Uint8Array {
  const map = new Uint8Array(d.width * d.height);
  for (let y = 0; y < d.height; y++) for (const m of edgePeaks(row(d, y), threshold)) map[y * d.width + m] = 1;
  return map;
}

/**
 * Positions where the second derivative s changes sign, linearly interpolated between samples m and m + 1 and
 * measured in pixels from column 0. Only crossings where the first derivative d reaches `threshold` are kept;
 * flat, noisy regions cross zero all the time.
 */
export function zeroCrossings(s: ArrayLike<number>, d: ArrayLike<number>, threshold: number): number[] {
  const crossings: number[] = [];
  for (let m = 0; m + 1 < s.length; m++) {
    if (s[m] * s[m + 1] < 0 && Math.max(Math.abs(d[m]), Math.abs(d[m + 1])) >= threshold) {
      crossings.push(m + s[m] / (s[m] - s[m + 1]));
    }
  }
  return crossings;
}
