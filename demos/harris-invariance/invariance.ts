/**
 * Repeatability of Harris corners when the image is transformed. The transformation and its conventions are in
 * src/shared/warp.ts.
 */

import { type Corner, type HarrisParams, harris, localMaxima, maxOf } from '../../src/shared/harris';
import type { Plane } from '../../src/shared/image';
import { type Transform, commonRegion, mapPoint, unmapPoint } from '../../src/shared/warp';

export interface DetectorParams extends HarrisParams {
  /** Non-maximum suppression radius. */
  radius: number;
  threshold: number;
  /** true: the threshold is a fraction of the largest C in the image; false: an absolute value of C. */
  relative: boolean;
}

export function detectCorners(I: Plane, p: DetectorParams): Corner[] {
  const { response } = harris(I, p);
  const t = p.relative ? p.threshold * Math.max(0, maxOf(response)) : p.threshold;
  return localMaxima(response, t, p.radius);
}

export interface Comparison {
  /** Per corner: inside the region that both images show, at least `margin` away from all borders. */
  commonA: boolean[];
  commonB: boolean[];
  /** Index of the matched corner in the other image, or −1. */
  matchOfA: number[];
  matchOfB: number[];
  nA: number;
  nB: number;
  matches: number;
}

/**
 * Which corners of A are detected again in B? Only corners in the common region count. Each corner of A, mapped into
 * B, is paired one-to-one with a corner of B at most `eps` pixels away, closest pairs first.
 */
export function compareCorners(a: Corner[], b: Corner[], T: Transform, width: number, height: number, margin: number, eps: number): Comparison {
  const common = commonRegion(T, width, height, margin);
  const commonA = a.map((c) => common(c.x, c.y));
  const commonB = b.map((c) => common(...unmapPoint(T, width, height, c.x, c.y)));

  const pairs: [number, number, number][] = [];
  a.forEach((ca, i) => {
    if (!commonA[i]) return;
    const [x, y] = mapPoint(T, width, height, ca.x, ca.y);
    b.forEach((cb, j) => {
      const d = Math.hypot(cb.x - x, cb.y - y);
      if (commonB[j] && d <= eps) pairs.push([d, i, j]);
    });
  });
  pairs.sort((p, q) => p[0] - q[0]);
  const matchOfA = a.map(() => -1);
  const matchOfB = b.map(() => -1);
  let matches = 0;
  for (const [, i, j] of pairs) {
    if (matchOfA[i] >= 0 || matchOfB[j] >= 0) continue;
    matchOfA[i] = j;
    matchOfB[j] = i;
    matches++;
  }
  const count = (flags: boolean[]) => flags.filter(Boolean).length;
  return { commonA, commonB, matchOfA, matchOfB, nA: count(commonA), nB: count(commonB), matches };
}
