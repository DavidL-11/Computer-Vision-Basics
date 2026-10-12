/**
 * Vanishing points and vanishing lines of a pinhole camera.
 *
 * Conventions:
 *  - World frame right-handed with Z up; camera frame x right, y down, z forward (see src/shared/camera.ts).
 *  - Image points and lines are homogeneous 3-vectors. A point (u, v) is (u, v, 1) up to scale; a line
 *    au + bv + c = 0 is (a, b, c). The point p lies on the line l iff p · l = 0.
 */

import { type Mat3, type Vec3, cross, mulMat3Vec, norm } from '../../src/shared/linalg';

export type Vec2 = [number, number];

/** Relative tolerance for treating w as zero. */
const EPS = 1e-9;

/**
 * The image of the point at infinity in direction d. A point X + s·d on a 3D line projects to
 * K (R X + t + s R d); divided by s, this tends to K R d as s → ∞. The position X and the translation t drop out,
 * so all lines with direction d share this vanishing point, and it depends only on K and R.
 */
export function vanishingPoint(K: Mat3, R: Mat3, d: Vec3): Vec3 {
  return mulMat3Vec(K, mulMat3Vec(R, d));
}

/** The vanishing line of a plane that contains the directions d1 and d2: the line through their vanishing points. */
export function vanishingLine(K: Mat3, R: Mat3, d1: Vec3, d2: Vec3): Vec3 {
  return cross(vanishingPoint(K, R, d1), vanishingPoint(K, R, d2));
}

/** The vanishing line of the ground plane Z = 0, spanned by the X and Y directions. */
export function horizon(K: Mat3, R: Mat3): Vec3 {
  return vanishingLine(K, R, [1, 0, 0], [0, 1, 0]);
}

export const lineThrough = (p: Vec3, q: Vec3): Vec3 => cross(p, q);
export const intersect = (l1: Vec3, l2: Vec3): Vec3 => cross(l1, l2);

export function isAtInfinity(p: Vec3): boolean {
  return Math.abs(p[2]) <= EPS * norm(p);
}

/** (u, v) = (x / w, y / w), or null for a point at infinity. */
export function toCartesian(p: Vec3): Vec2 | null {
  return isAtInfinity(p) ? null : [p[0] / p[2], p[1] / p[2]];
}
