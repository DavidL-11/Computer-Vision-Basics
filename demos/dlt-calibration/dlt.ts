/**
 * Linear camera calibration (DLT): estimate the 3 × 4 projection matrix M from known 3D points and their pixels,
 * then factor it back into K, R, t and the camera center C.
 *
 * Conventions:
 *  - w (u, v, 1)ᵀ = M (X, Y, Z, 1)ᵀ with M = K [R | t], as in camera.ts (world Z up, camera x right, y down,
 *    z forward). M is a row-major Mat34 [m11 m12 m13 m14 m21 … m34].
 *  - Each correspondence gives two equations, linear in the entries of M:
 *      m11 X + m12 Y + m13 Z + m14 − u (m31 X + m32 Y + m33 Z + m34) = 0
 *      m21 X + m22 Y + m23 Z + m24 − v (m31 X + m32 Y + m33 Z + m34) = 0
 *    Method 1 (Ax = b) fixes m34 = 1 and moves u, v to the right-hand side (2n × 11). Method 2 (Ax = 0) keeps all
 *    12 entries and takes the right singular vector of the smallest singular value (2n × 12).
 *  - K = [α s u₀; 0 β v₀; 0 0 1] with α, β > 0; R is a rotation (det R = +1).
 */

import { type Mat3, type Mat34, type Vec3, det3, inverse3, mulMat3, mulMat3Vec, transpose3 } from '../../src/shared/linalg';
import { type Matrix, leastSquares } from '../../src/shared/matrix';
import { type SVD, svd } from '../../src/shared/svd';

export type Vec2 = [number, number];
export type Method = 'Ax=b' | 'Ax=0';

export function projectionRows([X, Y, Z]: Vec3, [u, v]: Vec2, method: Method): [number[], number[]] {
  const r1 = [X, Y, Z, 1, 0, 0, 0, 0, -u * X, -u * Y, -u * Z, -u];
  const r2 = [0, 0, 0, 0, X, Y, Z, 1, -v * X, -v * Y, -v * Z, -v];
  // Method 1: the last column belongs to m34 = 1 and moves to the right-hand side as +u, +v.
  return method === 'Ax=0' ? [r1, r2] : [r1.slice(0, 11), r2.slice(0, 11)];
}

export interface Calibration {
  A: Matrix;
  /** Right-hand side (u₁, v₁, …) for Method 1, zeros for Method 2. */
  b: number[];
  /** Singular values of A, for judging how well the system determines M. */
  svd: SVD;
  /** null if Method 1 has a singular AᵀA. */
  M: Mat34 | null;
}

export function calibrate(X: readonly Vec3[], uv: readonly Vec2[], method: Method): Calibration {
  const A = X.flatMap((p, i) => projectionRows(p, uv[i], method));
  const s = svd(A);
  if (method === 'Ax=0') {
    const n = s.V.length;
    const m = s.V.map((row) => row[n - 1]);
    return { A, b: new Array(A.length).fill(0), svd: s, M: m as Mat34 };
  }
  const b = uv.flatMap(([u, v]) => [u, v]);
  const { x } = leastSquares(A, b);
  return { A, b, svd: s, M: x && ([...x, 1] as Mat34) };
}

/** M scaled so that (m31, m32, m33), the third row of K R, is a unit vector; the sign is kept. */
export function normalizeM(M: Mat34): Mat34 {
  const k = Math.hypot(M[8], M[9], M[10]);
  return M.map((v) => v / k) as Mat34;
}

export const leftBlock = (M: Mat34): Mat3 => [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]];
export const lastColumn = (M: Mat34): Vec3 => [M[3], M[7], M[11]];

/**
 * RQ decomposition Q = K R with K upper triangular and R orthogonal, by three Givens rotations that zero the
 * entries below the diagonal from the bottom row up: Q Gx Gy Gz = K, so R = Gzᵀ Gyᵀ Gxᵀ.
 */
