import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { NONE, STRONG, WEAK, WEAK_EDGE, gradient, hysteresis, nonMaximumSuppression, sample, suppressionAt } from './canny';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

const at = (p: Plane, x: number, y: number) => p.data[y * p.width + x];

describe('gradient', () => {
  it('points from dark to bright, across the edge', () => {
    const g = gradient(image(20, 10, (x) => (x < 10 ? 0.2 : 0.8)), 1);
    expect(at(g.ix, 9, 5)).toBeGreaterThan(0.1);
    expect(at(g.iy, 9, 5)).toBeCloseTo(0, 6);
    expect(at(g.angle, 9, 5)).toBeCloseTo(0, 6);
    const down = gradient(image(10, 20, (_, y) => (y < 10 ? 0.8 : 0.2)), 1);
    // y points down, so a gradient towards the top is at −90°.
    expect(at(down.angle, 5, 9)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('has magnitude √(I_x² + I_y²) and is rotated with a diagonal edge', () => {
    const g = gradient(image(20, 20, (x, y) => (x + y < 20 ? 0 : 1)), 1.5);
    expect(at(g.magnitude, 10, 9)).toBeCloseTo(Math.hypot(at(g.ix, 10, 9), at(g.iy, 10, 9)), 6);
    expect(at(g.angle, 10, 9)).toBeCloseTo(Math.PI / 4, 4);
  });
});

describe('bilinear sample', () => {
  const p = image(2, 2, (x, y) => x + 2 * y);
  it('hits pixel values at integer positions and averages in between', () => {
    expect(sample(p, 1, 0)).toBeCloseTo(1, 6);
    expect(sample(p, 0.5, 0.5)).toBeCloseTo(1.5, 6);
    expect(sample(p, 0.25, 1)).toBeCloseTo(2.25, 6);
  });
});

describe('non-maximum suppression', () => {
  it('thins a blurry vertical edge to one pixel per row', () => {
    const g = gradient(image(30, 12, (x) => (x < 15 ? 0.2 : 0.8)), 2.5);
    const thin = nonMaximumSuppression(g);
    for (let y = 0; y < 12; y++) {
      const kept = [];
      for (let x = 0; x < 30; x++) if (at(thin, x, y) > 0) kept.push(x);
      expect(kept).toHaveLength(1);
      expect([14, 15]).toContain(kept[0]);
    }
  });

  it('compares with the magnitudes one pixel ahead and behind along the gradient', () => {
    const g = gradient(image(30, 12, (x) => (x < 15 ? 0.2 : 0.8)), 2.5);
    const s = suppressionAt(g, 12, 6);
    expect(s.dx).toBeCloseTo(1, 6);
    expect(s.dy).toBeCloseTo(0, 6);
    expect(s.p).toBeCloseTo(at(g.magnitude, 13, 6), 6);
    expect(s.r).toBeCloseTo(at(g.magnitude, 11, 6), 6);
    expect(s.keep).toBe(false);
  });
});

describe('hysteresis', () => {
  it('keeps weak pixels connected to a strong one, and drops isolated ones', () => {
    const thin = image(8, 3, (x, y) => (y === 1 ? [0.9, 0.3, 0.3, 0, 0.3, 0.1, 0, 0.6][x] : 0));
    const classes = hysteresis(thin, 0.2, 0.5);
    expect(Array.from(classes.subarray(8, 16))).toEqual([STRONG, WEAK_EDGE, WEAK_EDGE, NONE, WEAK, NONE, NONE, STRONG]);
  });

  it('follows diagonal neighbors, too', () => {
    const diagonal = image(3, 3, (x, y) => (x === y ? [0.9, 0.3, 0.3][x] : 0));
    expect(Array.from(hysteresis(diagonal, 0.2, 0.5))).toEqual([STRONG, NONE, NONE, NONE, WEAK_EDGE, NONE, NONE, NONE, WEAK_EDGE]);
  });
});
