import { describe, expect, it } from 'vitest';
import { dot } from '../../src/shared/linalg';
import {
  type Vec2,
  clipLine,
  intersect,
  isAtInfinity,
  lineThrough,
  parallelThrough,
  scaleH,
  toCartesian,
  toHomogeneous,
} from './homogeneous';

function expectVecClose(a: readonly number[], b: readonly number[], digits = 9) {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
}

describe('conversion', () => {
  it('appends 1 and divides by w', () => {
    expect(toHomogeneous([2, -3])).toEqual([2, -3, 1]);
    expectVecClose(toCartesian([4, -6, 2]), [2, -3]);
  });

  it('is scale invariant', () => {
    const p = toHomogeneous([0.7, -1.2]);
    for (const k of [3, -0.5, 1e-3]) expectVecClose(toCartesian(scaleH(p, k)), [0.7, -1.2]);
  });

  it('flags w = 0 as a point at infinity', () => {
    expect(isAtInfinity([1, 2, 0])).toBe(true);
    expect(isAtInfinity([1, 2, 1e-3])).toBe(false);
  });
});

describe('lines', () => {
  it('l = p₁ × p₂ contains both points', () => {
    const p1: Vec2 = [0.3, -1.1];
    const p2: Vec2 = [1.7, 0.4];
    const l = lineThrough(p1, p2);
    expect(dot(l, toHomogeneous(p1))).toBeCloseTo(0);
    expect(dot(l, toHomogeneous(p2))).toBeCloseTo(0);
  });

  it('gives the expected coefficients', () => {
    // Through (0, 0) and (1, 1): −x + y = 0.
    expectVecClose(lineThrough([0, 0], [1, 1]), [-1, 1, 0]);
  });
});

describe('intersection', () => {
  it('q = l₁ × l₂ for x = 1 and y = 2 is (1, 2)', () => {
    const r = intersect([1, 0, -1], [0, 1, -2]);
    expect(r.kind).toBe('point');
    expectVecClose(r.q, [1, 2, 1]);
    if (r.kind === 'point') expectVecClose(r.p, [1, 2]);
  });

  it('parallel lines meet at infinity in their direction', () => {
    const r = intersect([0, 1, 0], [0, 1, -1]); // y = 0 and y = 1
    expect(r.kind).toBe('infinity');
    expect(r.q[2]).toBe(0);
    if (r.kind === 'infinity') expectVecClose(r.direction.map(Math.abs), [1, 0]);
  });

  it('detects identical lines', () => {
    const l = lineThrough([0, 0], [1, 2]);
    expect(intersect(l, scaleH(l, -3)).kind).toBe('same-line');
  });
});

describe('parallelThrough', () => {
  it('makes the second line parallel and keeps its length', () => {
    const p1: Vec2 = [-1, 0.5];
    const p2: Vec2 = [1, -0.3];
    const p3: Vec2 = [0.2, 1];
    const p4 = parallelThrough(p1, p2, p3, [1.4, 1.3]);
    expect(intersect(lineThrough(p1, p2), lineThrough(p3, p4)).kind).toBe('infinity');
    expect(Math.hypot(p4[0] - p3[0], p4[1] - p3[1])).toBeCloseTo(Math.hypot(1.2, 0.3));
  });

  it('stays inside the box, switching sides if needed', () => {
    const box = { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 };
    const p3: Vec2 = [1.9, 0];
    // p4 is to the right of p3, but there is no room there.
    const p4 = parallelThrough([0, 0], [1, 0], p3, [2, 0], box);
    expect(p4[0]).toBeGreaterThanOrEqual(box.xMin);
    expect(p4[0]).toBeLessThanOrEqual(box.xMax);
    expect(p4[1]).toBeCloseTo(0);
    expect(Math.abs(p4[0] - p3[0])).toBeGreaterThan(0.05);
  });
});

describe('clipLine', () => {
  it('clips a diagonal to the box corners', () => {
    const seg = clipLine([-1, 1, 0], -1, 1, -1, 1)!;
    const xs = seg.map((p) => p[0]).sort();
    expectVecClose(xs, [-1, 1]);
  });

  it('handles vertical and horizontal lines', () => {
    expectVecClose(clipLine([1, 0, -0.5], -1, 1, -2, 2)!.flat().sort(), [-2, 0.5, 0.5, 2].sort());
    expectVecClose(clipLine([0, 1, 0], -1, 1, -2, 2)!.flat().sort(), [-1, 0, 0, 1].sort());
  });

  it('returns null when the line misses the box', () => {
    expect(clipLine([1, 0, -5], -1, 1, -1, 1)).toBeNull();
  });
});
