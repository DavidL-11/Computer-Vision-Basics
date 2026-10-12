/**
 * The SVD of a 2 × 2 matrix as three steps, A x = U (Σ (Vᵀ x)), and the rank-p approximation of an image.
 *
 * Conventions:
 *  - The plane uses math orientation (x right, y up), so positive angles turn counterclockwise.
 *  - Mat2 is row-major [a, b, c, d] = [a b; c d].
 *  - Signs: singular vectors are only defined up to sign. Flipping vᵢ together with uᵢ keeps A = U Σ Vᵀ, so V is
 *    always made a rotation (det V = +1). Then det U has the sign of det A: U is a rotation, or a rotation with a
 *    mirror when A flips the plane.
 */

import { type Plane, createPlane } from '../../src/shared/image';
import { type Matrix } from '../../src/shared/matrix';
import { type SVD, pseudoInverseSolve, rankApprox, svd } from '../../src/shared/svd';

export type Vec2 = [number, number];
export type Mat2 = [number, number, number, number];

export const mul2 = ([a, b, c, d]: Mat2, [x, y]: Vec2): Vec2 => [a * x + b * y, c * x + d * y];
export const transpose2 = ([a, b, c, d]: Mat2): Mat2 => [a, c, b, d];
export const det2 = ([a, b, c, d]: Mat2) => a * d - b * c;
const toMatrix = ([a, b, c, d]: Mat2): Matrix => [
  [a, b],
  [c, d],
];

export interface SVD2 {
  U: Mat2;
  sigma: Vec2;
  V: Mat2;
  /** Angle of v₁ and u₁ in radians. */
  angleV: number;
  angleU: number;
  /** det U = −1: the last step also mirrors. */
  mirrored: boolean;
  /** The general SVD, for the pseudo-inverse. */
  full: SVD;
}

export function svd2(A: Mat2): SVD2 {
  const full = svd(toMatrix(A));
  const [[u11, u12], [u21, u22]] = full.U;
  const [[v11, v12], [v21, v22]] = full.V;
  let U: Mat2 = [u11, u12, u21, u22];
  let V: Mat2 = [v11, v12, v21, v22];
  if (det2(V) < 0) {
    V = [v11, -v12, v21, -v22];
    U = [U[0], -U[1], U[2], -U[3]];
  }
  // With σ₂ = 0, u₂ has no effect on A, so it is chosen to keep U a rotation as well.
  if (full.sigma[1] <= 1e-12 * (full.sigma[0] || 1) && det2(U) < 0) U = [U[0], -U[1], U[2], -U[3]];
  full.U = [
    [U[0], U[1]],
    [U[2], U[3]],
  ];
  full.V = [
    [V[0], V[1]],
    [V[2], V[3]],
  ];
  return {
    U,
    sigma: [full.sigma[0], full.sigma[1]],
    V,
    angleV: Math.atan2(V[2], V[0]),
    angleU: Math.atan2(U[2], U[0]),
    mirrored: det2(U) < 0,
    full,
  };
}

/** x, Vᵀx, ΣVᵀx and UΣVᵀx = Ax. */
export function stages({ U, sigma, V }: SVD2, x: Vec2): [Vec2, Vec2, Vec2, Vec2] {
  const r = mul2(transpose2(V), x);
  const s: Vec2 = [sigma[0] * r[0], sigma[1] * r[1]];
  return [x, r, s, mul2(U, s)];
}

export interface Solution {
  x: Vec2;
  /** Which 1/σᵢ were used; a dropped one means Ax = b has no exact solution or infinitely many. */
  inverted: [boolean, boolean];
  /** A x, equal to b when the system is solvable. */
  Ax: Vec2;
}

/** x = V Σ⁻¹ Uᵀ b, with 1/σ only for σ > τ. */
export function solve2(A: Mat2, s: SVD2, b: Vec2, tau: number): Solution {
  const rtol = tau / (s.sigma[0] || 1);
  const x = pseudoInverseSolve(s.full, b, rtol) as Vec2;
  return { x, inverted: [s.sigma[0] > tau, s.sigma[1] > tau], Ax: mul2(A, x) };
}

/** The image as an m × n matrix (m rows). */
export const planeToMatrix = (p: Plane): Matrix =>
  Array.from({ length: p.height }, (_, i) => Array.from(p.data.subarray(i * p.width, (i + 1) * p.width)));

export function matrixToPlane(A: Matrix): Plane {
  const out = createPlane(A[0].length, A.length);
  A.forEach((row, i) => out.data.set(row, i * out.width));
  return out;
}

export const approximate = (s: SVD, p: number): Plane => matrixToPlane(rankApprox(s, p));

/** Numbers stored for the rank-p form (p columns of U and V plus p singular values) and for the full image. */
export const storage = (m: number, n: number, p: number) => ({ rankP: p * (m + n + 1), full: m * n });

/** Share of Σσₖ² kept by the first p singular values; Σσₖ² is the sum of all squared pixel values. */
export function energy(sigma: readonly number[], p: number): number {
  const total = sigma.reduce((s, v) => s + v * v, 0);
  return total === 0 ? 1 : sigma.slice(0, p).reduce((s, v) => s + v * v, 0) / total;
}
