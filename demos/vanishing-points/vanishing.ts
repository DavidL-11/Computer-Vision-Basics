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

/** Scales a line to a·a + b·b = 1, so that l · (u, v, 1) is the signed distance of (u, v) from the line. */
export function normalizeLine(l: Vec3): Vec3 {
  const s = Math.hypot(l[0], l[1]);
  return s === 0 ? l : [l[0] / s, l[1] / s, l[2] / s];
}

/**
 * The part of the line l inside the rectangle [x0, x1] × [y0, y1], or null if it misses it: the line is written as
 * p + s·u through its closest point p to the origin, and s is limited by each pair of rectangle sides in turn.
 */
export function clipLine(l: Vec3, x0: number, x1: number, y0: number, y1: number): [Vec2, Vec2] | null {
  const [a, b, c] = normalizeLine(l);
  if (a === 0 && b === 0) return null;
  const p: Vec2 = [-a * c, -b * c];
  const u: Vec2 = [-b, a];
  let lo = -Infinity;
  let hi = Infinity;
  for (const [pi, ui, min, max] of [
    [p[0], u[0], x0, x1],
    [p[1], u[1], y0, y1],
  ]) {
    if (Math.abs(ui) < 1e-12) {
      if (pi < min || pi > max) return null;
      continue;
    }
    const s0 = (min - pi) / ui;
    const s1 = (max - pi) / ui;
    lo = Math.max(lo, Math.min(s0, s1));
    hi = Math.min(hi, Math.max(s0, s1));
  }
  if (lo > hi) return null;
  return [
    [p[0] + lo * u[0], p[1] + lo * u[1]],
    [p[0] + hi * u[0], p[1] + hi * u[1]],
  ];
}
