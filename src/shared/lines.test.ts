import { describe, expect, it } from 'vitest';
import { clipLine, pointLineDistance } from './lines';

describe('clipping a line to a rectangle', () => {
  it('returns the chord through the rectangle', () => {
    // v = u / 2 + 10
    const seg = clipLine([1, -2, 20], 0, 100, 0, 100)!;
    const us = seg.map((p) => p[0]).sort((a, b) => a - b);
    expect(us[0]).toBeCloseTo(0, 9);
    expect(us[1]).toBeCloseTo(100, 9);
    seg.forEach(([u, v]) => expect(v).toBeCloseTo(u / 2 + 10, 9));
  });

  it('handles horizontal lines and misses', () => {
    expect(clipLine([0, 1, -30], 0, 100, 0, 50)!.map((p) => p[1])).toEqual([30, 30]);
    expect(clipLine([0, 1, -80], 0, 100, 0, 50)).toBeNull();
    expect(clipLine([1, 1, 500], 0, 100, 0, 100)).toBeNull();
  });
});

describe('distance from a line', () => {
  it('is signed and in pixels, independent of the scale of l', () => {
    expect(pointLineDistance([0, 2, -60], [5, 40])).toBeCloseTo(10, 12);
    expect(pointLineDistance([3, 4, 0], [-3, -4])).toBeCloseTo(-5, 12);
  });
});
