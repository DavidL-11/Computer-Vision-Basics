import { describe, expect, it } from 'vitest';
import { cornerness, derivatives, eigen, harris, localMaxima, secondMoment } from './harris';
import { type Plane, createPlane } from './image';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

const at = (p: Plane, x: number, y: number) => p.data[y * p.width + x];
/** A bright square [10, 20) × [10, 20) on a dark background. */
const square = () => image(30, 30, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? 0.9 : 0.1));

describe('derivatives', () => {
  it('are central differences, optionally of the smoothed image', () => {
    const ramp = image(12, 8, (x, y) => 0.05 * x + 0.02 * y);
    const d = derivatives(ramp, 0);
    expect(at(d.ix, 5, 4)).toBeCloseTo(0.05, 6);
    expect(at(d.iy, 5, 4)).toBeCloseTo(0.02, 6);
    // Smoothing doesn't change the slope of a ramp away from the border.
    expect(at(derivatives(ramp, 1).ix, 6, 4)).toBeCloseTo(0.05, 5);
  });
});

describe('eigen', () => {
  it('returns λ₁ ≥ λ₂ with the direction of the first eigenvector', () => {
    const e = eigen(2, 1, 2);
    expect(e.l1).toBeCloseTo(3, 9);
    expect(e.l2).toBeCloseTo(1, 9);
    expect(e.angle).toBeCloseTo(Math.PI / 4, 9);
    expect(eigen(1, 0, 4).angle).toBeCloseTo(Math.PI / 2, 9);
  });

  it('gives C = λ₁λ₂ − α(λ₁ + λ₂)², i.e. det − α trace²', () => {
    const [a, b, c, alpha] = [0.3, -0.1, 0.2, 0.05];
    const { l1, l2 } = eigen(a, b, c);
    expect(cornerness(a, b, c, alpha)).toBeCloseTo(l1 * l2 - alpha * (l1 + l2) ** 2, 12);
  });
});

describe('second moment matrix', () => {
  it('has one large and one zero eigenvalue on a straight edge', () => {
    const m = secondMoment(derivatives(image(30, 20, (x) => (x < 15 ? 0.2 : 0.8)), 1), 2);
    const e = eigen(at(m.sxx, 15, 10), at(m.sxy, 15, 10), at(m.syy, 15, 10));
    expect(e.l1).toBeGreaterThan(1e-3);
    expect(e.l2).toBeCloseTo(0, 9);
    // The first eigenvector points across the edge.
    expect(Math.abs(Math.cos(e.angle))).toBeCloseTo(1, 6);
  });
});

describe('Harris response', () => {
  const { response } = harris(square(), { sigmaD: 1, sigmaI: 1.5, alpha: 0.05 });

  it('is positive at corners, negative on edges and zero in flat regions', () => {
    expect(at(response, 10, 10)).toBeGreaterThan(1e-5);
    expect(at(response, 15, 10)).toBeLessThan(0);
    expect(at(response, 3, 25)).toBeCloseTo(0, 9);
  });

  it('finds the four corners of a square after non-maximum suppression', () => {
    const corners = localMaxima(response, 1e-6, 3);
    expect(corners).toHaveLength(4);
    // The square's corners are at (9.5, 9.5) … (19.5, 19.5) between pixel centers.
    for (const c of corners) {
      expect(Math.min(Math.abs(c.x - 9.5), Math.abs(c.x - 19.5))).toBeLessThanOrEqual(2);
      expect(Math.min(Math.abs(c.y - 9.5), Math.abs(c.y - 19.5))).toBeLessThanOrEqual(2);
    }
    expect(localMaxima(response, Infinity, 3)).toHaveLength(0);
  });

  it('is covariant with a 90° rotation', () => {
    const rotated = image(30, 30, (x, y) => at(square(), y, 29 - x));
    const r = harris(rotated, { sigmaD: 1, sigmaI: 1.5, alpha: 0.05 }).response;
    for (const [x, y] of [
      [10, 10],
      [15, 12],
      [4, 20],
    ])
      expect(at(r, x, y)).toBeCloseTo(at(response, y, 29 - x), 9);
  });
});

describe('non-maximum suppression', () => {
  it('keeps one pixel of a plateau and sorts by response', () => {
    const p = image(9, 3, (x) => [0, 2, 2, 0, 0, 0, 5, 1, 0][x]);
    expect(localMaxima(p, 0, 1).map((c) => [c.x, c.y])).toEqual([
      [6, 0],
      [1, 0],
    ]);
  });
});
