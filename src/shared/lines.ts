// Lines in the image plane as homogeneous 3-vectors l = (a, b, c): the points (u, v) with au + bv + c = 0.

import type { Vec3 } from './linalg';

export type Vec2 = [number, number];

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

/** Signed distance of the point (u, v) from the line l, in the units of u and v. */
export function pointLineDistance(l: Vec3, [u, v]: Vec2): number {
  const [a, b, c] = normalizeLine(l);
  return a * u + b * v + c;
}
