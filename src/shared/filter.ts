/**
 * Linear filtering of a single-channel image I with a small filter (kernel) f.
 *
 * Conventions:
 *  - A filter is a Plane with odd width and height; its origin (k, l) = (0, 0) is the center element.
 *  - Correlation:  h[m, n] = Σ_k Σ_l f[k, l] · I[m + k, n + l]
 *    Convolution:  h[m, n] = Σ_k Σ_l f[k, l] · I[m − k, n − l], i.e. correlation with the flipped filter.
 *  - m (and k) is the column (x), n (and l) the row (y).
 *  - 1D filters are Float32Arrays of odd length with the origin in the middle.
 */

import { type Plane, createPlane } from './image';

/**
 * How pixels outside the image are defined:
 *  - zero:    0
 *  - wrap:    the image repeats periodically
 *  - clamp:   copy of the nearest edge pixel
 *  - reflect: mirror image across the edge, which repeats the edge pixel (… c b a | a b c …)
 */
export type Border = 'zero' | 'wrap' | 'clamp' | 'reflect';

/** Maps a coordinate in (−∞, ∞) to [0, n) according to the border mode; −1 means "zero". */
export function borderIndex(i: number, n: number, border: Border): number {
  if (i >= 0 && i < n) return i;
  switch (border) {
    case 'zero':
      return -1;
    case 'wrap':
      return ((i % n) + n) % n;
    case 'clamp':
      return i < 0 ? 0 : n - 1;
    case 'reflect': {
      const m = ((i % (2 * n)) + 2 * n) % (2 * n);
      return m < n ? m : 2 * n - 1 - m;
    }
  }
}

/** I[x, y] for any integer position, extended beyond the image by the border mode. */
export function pixelAt(p: Plane, x: number, y: number, border: Border): number {
  const i = borderIndex(x, p.width, border);
  const j = borderIndex(y, p.height, border);
  return i < 0 || j < 0 ? 0 : p.data[j * p.width + i];
}

/** The image extended by `pad` pixels on every side, as the filter sees it. */
export function padPlane(p: Plane, pad: number, border: Border): Plane {
  const out = createPlane(p.width + 2 * pad, p.height + 2 * pad);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) out.data[y * out.width + x] = pixelAt(p, x - pad, y - pad, border);
  return out;
}

export function kernelFromRows(rows: readonly (readonly number[])[]): Plane {
  const k = createPlane(rows[0].length, rows.length);
  k.data.set(rows.flat());
  return k;
}

/** f[−k, −l]: the filter rotated by 180°. */
export function flipKernel(f: Plane): Plane {
  const out = createPlane(f.width, f.height);
  for (let i = 0; i < f.data.length; i++) out.data[f.data.length - 1 - i] = f.data[i];
  return out;
}

export function correlate(I: Plane, f: Plane, border: Border): Plane {
  const { width, height } = I;
  const rk = (f.width - 1) / 2;
  const rl = (f.height - 1) / 2;
  // Border lookups per axis, computed once: cols[m + k + rk] is the column read for m + k (−1 = zero).
  const cols = Int32Array.from({ length: width + 2 * rk }, (_, i) => borderIndex(i - rk, width, border));
  const rows = Int32Array.from({ length: height + 2 * rl }, (_, i) => borderIndex(i - rl, height, border));
  const h = createPlane(width, height);
  for (let n = 0; n < height; n++)
    for (let m = 0; m < width; m++) {
      let sum = 0;
      for (let l = -rl; l <= rl; l++) {
        const y = rows[n + l + rl];
        if (y < 0) continue;
        for (let k = -rk; k <= rk; k++) {
          const x = cols[m + k + rk];
          if (x >= 0) sum += f.data[(l + rl) * f.width + k + rk] * I.data[y * width + x];
        }
      }
      h.data[n * width + m] = sum;
    }
  return h;
}

export function convolve(I: Plane, f: Plane, border: Border): Plane {
  return correlate(I, flipKernel(f), border);
}

const rowKernel = (k: Float32Array): Plane => ({ width: k.length, height: 1, data: k });
const columnKernel = (k: Float32Array): Plane => ({ width: 1, height: k.length, data: k });

