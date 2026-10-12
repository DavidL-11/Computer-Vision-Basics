/**
 * Error metrics for matching a window of I₀ in I₁, evaluated for every displacement u of a full search.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates. The window of radius r around x₀ has the pixels
 *    xᵢ = x₀ + (i, j) with |i|, |j| ≤ r, and the error of a displacement u = (u, v) is eᵢ = I₁(xᵢ + u) − I₀(xᵢ).
 *  - Border handling:
 *      'clamp'  every window pixel counts; pixels outside an image repeat its border.
 *      'wsrd'   only pixels with w₀(xᵢ) w₁(xᵢ + u) = 1 count, where w₀, w₁ are 1 inside the image and w₁ is 0 on
 *               pixels of I₁ that are masked out.
 *      'nwsrd'  as 'wsrd', divided by the number of counted pixels A(u) = Σ w₀(xᵢ) w₁(xᵢ + u).
 *  - Costs (SSD, SAD, Lp, Geman–McClure, SSD with bias and gain) are best when smallest. CC and NCC are similarities
 *    and best when largest.
 *  - The surface of a search with radius R is a (2R + 1)² array, row by row: index (v + R)(2R + 1) + (u + R).
 */

import { pixelAt } from '../../src/shared/filter';
import type { Plane } from '../../src/shared/image';

export type Metric = 'ssd' | 'sad' | 'lp' | 'gm' | 'gain-bias' | 'cc' | 'ncc';
export type Border = 'clamp' | 'wsrd' | 'nwsrd';

export interface CostParams {
  /** Exponent of the Lp norm. */
  p: number;
  /** Scale a of the Geman–McClure kernel. */
  a: number;
  border: Border;
  /** Pixels of I₁ with w₁ = 0 (masked out), used by 'wsrd' and 'nwsrd'. */
  masked1?: (x: number, y: number) => boolean;
}

export const isSimilarity = (m: Metric) => m === 'cc' || m === 'ncc';

export function rho(metric: 'ssd' | 'sad' | 'lp' | 'gm', e: number, { p, a }: Pick<CostParams, 'p' | 'a'>): number {
  switch (metric) {
    case 'ssd':
      return e * e;
    case 'sad':
      return Math.abs(e);
    case 'lp':
      return Math.abs(e) ** p;
    case 'gm':
      return (e * e) / (1 + (e * e) / (a * a));
  }
}

export interface Samples {
  /** I₀(xᵢ) and I₁(xᵢ + u) of the counted pixels. */
  i0: number[];
  i1: number[];
  /** Per window pixel, row by row: whether it counts. */
  counted: boolean[];
  /** Number of window pixels, (2r + 1)². */
  total: number;
}

const inside = (I: Plane, x: number, y: number) => x >= 0 && y >= 0 && x < I.width && y < I.height;

export function samples(I0: Plane, I1: Plane, x0: number, y0: number, r: number, u: number, v: number, params: CostParams): Samples {
  const out: Samples = { i0: [], i1: [], counted: [], total: (2 * r + 1) ** 2 };
  const masks = params.border !== 'clamp';
  for (let j = -r; j <= r; j++)
    for (let i = -r; i <= r; i++) {
      const x = x0 + i, y = y0 + j;
      const counts = !masks || (inside(I0, x, y) && inside(I1, x + u, y + v) && !params.masked1?.(x + u, y + v));
      out.counted.push(counts);
      if (!counts) continue;
      out.i0.push(pixelAt(I0, x, y, 'clamp'));
      out.i1.push(pixelAt(I1, x + u, y + v, 'clamp'));
    }
  return out;
}

/** α, β that minimize Σ [I₁ − (α I₀ + β)]², by linear regression of i1 on i0. */
export function fitGainBias(i0: readonly number[], i1: readonly number[]): { alpha: number; beta: number } {
  const n = i0.length;
  if (n === 0) return { alpha: 1, beta: 0 };
  const m0 = i0.reduce((s, v) => s + v, 0) / n;
  const m1 = i1.reduce((s, v) => s + v, 0) / n;
  let cov = 0, var0 = 0;
  for (let k = 0; k < n; k++) {
    cov += (i0[k] - m0) * (i1[k] - m1);
    var0 += (i0[k] - m0) ** 2;
  }
  const alpha = var0 > 1e-12 ? cov / var0 : 0;
  return { alpha, beta: m1 - alpha * m0 };
}

export function ncc(i0: readonly number[], i1: readonly number[]): number {
  const n = i0.length;
  if (n === 0) return 0;
  const m0 = i0.reduce((s, v) => s + v, 0) / n;
  const m1 = i1.reduce((s, v) => s + v, 0) / n;
  let num = 0, s0 = 0, s1 = 0;
  for (let k = 0; k < n; k++) {
    num += (i0[k] - m0) * (i1[k] - m1);
    s0 += (i0[k] - m0) ** 2;
    s1 += (i1[k] - m1) ** 2;
  }
  return s0 * s1 > 1e-18 ? num / Math.sqrt(s0 * s1) : 0;
}

/** The error E(u) of the counted pixels; NaN if no pixel counts. */
export function cost(metric: Metric, s: Samples, params: CostParams): number {
  const n = s.i0.length;
  if (n === 0) return NaN;
  if (metric === 'ncc') return ncc(s.i0, s.i1);
  let sum = 0;
  if (metric === 'cc') for (let k = 0; k < n; k++) sum += s.i0[k] * s.i1[k];
  else if (metric === 'gain-bias') {
    const { alpha, beta } = fitGainBias(s.i0, s.i1);
    for (let k = 0; k < n; k++) sum += (s.i1[k] - (alpha * s.i0[k] + beta)) ** 2;
  } else for (let k = 0; k < n; k++) sum += rho(metric, s.i1[k] - s.i0[k], params);
  if (params.border === 'nwsrd') sum /= n;
  return metric === 'lp' ? sum ** (1 / params.p) : sum;
}

export function costSurface(I0: Plane, I1: Plane, x0: number, y0: number, r: number, R: number, metric: Metric, params: CostParams): Float64Array {
  const n = 2 * R + 1;
  const E = new Float64Array(n * n);
  for (let v = -R; v <= R; v++)
    for (let u = -R; u <= R; u++) E[(v + R) * n + u + R] = cost(metric, samples(I0, I1, x0, y0, r, u, v, params), params);
  return E;
}

/** The displacement with the best value: the smallest cost or the largest similarity. */
export function best(E: Float64Array, R: number, metric: Metric): { u: number; v: number; value: number } {
  const n = 2 * R + 1;
  const sign = isSimilarity(metric) ? -1 : 1;
  let k = -1;
  for (let i = 0; i < E.length; i++) if (!Number.isNaN(E[i]) && (k < 0 || sign * E[i] < sign * E[k])) k = i;
  return k < 0 ? { u: 0, v: 0, value: NaN } : { u: (k % n) - R, v: Math.floor(k / n) - R, value: E[k] };
}
