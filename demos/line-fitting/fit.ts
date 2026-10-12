/**
 * Line fitting by vertical least squares (Ax = b) and total least squares (Ax = 0).
 *
 * Conventions:
 *  - Points in math orientation (x right, y up).
 *  - Vertical least squares fits y = m x + b and measures errors along y only.
 *  - Total least squares fits a x + b y + c = 0 with a² + b² = 1, so |a xᵢ + b yᵢ + c| is the perpendicular distance.
 *    The normal (a, b) is chosen with b > 0 (or a > 0 for a vertical line), since (−a, −b, −c) is the same line.
 */

import { eigen } from '../../src/shared/harris';
import { type Matrix, leastSquares } from '../../src/shared/matrix';

export type Vec2 = [number, number];

export interface VerticalFit {
  /** Rows [xᵢ 1]. */
  A: Matrix;
  y: number[];
  AtA: Matrix;
  Aty: number[];
  /** (m, b), or null when AᵀA is singular: all xᵢ equal, i.e. a vertical line. */
  p: Vec2 | null;
  /** yᵢ − (m xᵢ + b). */
  residuals: number[];
  E: number;
}

export function verticalLS(points: readonly Vec2[]): VerticalFit {
  const A = points.map(([x]) => [x, 1]);
  const y = points.map(([, y]) => y);
  const { AtA, Atb: Aty, x } = leastSquares(A, y);
  const p = x && ([x[0], x[1]] as Vec2);
  const residuals = p ? points.map(([x, y]) => y - (p[0] * x + p[1])) : points.map(() => NaN);
  return { A, y, AtA, Aty, p, residuals, E: p ? residuals.reduce((s, r) => s + r * r, 0) : NaN };
}

export interface TotalFit {
  /** (x̄, ȳ). */
  mean: Vec2;
  /** Rows [xᵢ − x̄, yᵢ − ȳ]. */
  A: Matrix;
  AtA: Matrix;
  /** Eigenvalues of AᵀA, λ₁ ≥ λ₂. */
  lambda: Vec2;
  /** (a, b): the unit eigenvector of λ₂, the normal of the line. */
  normal: Vec2;
  c: number;
  /** Signed perpendicular distances a xᵢ + b yᵢ + c. */
  residuals: number[];
  /** Σ (a xᵢ + b yᵢ + c)², which equals λ₂. */
  E: number;
}

export function totalLS(points: readonly Vec2[]): TotalFit {
  const n = points.length;
  const mean: Vec2 = [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  const A = points.map(([x, y]) => [x - mean[0], y - mean[1]]);
  const sxx = A.reduce((s, r) => s + r[0] * r[0], 0);
  const sxy = A.reduce((s, r) => s + r[0] * r[1], 0);
  const syy = A.reduce((s, r) => s + r[1] * r[1], 0);
  const { l1, l2, angle } = eigen(sxx, sxy, syy);
  // The eigenvector of λ₂ is perpendicular to the one of λ₁, which points along the line.
  let normal: Vec2 = [-Math.sin(angle), Math.cos(angle)];
  if (normal[1] < -1e-12 || (Math.abs(normal[1]) <= 1e-12 && normal[0] < 0)) normal = [-normal[0], -normal[1]];
  const c = -normal[0] * mean[0] - normal[1] * mean[1];
  const residuals = points.map(([x, y]) => normal[0] * x + normal[1] * y + c);
  return {
    mean,
    A,
    AtA: [
      [sxx, sxy],
      [sxy, syy],
    ],
    lambda: [l1, l2],
    normal,
    c,
    residuals,
    E: residuals.reduce((s, r) => s + r * r, 0),
  };
}

/** Where the residual of each fit ends on the line: straight down/up for VLS, the perpendicular foot for TLS. */
export const verticalFoot = ([m, b]: Vec2, [x]: Vec2): Vec2 => [x, m * x + b];
export function perpendicularFoot({ normal: [a, b], c }: TotalFit, [x, y]: Vec2): Vec2 {
  const d = a * x + b * y + c;
  return [x - d * a, y - d * b];
}

export function rotateAbout(points: readonly Vec2[], center: Vec2, angle: number): Vec2[] {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  return points.map(([x, y]) => {
    const dx = x - center[0], dy = y - center[1];
    return [center[0] + cs * dx - sn * dy, center[1] + sn * dx + cs * dy];
  });
}

export const centroid = (points: readonly Vec2[]): Vec2 => totalLS(points).mean;

/** Angle of a direction in degrees in [0°, 180°), measured counterclockwise from +x. */
export const lineAngle = ([dx, dy]: Vec2) => (((Math.atan2(dy, dx) * 180) / Math.PI) % 180 + 180) % 180;

export type Preset = 'noisy line' | 'steep line' | 'vertical line' | 'one outlier' | 'two clusters';

/**
 * Points along a line through `origin` with direction `angle`, at positions t along it, moved perpendicular to it by
 * Gaussian noise of standard deviation σ.
 */
function along(origin: Vec2, angle: number, ts: number[], sigma: number, rand: () => number): Vec2[] {
  const d: Vec2 = [Math.cos(angle), Math.sin(angle)];
  return ts.map((t) => {
    const e = sigma * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    return [origin[0] + t * d[0] - e * d[1], origin[1] + t * d[1] + e * d[0]];
  });
}

const spread = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

export function presetPoints(preset: Preset, sigma: number, rand: () => number): Vec2[] {
  const deg = Math.PI / 180;
  switch (preset) {
    case 'noisy line':
      return along([0, 0.3], 25 * deg, spread(12, -3.8, 3.8), sigma, rand);
    case 'steep line':
      return along([0.5, 0], 78 * deg, spread(12, -3.5, 3.5), sigma, rand);
    case 'vertical line':
      return along([1.5, 0], 90 * deg, spread(10, -3.2, 3.2), sigma, rand);
    case 'one outlier':
      return [...along([0, -0.5], 10 * deg, spread(11, -3.8, 3.8), sigma, rand), [2, 3]];
    case 'two clusters':
      return [...along([-3, -1.5], 0, spread(6, -1, 1), sigma, rand), ...along([3, 1.5], 0, spread(6, -1, 1), sigma, rand)];
  }
}