export function rq3(Q: Mat3): { K: Mat3; R: Mat3 } {
  const at = (M: Mat3, r: number, c: number) => M[3 * r + c];
  const norm = (a: number, b: number) => Math.hypot(a, b) || 1;

  // Zero entry (3, 2) with a rotation about x.
  let d = norm(at(Q, 2, 1), at(Q, 2, 2));
  let c = -at(Q, 2, 2) / d, s = at(Q, 2, 1) / d;
  const Gx: Mat3 = [1, 0, 0, 0, c, -s, 0, s, c];
  const Q1 = mulMat3(Q, Gx);

  // Zero entry (3, 1) with a rotation about y.
  d = norm(at(Q1, 2, 0), at(Q1, 2, 2));
  c = at(Q1, 2, 2) / d;
  s = at(Q1, 2, 0) / d;
  const Gy: Mat3 = [c, 0, s, 0, 1, 0, -s, 0, c];
  const Q2 = mulMat3(Q1, Gy);

  // Zero entry (2, 1) with a rotation about z.
  d = norm(at(Q2, 1, 0), at(Q2, 1, 1));
  c = -at(Q2, 1, 1) / d;
  s = at(Q2, 1, 0) / d;
  const Gz: Mat3 = [c, -s, 0, s, c, 0, 0, 0, 1];
  const K = mulMat3(Q2, Gz);

  const R = mulMat3(mulMat3(transpose3(Gz), transpose3(Gy)), transpose3(Gx));
  return { K, R };
}

export interface Factors {
  K: Mat3;
  R: Mat3;
  t: Vec3;
  C: Vec3;
  /** −1 if M had to be negated to make det R = +1. */
  sign: number;
}

/**
 * M = λ K [R | t] → K, R, t, C. Post-processing after the RQ decomposition: make the diagonal of K positive
 * (moving the signs into R), negate M if R turned out to be a reflection, and scale K so that K₃₃ = 1.
 * null if the left 3 × 3 block Q is singular, so that M is no projection of a real camera.
 */
export function factorize(M: Mat34): Factors | null {
  const Q = leftBlock(M);
  if (Math.abs(det3(Q)) < 1e-9 * Math.hypot(...Q) ** 3) return null;
  const { K: K0, R: R0 } = rq3(Q);
  // K D · D R = K R for D = diag(±1): the signs of K's columns and R's rows flip together.
  const D = [0, 4, 8].map((i) => (K0[i] < 0 ? -1 : 1));
  let K = K0.map((v, i) => v * D[i % 3]) as Mat3;
  let R = R0.map((v, i) => v * D[Math.floor(i / 3)]) as Mat3;
  let m4 = lastColumn(M);
  const sign = det3(R) < 0 ? -1 : 1;
  if (sign < 0) {
    // −M = K (−R) [I | …]: flipping the sign of M turns the reflection into a rotation.
    R = R.map((v) => -v) as Mat3;
    m4 = m4.map((v) => -v) as Vec3;
  }
  const lambda = K[8];
  K = K.map((v) => v / lambda) as Mat3;
  const t = mulMat3Vec(inverse3(K), m4.map((v) => v / lambda) as Vec3);
  const C = mulMat3Vec(inverse3(Q), lastColumn(M)).map((v) => -v) as Vec3;
  return { K, R, t, C, sign };
}

/** Rotation angle of R̂ Rᵀ in degrees: how far the estimated orientation is from the true one. */
export function rotationError(Rest: Mat3, Rtrue: Mat3): number {
  const E = mulMat3(Rest, transpose3(Rtrue));
  const cos = Math.max(-1, Math.min(1, (E[0] + E[4] + E[8] - 1) / 2));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function projectM(M: Mat34, [X, Y, Z]: Vec3): Vec2 {
  const w = M[8] * X + M[9] * Y + M[10] * Z + M[11];
  return [(M[0] * X + M[1] * Y + M[2] * Z + M[3]) / w, (M[4] * X + M[5] * Y + M[6] * Z + M[7]) / w];
}

/** Reprojection error vectors M̂ Xᵢ − (uᵢ, vᵢ) in pixels. */
export const reprojectionErrors = (M: Mat34, X: readonly Vec3[], uv: readonly Vec2[]): Vec2[] =>
  X.map((p, i) => {
    const [u, v] = projectM(M, p);
    return [u - uv[i][0], v - uv[i][1]];
  });