/** Correlation with the 2D filter fx[k]·fy[l], done as a pass along the rows followed by a pass along the columns. */
export function correlateSeparable(I: Plane, fx: Float32Array, fy: Float32Array, border: Border): Plane {
  return correlate(correlate(I, rowKernel(fx), border), columnKernel(fy), border);
}

/** The 2D filter f[k, l] = fx[k] · fy[l], e.g. G_σ(x, y) = G_σ(x) G_σ(y). */
export function outerProduct(fx: Float32Array, fy: Float32Array): Plane {
  const f = createPlane(fx.length, fy.length);
  for (let l = 0; l < fy.length; l++) for (let k = 0; k < fx.length; k++) f.data[l * fx.length + k] = fx[k] * fy[l];
  return f;
}

/** Sampled 1D Gaussian G_σ(x) with radius ⌈3σ⌉, normalized to sum 1. */
export function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.ceil(3 * sigma);
  const k = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    k[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + radius];
  }
  return k.map((v) => v / sum);
}

export const boxKernel1D = (size: number) => new Float32Array(size).fill(1 / size);

/**
 * A uniform disk of the given diameter in pixels, normalized to sum 1: the blur spot of a pinhole or of a point out
 * of focus. Each tap is weighted by the fraction of its pixel that the disk covers (sampled on a 16 × 16 grid), so
 * the spot grows smoothly instead of in whole pixels. Diameters ≤ 1 give the single tap [1].
 */
export function diskKernel(diameter: number): Plane {
  const r = diameter / 2;
  if (r <= 0.5) return kernelFromRows([[1]]);
  const radius = Math.ceil(r - 0.5);
  const size = 2 * radius + 1;
  const k = createPlane(size, size);
  const S = 16;
  let sum = 0;
  for (let l = -radius; l <= radius; l++)
    for (let m = -radius; m <= radius; m++) {
      let inside = 0;
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
          const x = m - 0.5 + (i + 0.5) / S;
          const y = l - 0.5 + (j + 0.5) / S;
          if (x * x + y * y <= r * r) inside++;
        }
      k.data[(l + radius) * size + m + radius] = inside;
      sum += inside;
    }
  return { ...k, data: k.data.map((v) => v / sum) };
}

/**
 * The same result as correlate(I, diskKernel(diameter), border), in O(diameter) instead of O(diameter²) operations
 * per pixel, which matters for large defocus blur. In each kernel row, the taps whose pixel lies fully inside the disk
 * share one weight, so their sum comes in one step from running sums along the image row. Only the partly covered
 * taps along the rim are added one by one.
 */
export function correlateDisk(I: Plane, diameter: number, border: Border): Plane {
  const f = diskKernel(diameter);
  const r = (f.width - 1) / 2;
  if (r === 0) return { ...I, data: I.data.slice() };
  const tap = (k: number, l: number) => f.data[(l + r) * f.width + k + r];
  const full = tap(0, 0);
  // Per kernel row l: the run −a ≤ k ≤ a of fully covered taps (a = −1 if none) and the remaining taps.
  const kernelRows = Array.from({ length: 2 * r + 1 }, (_, i) => {
    const l = i - r;
    let a = -1;
    while (a < r && tap(a + 1, l) === full) a++;
    const rim: [number, number][] = [];
    for (let k = -r; k <= r; k++) if (Math.abs(k) > a && tap(k, l) > 0) rim.push([k, tap(k, l)]);
    return { l, a, rim };
  });

  const P = padPlane(I, r, border);
  // S[y][x] = Σ_{i < x} P[y][i], so the run from x0 to x1 sums to S[y][x1 + 1] − S[y][x0].
  const S = new Float64Array((P.width + 1) * P.height);
  for (let y = 0; y < P.height; y++)
    for (let x = 0; x < P.width; x++) S[y * (P.width + 1) + x + 1] = S[y * (P.width + 1) + x] + P.data[y * P.width + x];

  const h = createPlane(I.width, I.height);
  for (let n = 0; n < I.height; n++)
    for (let m = 0; m < I.width; m++) {
      let sum = 0;
      for (const { l, a, rim } of kernelRows) {
        const y = n + l + r;
        const x = m + r;
        if (a >= 0) sum += full * (S[y * (P.width + 1) + x + a + 1] - S[y * (P.width + 1) + x - a]);
        for (const [k, w] of rim) sum += w * P.data[y * P.width + x + k];
      }
      h.data[n * I.width + m] = sum;
    }
  return h;
}
