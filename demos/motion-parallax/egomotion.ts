/**
 * The image motion of static scene points when the camera moves: a translation T and a small rotation per frame.
 *
 * Conventions:
 *  - Camera frame as in OpenCV (x right, y down, z forward); world frame right-handed with Z up.
 *  - The motion is given in the camera frame of the first frame: the camera center moves by T, and the camera turns
 *    by R_δ, whose columns are the new camera axes in the old camera frame. A point with camera coordinates X_c in
 *    frame 0 has the camera coordinates X'_c = R_δᵀ (X_c − T) in frame 1.
 *  - R_δ = R_y(pan) · R_x(tilt) · R_z(roll), angles in degrees: pan turns the view to the right (+x), tilt up (−y),
 *    roll clockwise in the image.
 *  - The flow of a point is the displacement x₁ − x₀ of its pixel between the two frames, not a derivative.
 */

import { type Mat3, type Vec3, DEG, cross, dot, inverse3, mulMat3, mulMat3Vec, rotX, rotY, rotZ, sub, transpose3 } from '../../src/shared/linalg';

export type Vec2 = [number, number];

export interface Motion {
  /** Translation of the camera center per frame, in m, in the camera frame. */
  T: Vec3;
  /** Pan, tilt and roll per frame, in degrees. */
  pan: number;
  tilt: number;
  roll: number;
}

export function deltaRotation({ pan, tilt, roll }: Motion): Mat3 {
  return mulMat3(mulMat3(rotY(pan * DEG), rotX(tilt * DEG)), rotZ(roll * DEG));
}

/** X'_c = R_δᵀ (X_c − T). */
export function moveCamera(Xc: Vec3, m: Motion, Rd = deltaRotation(m)): Vec3 {
  return mulMat3Vec(transpose3(Rd), sub(Xc, m.T));
}

/** A pose as world → camera rotation R and camera center C, so X_c = R (X − C). */
export interface Pose {
  R: Mat3;
  C: Vec3;
}

/** The pose after one frame of motion: C' = C + Rᵀ T, R' = R_δᵀ R. */
export function nextPose({ R, C }: Pose, m: Motion): Pose {
  const step = mulMat3Vec(transpose3(R), m.T);
  return { R: mulMat3(transpose3(deltaRotation(m)), R), C: [C[0] + step[0], C[1] + step[1], C[2] + step[2]] };
}

export const toCamera = ({ R, C }: Pose, X: Vec3): Vec3 => mulMat3Vec(R, sub(X, C));

export function toPixel(K: Mat3, Xc: Vec3): Vec2 {
  const p = mulMat3Vec(K, Xc);
  return [p[0] / p[2], p[1] / p[2]];
}

export interface PointFlow {
  /** Depth Z_c in frame 0 and in frame 1. */
  Z0: number;
  Z1: number;
  x0: Vec2;
  x1: Vec2;
  /** Where the point would be in frame 1 with only the translation, or only the rotation. */
  xT: Vec2;
  xR: Vec2;
}

/** The pixel of a point in both frames, and the two parts of its motion. */
export function pointFlow(K: Mat3, Xc: Vec3, m: Motion): PointFlow {
  const Rd = deltaRotation(m);
  const moved = moveCamera(Xc, m, Rd);
  const translated = sub(Xc, m.T);
  const rotated = mulMat3Vec(transpose3(Rd), Xc);
  return { Z0: Xc[2], Z1: moved[2], x0: toPixel(K, Xc), x1: toPixel(K, moved), xT: toPixel(K, translated), xR: toPixel(K, rotated) };
}

/**
 * The focus of expansion e = K T / T_z: the image of the direction of travel, where the translational flow of all
 * points starts (T_z > 0, expansion) or ends (T_z < 0, contraction). Null if the camera moves parallel to the image
 * plane: then e is a point at infinity, and the flow is parallel to −(T_x, T_y).
 */
export function focusOfExpansion(K: Mat3, T: Vec3): Vec2 | null {
  if (Math.abs(T[2]) < 1e-9) return null;
  return toPixel(K, T[2] > 0 ? T : [-T[0], -T[1], -T[2]]);
}

/**
 * The depth Z_c of a point in frame 0 from its pixels in both frames, given the motion: the pixels' viewing rays
 * p = K⁻¹ x₀ and q = R_δ K⁻¹ x₁ (back in the frame-0 orientation) satisfy q × (Z p − T) = 0, solved in the least
 * squares sense: Z = (q × p) · (q × T) / ‖q × p‖². Pass no rotation to ignore it. NaN without parallax.
 */
export function depthFromFlow(K: Mat3, x0: Vec2, x1: Vec2, T: Vec3, Rd?: Mat3): number {
  const Ki = inverse3(K);
  const p = mulMat3Vec(Ki, [x0[0], x0[1], 1]);
  let q = mulMat3Vec(Ki, [x1[0], x1[1], 1]);
  if (Rd) q = mulMat3Vec(Rd, q);
  const qp = cross(q, p);
  const n2 = dot(qp, qp);
  if (n2 < 1e-14) return NaN;
  return dot(qp, cross(q, T)) / n2;
}
