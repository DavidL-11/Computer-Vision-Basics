/**
 * The 8-point algorithm: estimating the fundamental matrix from point correspondences.
 *
 * Conventions:
 *  - Images 0 and 1 with x₁ᵀ F x₀ = 0 (see src/shared/epipolar.ts); F is a row-major Mat3 [f11 f12 … f33].
 *  - Each correspondence (u₀, v₀) ↔ (u₁, v₁) gives one row of A f = 0 with f = (f11, f12, f13, f21, …, f33):
 *      [u₁u₀  u₁v₀  u₁  v₁u₀  v₁v₀  v₁  u₀  v₀  1]
 *  - Normalization: x̂ = T x, where T moves the centroid of the points to 0 and scales their mean distance from it to
 *    √2. If F̂ is estimated from normalized points, x̂₁ᵀ F̂ x̂₀ = x₁ᵀ (T₁ᵀ F̂ T₀) x₀, so F = T₁ᵀ F̂ T₀.
 *  - The rank-2 constraint is enforced on F̂, before undoing the normalization.
 */

import { epipolarLine } from '../../src/shared/epipolar';
import { type Mat3, identity3, mulMat3, transpose3 } from '../../src/shared/linalg';
import { type Vec2, pointLineDistance } from '../../src/shared/lines';
import type { Matrix } from '../../src/shared/matrix';
import { type SVD, nullVector, rankApprox, svd } from '../../src/shared/svd';

export function epipolarRow([u0, v0]: Vec2, [u1, v1]: Vec2): number[] {
  return [u1 * u0, u1 * v0, u1, v1 * u0, v1 * v0, v1, u0, v0, 1];
}

export function normalization(points: readonly Vec2[]): Mat3 {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p[0], 0) / n;
  const cy = points.reduce((s, p) => s + p[1], 0) / n;
  const mean = points.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n;
  const s = mean > 0 ? Math.SQRT2 / mean : 1;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

export const applyT = (T: Mat3, [u, v]: Vec2): Vec2 => [T[0] * u + T[1] * v + T[2], T[3] * u + T[4] * v + T[5]];

const toRows = (F: Mat3): Matrix => [F.slice(0, 3), F.slice(3, 6), F.slice(6)];

export interface Options {
  normalize: boolean;
  rank2: boolean;
}

export interface FEstimate {
  T0: Mat3;
  T1: Mat3;
  /** n × 9, built from the (normalized) points. */
  A: Matrix;
  svd: SVD;
  /** The last column of V, reshaped: F̂ in the coordinates of A, before the rank-2 step. */
  Fhat: Mat3;
  /** Singular values of F̂; the rank-2 step sets the last one to 0. */
  sigmaF: number[];
  /** The result in pixel coordinates, with the rank-2 step if enabled. */
  F: Mat3;
}

export function estimateF(x0s: readonly Vec2[], x1s: readonly Vec2[], { normalize, rank2 }: Options): FEstimate {
  const T0 = normalize ? normalization(x0s) : identity3();
  const T1 = normalize ? normalization(x1s) : identity3();
  const A = x0s.map((x0, i) => epipolarRow(applyT(T0, x0), applyT(T1, x1s[i])));
  const { x: f, svd: s } = nullVector(A);
  const Fhat = f as Mat3;
  const sF = svd(toRows(Fhat));
  const constrained = rank2 ? (rankApprox(sF, 2).flat() as Mat3) : Fhat;
  return { T0, T1, A, svd: s, Fhat, sigmaF: sF.sigma, F: mulMat3(mulMat3(transpose3(T1), constrained), T0) };
}

/** Distance of each x₁ from its epipolar line F x₀, in pixels. */
export function epipolarDistances(F: Mat3, x0s: readonly Vec2[], x1s: readonly Vec2[]): number[] {
  return x0s.map((x0, i) => Math.abs(pointLineDistance(epipolarLine(F, x0), x1s[i])));
}

/** Root mean square of each column of A: how differently scaled the unknowns are. */
export function columnMagnitudes(A: Matrix): number[] {
  return A[0].map((_, j) => Math.sqrt(A.reduce((s, row) => s + row[j] ** 2, 0) / A.length));
}
