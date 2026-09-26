/**
 * Pinhole camera model, written out explicitly.
 *
 * Conventions:
 *  - World frame: right-handed, Z points up.
 *  - Camera frame (OpenCV): x right, y down, z forward (the viewing direction).
 *  - Extrinsics (R, t) map world → camera:  X_c = R · X_w + t.
 *  - The camera center in world coordinates is C = -R⁻¹ t = -Rᵀ t  (so t = -R · C).
 *  - Projection: w · (u, v, 1)ᵀ = K · [R | t] · (X, Y, Z, 1)ᵀ, then divide by w.
 */

import {
  type Mat3,
  type Mat34,
  type Vec3,
  DEG,
  add,
  inverse3,
  mulMat3,
  mulMat3Vec,
  mulMat34Point,
  rotX,
  rotZ,
  scale,
  sub,
  transpose3,
} from './linalg';

export interface Intrinsics {
  fx: number;
  fy: number;
  /** Principal point. */
  u0: number;
  v0: number;
  skew: number;
}

/** Angles in degrees; see cameraToWorldRotation. */
export interface Pose {
  C: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface Projection {
  Xc: Vec3;
  /** w · (u, v, 1). */
  wuv: Vec3;
  /** Meaningless when the point is behind the camera. */
  uv: [number, number];
  /** w, which equals Z_c because the last row of K is [0 0 1]. */
  depth: number;
  inFront: boolean;
}

export function buildK({ fx, fy, u0, v0, skew }: Intrinsics): Mat3 {
  return [fx, skew, u0, 0, fy, v0, 0, 0, 1];
}

/**
 * Orientation of the camera axes in world coordinates (camera → world):
 * Rᵀ = R_z(yaw) · R_x(pitch − 90°) · R_z(roll). Columns are the camera's
 * x (right), y (down) and z (forward) axes.
 *
 * R_x(−90°) turns the optical axis from world +Z (up) to world +Y, so with
 * yaw = pitch = roll = 0 the camera looks along world +Y, with its x axis
 * along world +X and its y axis pointing down (world -Z).
 *  - yaw   rotates about the world Z axis (turn left/right),
 *  - pitch tilts the viewing direction up (+) or down (-),
 *  - roll  rotates about the camera's own optical axis.
 */
export function cameraToWorldRotation(yaw: number, pitch: number, roll: number): Mat3 {
  return mulMat3(mulMat3(rotZ(yaw * DEG), rotX((pitch - 90) * DEG)), rotZ(roll * DEG));
}

export function buildR(yaw: number, pitch: number, roll: number): Mat3 {
  return transpose3(cameraToWorldRotation(yaw, pitch, roll));
}

export function buildT(R: Mat3, C: Vec3): Vec3 {
  return scale(mulMat3Vec(R, C), -1);
}

export function cameraCenter(R: Mat3, t: Vec3): Vec3 {
  return scale(mulMat3Vec(transpose3(R), t), -1);
}

export function buildP(K: Mat3, R: Mat3, t: Vec3): Mat34 {
  const KR = mulMat3(K, R);
  const Kt = mulMat3Vec(K, t);
  return [KR[0], KR[1], KR[2], Kt[0], KR[3], KR[4], KR[5], Kt[1], KR[6], KR[7], KR[8], Kt[2]];
}

export function projectP(P: Mat34, Xw: Vec3): { uv: [number, number]; depth: number; inFront: boolean } {
  const wuv = mulMat34Point(P, Xw);
  return { uv: [wuv[0] / wuv[2], wuv[1] / wuv[2]], depth: wuv[2], inFront: wuv[2] > 0 };
}

export function project(K: Mat3, R: Mat3, t: Vec3, Xw: Vec3): Projection {
  const Xc = add(mulMat3Vec(R, Xw), t);
  const wuv = mulMat3Vec(K, Xc);
  return {
    Xc,
    wuv,
    uv: [wuv[0] / wuv[2], wuv[1] / wuv[2]],
    depth: wuv[2],
    inFront: wuv[2] > 0,
  };
}

/** `depth` is Z_c (distance along the optical axis), not the distance to C. */
export function backproject(K: Mat3, R: Mat3, t: Vec3, u: number, v: number, depth: number): Vec3 {
  const ray = mulMat3Vec(inverse3(K), [u, v, 1]); // direction with z = 1
  const Xc = scale(ray, depth);
  return mulMat3Vec(transpose3(R), sub(Xc, t));
}

export function lookAtAngles(C: Vec3, target: Vec3): { yaw: number; pitch: number } {
  const d = sub(target, C);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-9) return { yaw: 0, pitch: 0 };
  const pitch = Math.asin(d[2] / len);
  // Forward after yaw: (-sin(yaw)·cos(pitch), cos(yaw)·cos(pitch), sin(pitch))
  const yaw = Math.atan2(-d[0], d[1]);
  return { yaw: yaw / DEG, pitch: pitch / DEG };
}

/** AFOV = 2·arctan(H / 2f) per axis, with the image size and f both in pixels. */
export function fieldOfView(K: Intrinsics, width: number, height: number): { h: number; v: number } {
  return {
    h: (2 * Math.atan(width / (2 * K.fx))) / DEG,
    v: (2 * Math.atan(height / (2 * K.fy))) / DEG,
  };
}

/** Segment endpoints are in camera coordinates. */
export function clipSegmentNear(a: Vec3, b: Vec3, near: number): [Vec3, Vec3] | null {
  const aIn = a[2] >= near;
  const bIn = b[2] >= near;
  if (aIn && bIn) return [a, b];
  if (!aIn && !bIn) return null;
  const s = (near - a[2]) / (b[2] - a[2]);
  const p: Vec3 = [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), near];
  return aIn ? [a, p] : [p, b];
}

export interface CameraSnapshot {
  intrinsics: Intrinsics;
  K: Mat3;
  R: Mat3;
  t: Vec3;
  C: Vec3;
  P: Mat34;
}

export function snapshot(intrinsics: Intrinsics, pose: Pose): CameraSnapshot {
  const K = buildK(intrinsics);
  const R = buildR(pose.yaw, pose.pitch, pose.roll);
  const t = buildT(R, pose.C);
  return { intrinsics, K, R, t, C: pose.C, P: buildP(K, R, t) };
}
