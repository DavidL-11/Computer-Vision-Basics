import { describe, expect, it } from 'vitest';
import type { Keypoint } from '../../src/shared/dog';
import type { Feature } from '../../src/shared/sift';
import { IDENTITY } from '../../src/shared/warp';
import { count, histogram, matchFeatures, tradeoff } from './matching';

const feature = (x: number, y: number, d: number[]): Feature => ({
  keypoint: { x, y } as Keypoint,
  theta: 0,
  descriptor: Float32Array.from(d.map((v) => v / Math.hypot(...d))),
});

// Three features in A; B is shifted by (5, 0).
const A = [feature(20, 20, [1, 0, 0]), feature(40, 20, [0, 1, 0]), feature(30, 30, [0, 0, 1])];
const B = [feature(25, 20, [1, 0.1, 0]), feature(45, 20, [0, 1, 0.9]), feature(35, 30, [0, 0.9, 1]), feature(80, 50, [1, 1, 1])];
const T = { ...IDENTITY, tx: 5 };

describe('matchFeatures', () => {
  const { matches, possible } = matchFeatures(A, B, T, 100, 60, 2, 1.5);

  it('finds the nearest and second nearest neighbor and their ratio', () => {
    expect(matches.map((m) => m.b)).toEqual([0, 1, 2]);
    const m = matches[1];
    expect(m.d1).toBeLessThan(m.d2);
    expect(m.ratio).toBeCloseTo(m.d1 / m.d2, 9);
  });

  it('judges matches by the known transformation', () => {
    expect(matches.every((m) => m.correct)).toBe(true);
    expect(possible).toBe(3);
    const wrong = matchFeatures(A, B, { ...IDENTITY, tx: -5 }, 100, 60, 2, 1.5);
    expect(wrong.matches.some((m) => m.correct)).toBe(false);
  });

  it('gives a low ratio to a distinctive match and one near 1 to an ambiguous one', () => {
    expect(matches[0].ratio).toBeLessThan(0.5);
    expect(matches[1].ratio).toBeGreaterThan(0.6);
  });
});

describe('thresholds', () => {
  const matches = [
    { a: 0, b: 0, d1: 0.1, d2: 0.5, ratio: 0.2, correct: true },
    { a: 1, b: 1, d1: 0.3, d2: 0.35, ratio: 0.86, correct: false },
    { a: 2, b: 2, d1: 0.4, d2: 0.8, ratio: 0.5, correct: true },
  ];

  it('counts accepted matches by distance or by ratio', () => {
    expect(count(matches, 'distance', 0.35)).toEqual({ accepted: 2, correct: 1, incorrect: 1 });
    expect(count(matches, 'ratio', 0.8)).toEqual({ accepted: 2, correct: 2, incorrect: 0 });
  });

  it('traces correct against incorrect matches over all thresholds', () => {
    expect(tradeoff(matches, 'distance')).toEqual([[0, 0], [0, 1], [1, 1], [1, 2]]);
    expect(tradeoff(matches, 'ratio')).toEqual([[0, 0], [0, 1], [0, 2], [1, 2]]);
  });

  it('builds a histogram of shares', () => {
    expect(histogram([0.1, 0.15, 0.9, 2], 0, 1, 4)).toEqual([0.5, 0, 0, 0.5]);
  });
});
