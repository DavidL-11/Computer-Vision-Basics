/**
 * Nearest-neighbor matching of SIFT features between an image A and a transformed copy B, with known ground truth.
 *
 * Conventions:
 *  - Distances are Euclidean distances between the 128-dimensional descriptors, which have unit length, so they lie
 *    in [0, 2] (in [0, √2] for descriptors without negative entries).
 *  - Every feature of A is matched to its nearest neighbor in B (NN1, distance d₁); NN2 is the second nearest (d₂).
 *  - A match is correct if the keypoint of B lies within ε pixels of the keypoint of A mapped with the known
 *    transformation (src/shared/warp.ts).
 */

import type { Feature } from '../../src/shared/sift';
import { distance } from '../../src/shared/sift';
import { type Transform, commonRegion, mapPoint } from '../../src/shared/warp';

export interface Match {
  /** Index of the feature in A and of its nearest neighbor in B. */
  a: number;
  b: number;
  d1: number;
  d2: number;
  /** d₁ / d₂, the nearest neighbor distance ratio. */
  ratio: number;
  correct: boolean;
}

export interface Matching {
  /** One match per feature of A in the region that both images show. */
  matches: Match[];
  /** How many of these features have a feature of B within ε of their mapped position: the most correct matches possible. */
  possible: number;
}

export function matchFeatures(A: Feature[], B: Feature[], T: Transform, width: number, height: number, margin: number, eps: number): Matching {
  const common = commonRegion(T, width, height, margin);
  const matches: Match[] = [];
  let possible = 0;
  A.forEach((fa, a) => {
    const { x, y } = fa.keypoint;
    if (!common(x, y) || B.length < 2) return;
    const [mx, my] = mapPoint(T, width, height, x, y);
    const near = (fb: Feature) => Math.hypot(fb.keypoint.x - mx, fb.keypoint.y - my) <= eps;
    if (B.some(near)) possible++;
    let [b, d1, d2] = [-1, Infinity, Infinity];
    B.forEach((fb, j) => {
      const d = distance(fa.descriptor, fb.descriptor);
      if (d < d1) [b, d1, d2] = [j, d, d1];
      else if (d < d2) d2 = d;
    });
    matches.push({ a, b, d1, d2, ratio: d2 > 0 ? d1 / d2 : 1, correct: near(B[b]) });
  });
  return { matches, possible };
}

export type Criterion = 'distance' | 'ratio';

/** The value a match is accepted by: d₁ ≤ threshold, or d₁ / d₂ ≤ threshold. */
export const score = (m: Match, c: Criterion) => (c === 'distance' ? m.d1 : m.ratio);

export interface Counts {
  accepted: number;
  correct: number;
  incorrect: number;
}

export function count(matches: Match[], c: Criterion, threshold: number): Counts {
  const accepted = matches.filter((m) => score(m, c) <= threshold);
  const correct = accepted.filter((m) => m.correct).length;
  return { accepted: accepted.length, correct, incorrect: accepted.length - correct };
}

/** Correct and incorrect accepted matches for every threshold, from the strictest to accepting all. */
export function tradeoff(matches: Match[], c: Criterion): [incorrect: number, correct: number][] {
  const sorted = [...matches].sort((p, q) => score(p, c) - score(q, c));
  const out: [number, number][] = [[0, 0]];
  let [fp, tp] = [0, 0];
  for (const m of sorted) {
    if (m.correct) tp++;
    else fp++;
    out.push([fp, tp]);
  }
  return out;
}

/** Share of the values in each of `bins` equal bins over [lo, hi], so that the bars of a group sum to 1. */
export function histogram(values: number[], lo: number, hi: number, bins: number): number[] {
  const h = new Array<number>(bins).fill(0);
  for (const v of values) h[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))]++;
  return values.length ? h.map((n) => n / values.length) : h;
}
