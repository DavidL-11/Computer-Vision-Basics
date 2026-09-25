/**
 * Homogeneous coordinates in the plane.
 *
 * Conventions:
 *  - A point (x, y) is written p = (x, y, 1). Any non-zero multiple k·p is the same point,
 *    and (x, y, w) converts back to (x / w, y / w).
 *  - A line ax + by + c = 0 is written l = (a, b, c). The point p lies on l iff p · l = 0.
 *  - Line through two points: l = p₁ × p₂. Intersection of two lines: q = l₁ × l₂.
 *  - Image-plane axes: x right, y down.
 */

import { type Vec3, cross, norm } from '../../src/shared/linalg';

export type Vec2 = [number, number];

/** Relative tolerance for treating a coordinate as zero. */
const EPS = 1e-9;

export const toHomogeneous = ([x, y]: Vec2): Vec3 => [x, y, 1];

/** Only valid for w ≠ 0; see isAtInfinity. */
export const toCartesian = ([x, y, w]: Vec3): Vec2 => [x / w, y / w];

export const scaleH = (h: Vec3, k: number): Vec3 => [k * h[0], k * h[1], k * h[2]];

export function isAtInfinity(h: Vec3): boolean {
  return Math.abs(h[2]) <= EPS * norm(h);
}

export function lineThrough(p1: Vec2, p2: Vec2): Vec3 {
  return cross(toHomogeneous(p1), toHomogeneous(p2));
}

export type Intersection =
  /** An ordinary point (x / w, y / w). */
  | { kind: 'point'; q: Vec3; p: Vec2 }
  /** Parallel lines meet at the point at infinity (x, y, 0) in direction (x, y). */
  | { kind: 'infinity'; q: Vec3; direction: Vec2 }
  /** The lines coincide (or a line is undefined), so the cross product vanishes. */
  | { kind: 'same-line'; q: Vec3 };

export function intersect(l1: Vec3, l2: Vec3): Intersection {
  const q = cross(l1, l2);
  const n = norm(q);
  if (n <= EPS * norm(l1) * norm(l2)) return { kind: 'same-line', q };
  if (isAtInfinity(q)) {
    const d = Math.hypot(q[0], q[1]);
    return { kind: 'infinity', q, direction: [q[0] / d, q[1] / d] };
  }
  return { kind: 'point', q, p: toCartesian(q) };
}

export interface Box {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** How far one can go from p in unit direction u before leaving the box. */
function reachInBox(p: Vec2, u: Vec2, box: Box): number {
  let t = Infinity;
  if (u[0] > 0) t = Math.min(t, (box.xMax - p[0]) / u[0]);
  if (u[0] < 0) t = Math.min(t, (box.xMin - p[0]) / u[0]);
  if (u[1] > 0) t = Math.min(t, (box.yMax - p[1]) / u[1]);
  if (u[1] < 0) t = Math.min(t, (box.yMin - p[1]) / u[1]);
  return t;
}

/**
 * Moves p4 so that the line p3–p4 is parallel to p1–p2. Keeps the length of p3–p4 and
 * the side of p3 that p4 was on, as far as the optional box allows.
 */
export function parallelThrough(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2, box?: Box): Vec2 {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return p4;
  const want = Math.hypot(p4[0] - p3[0], p4[1] - p3[1]) || len;
  const sign = (p4[0] - p3[0]) * dx + (p4[1] - p3[1]) * dy < 0 ? -1 : 1;
  const sides = [sign, -sign].map((s) => {
    const u: Vec2 = [(s * dx) / len, (s * dy) / len];
    return { u, reach: box ? reachInBox(p3, u, box) : Infinity };
  });
  const side = sides[0].reach >= want || sides[0].reach >= sides[1].reach ? sides[0] : sides[1];
  const t = Math.min(want, side.reach);
  return [p3[0] + t * side.u[0], p3[1] + t * side.u[1]];
}

/** The part of line l inside the rectangle [xMin, xMax] × [yMin, yMax], or null if it misses it. */
export function clipLine(l: Vec3, xMin: number, xMax: number, yMin: number, yMax: number): [Vec2, Vec2] | null {
  const [a, b, c] = l;
  const scale = Math.hypot(a, b);
  if (scale === 0) return null;
  const hits: Vec2[] = [];
  if (Math.abs(b) > EPS * scale) {
    for (const x of [xMin, xMax]) {
      const y = -(a * x + c) / b;
      if (y >= yMin - 1e-12 && y <= yMax + 1e-12) hits.push([x, y]);
    }
  }
  if (Math.abs(a) > EPS * scale) {
    for (const y of [yMin, yMax]) {
      const x = -(b * y + c) / a;
      if (x >= xMin - 1e-12 && x <= xMax + 1e-12) hits.push([x, y]);
    }
  }
  let best: [Vec2, Vec2] | null = null;
  let bestDist = 0;
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const d = Math.hypot(hits[i][0] - hits[j][0], hits[i][1] - hits[j][1]);
      if (d > bestDist) {
        bestDist = d;
        best = [hits[i], hits[j]];
      }
    }
  }
  return best;
}
