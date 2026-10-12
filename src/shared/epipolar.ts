/**
 * Two-view geometry from the projection matrices of two cameras.
 *
 * Conventions:
 *  - Cameras and images are numbered 0 and 1: x₀ ≅ P₀ X and x₁ ≅ P₁ X with P = K [R | t] (see camera.ts).
 *  - Image points and lines are homogeneous 3-vectors (see lines.ts), 3D points homogeneous 4-vectors.
 *  - F maps a point of image 0 to its epipolar line in image 1: l₁ = F x₀, so x₁ᵀ F x₀ = 0 for corresponding points.
 *    Fᵀ maps the other way: l₀ = Fᵀ x₁.
 *  - [v]× is the cross-product matrix with [v]× m = v × m.
 */

import { type Mat3, type Mat34, type Vec3, inverse3, mulMat3, mulMat3Vec, norm, transpose3 } from './linalg';
import type { Vec2 } from './lines';
import { type Matrix, multiply, transpose } from './matrix';
import { nullVector } from './svd';

export type Vec4 = [number, number, number, number];

export function skew([a, b, c]: Vec3): Mat3 {
  return [0, -c, b, c, 0, -a, -b, a, 0];
}

export const rowsOfP = (P: Mat34): Matrix => [P.slice(0, 4), P.slice(4, 8), P.slice(8)];
const flat3 = (M: Matrix): Mat3 => M.flat() as Mat3;

export const mulP = (P: Mat34, X: Vec4): Vec3 => [0, 1, 2].map((r) => P[4 * r] * X[0] + P[4 * r + 1] * X[1] + P[4 * r + 2] * X[2] + P[4 * r + 3] * X[3]) as Vec3;

/** P⁺ = Pᵀ (P Pᵀ)⁻¹, a 4 × 3 matrix with P P⁺ = I: the point X⁺ = P⁺ x projects to x. */
export function pseudoInverseP(P: Mat34): Matrix {
  const A = rowsOfP(P);
  const At = transpose(A);
  const inv = inverse3(flat3(multiply(A, At)));
  return multiply(At, [inv.slice(0, 3), inv.slice(3, 6), inv.slice(6)]);
}

/** The camera center is the right null space of P, P C = 0; the null vector is scaled to C = (X, Y, Z, 1). */
export function centerFromP(P: Mat34): Vec4 {
  const { x } = nullVector(rowsOfP(P));
  return x.map((v) => v / x[3]) as Vec4;
}

export interface TwoView {
  P0plus: Matrix;
  C0: Vec4;
  C1: Vec4;
  /** e₀ = P₀ C₁ and e₁ = P₁ C₀, homogeneous. */
  e0: Vec3;
  e1: Vec3;
  F: Mat3;
}

/**
 * The viewing ray of x₀ contains C₀ and X⁺ = P₀⁺ x₀. Its image in camera 1 is the line through their projections,
 * e₁ = P₁ C₀ and P₁ P₀⁺ x₀, so l₁ = e₁ × P₁ P₀⁺ x₀ = [e₁]× P₁ P₀⁺ x₀, and F = [e₁]× P₁ P₀⁺.
 */
export function twoView(P0: Mat34, P1: Mat34): TwoView {
  const P0plus = pseudoInverseP(P0);
  const C0 = centerFromP(P0);
  const C1 = centerFromP(P1);
  const e0 = mulP(P0, C1);
  const e1 = mulP(P1, C0);
  const F = mulMat3(skew(e1), flat3(multiply(rowsOfP(P1), P0plus)));
  return { P0plus, C0, C1, e0, e1, F };
}

const frobenius = (F: Mat3) => Math.hypot(...F);

/**
 * F is only defined up to scale: scaled to ‖F‖ = 1. With a reference, the sign is chosen to agree with it, otherwise
 * so that the largest entry is positive.
 */
export function unitF(F: Mat3, ref?: Mat3): Mat3 {
  const agree = ref ? F.reduce((s, v, i) => s + v * ref[i], 0) : F.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
  const s = (agree < 0 ? -1 : 1) / frobenius(F);
  return F.map((v) => v * s) as Mat3;
}

/** e₀ with F e₀ = 0 and e₁ with Fᵀ e₁ = 0; for an F of full rank, the unit vectors that come closest. */
export function epipoles(F: Mat3): { e0: Vec3; e1: Vec3 } {
  const rows = (M: Mat3): Matrix => [M.slice(0, 3), M.slice(3, 6), M.slice(6)];
  return { e0: nullVector(rows(F)).x as Vec3, e1: nullVector(rows(transpose3(F))).x as Vec3 };
}

export const epipolarLine = (F: Mat3, [u, v]: Vec2): Vec3 => mulMat3Vec(F, [u, v, 1]);
export const epipolarLineT = (F: Mat3, [u, v]: Vec2): Vec3 => mulMat3Vec(transpose3(F), [u, v, 1]);

/** x₁ᵀ F x₀ */
export function epipolarResidual(F: Mat3, x0: Vec2, [u, v]: Vec2): number {
  const l = epipolarLine(F, x0);
  return u * l[0] + v * l[1] + l[2];
}

/** Relative tolerance for treating w as zero. */
const EPS = 1e-9;

/** (u, v) = (x / w, y / w), or null for a point at infinity. */
export function toPixel(p: Vec3): Vec2 | null {
  return Math.abs(p[2]) <= EPS * norm(p) ? null : [p[0] / p[2], p[1] / p[2]];
}
