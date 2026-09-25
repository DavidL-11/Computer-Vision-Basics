import { describe, expect, it } from 'vitest';
import { derivatives, eigen } from '../../src/shared/harris';
import { type Plane, createPlane } from '../../src/shared/image';
import { autocorrelation, classify, quadratic, secondMomentAt, windowWeights } from './autocorrelation';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

const R = 3;
const E_at = (E: Plane, u: number, v: number) => E.data[(v + R) * E.width + u + R];

describe('window weights', () => {
  it('sum to 1 and peak in the middle for the Gaussian', () => {
    for (const type of ['box', 'gaussian'] as const) {
      const w = windowWeights(3, type);
      expect(w.width).toBe(7);
      expect(w.data.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    const g = windowWeights(3, 'gaussian');
    expect(g.data[24]).toBe(Math.max(...g.data));
    expect(new Set(windowWeights(2, 'box').data).size).toBe(1);
  });
});

describe('autocorrelation', () => {
  it('is 0 without a shift', () => {
    const I = image(20, 20, (x, y) => Math.sin(x) * Math.cos(y));
    expect(E_at(autocorrelation(I, 10, 10, windowWeights(2, 'gaussian'), R), 0, 0)).toBe(0);
  });

  it('is exactly the quadratic form of M on a linear ramp', () => {
    const I = image(30, 30, (x, y) => 0.02 * x - 0.01 * y);
    const w = windowWeights(3, 'box');
    const E = autocorrelation(I, 15, 15, w, R);
    const M = secondMomentAt(derivatives(I, 0), 15, 15, w);
    expect(M[0]).toBeCloseTo(0.0004, 7);
    expect(M[1]).toBeCloseTo(-0.0002, 7);
    expect(M[2]).toBeCloseTo(0.0001, 7);
    for (const [u, v] of [
      [1, 0],
      [0, -2],
      [3, 1],
      [-2, 3],
    ])
      expect(E_at(E, u, v)).toBeCloseTo(quadratic(M, u, v), 7);
  });

  it('does not change along an edge', () => {
    const I = image(20, 20, (x) => (x < 10 ? 0.2 : 0.8));
    const w = windowWeights(3, 'gaussian');
    const E = autocorrelation(I, 10, 10, w, R);
    for (let v = -R; v <= R; v++) expect(E_at(E, 0, v)).toBe(0);
    expect(E_at(E, 1, 0)).toBeGreaterThan(0.01);
    const [a, b, c] = secondMomentAt(derivatives(I, 0), 10, 10, w);
    const { l1, l2 } = eigen(a, b, c);
    expect(classify(l1, l2, 1e-3)).toBe('edge');
  });
});

describe('classify', () => {
  it('uses the smaller eigenvalue for corners and the larger for edges', () => {
    expect(classify(0.02, 0.01, 0.005)).toBe('corner');
    expect(classify(0.02, 0.001, 0.005)).toBe('edge');
    expect(classify(0.004, 0.001, 0.005)).toBe('flat');
  });
});
