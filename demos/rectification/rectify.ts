/**
 * A verged stereo rig and its rectification.
 *
 * Conventions:
 *  - World frame right-handed with Z up; camera frames as in OpenCV (x right, y down, z forward), see camera.ts.
 *  - The two cameras sit at X = ∓c/2 at the same height and are both turned inwards by θ/2 (vergence angle θ), so
 *    their optical axes meet at the fixation point at the distance D = c / (2 tan(θ/2)) straight ahead.
 *  - Rectification turns both cameras, about their centers, to one common orientation R_rect: x along the baseline,
 *    z along the mean viewing direction made perpendicular to the baseline. A pixel x of camera i moves to
 *    H_i x with H_i = K R_rect R_iᵀ K⁻¹, a homography, since only the orientation changes.
 *  - Disparity d = x_L − x_R in pixels, x measured in each image's own coordinates.
 */

import { type CameraSnapshot, type Intrinsics, snapshot } from '../../src/shared/camera';
import { type Mat3, type Vec3, cross, dot, inverse3, mulMat3, mulMat3Vec, normalize, scale, sub, transpose3 } from '../../src/shared/linalg';

export type Vec2 = [number, number];

/** Distance of the fixation point from the middle of the baseline; Infinity for parallel cameras. */
export const fixationDistance = (c: number, thetaDeg: number) => (thetaDeg <= 0 ? Infinity : c / (2 * Math.tan((thetaDeg * Math.PI) / 360)));

export function cameras(K: Intrinsics, c: number, thetaDeg: number, height: number): [CameraSnapshot, CameraSnapshot] {
  return [
    snapshot(K, { C: [-c / 2, 0, height], yaw: -thetaDeg / 2, pitch: 0, roll: 0 }),
    snapshot(K, { C: [c / 2, 0, height], yaw: thetaDeg / 2, pitch: 0, roll: 0 }),
  ];
}

/** Rows of R are the camera axes in world coordinates: x along the baseline, z the mean optical axis made perpendicular. */
export function rectifyingRotation(left: CameraSnapshot, right: CameraSnapshot): Mat3 {
  const x = normalize(sub(right.C, left.C));
  const forward = (R: Mat3): Vec3 => [R[6], R[7], R[8]];
  const mean = normalize([forward(left.R), forward(right.R)].reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]));
  const z = normalize(sub(mean, scale(x, dot(mean, x))));
  const y = cross(z, x);
  return [...x, ...y, ...z] as Mat3;
}

export function rectifyingHomography(cam: CameraSnapshot, Rrect: Mat3): Mat3 {
  return mulMat3(mulMat3(cam.K, mulMat3(Rrect, transpose3(cam.R))), inverse3(cam.K));
}

export function applyH(H: Mat3, [u, v]: Vec2): Vec2 {
  const p = mulMat3Vec(H, [u, v, 1]);
  return [p[0] / p[2], p[1] / p[2]];
}

export function projectTo(cam: CameraSnapshot, X: Vec3): { uv: Vec2; depth: number } {
  const Xc = mulMat3Vec(cam.R, sub(X, cam.C));
  const p = mulMat3Vec(cam.K, Xc);
  return { uv: [p[0] / p[2], p[1] / p[2]], depth: Xc[2] };
}
