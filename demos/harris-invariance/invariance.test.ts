import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { IDENTITY, compareCorners, detectCorners, mapPoint, unmapPoint, warp } from './invariance';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

const at = (p: Plane, x: number, y: number) => p.data[y * p.width + x];
/** Two rectangles and a triangle on a square image, away from the borders. */
const shapes = () =>
  image(48, 48, (x, y) => {
    if (x >= 12 && x < 22 && y >= 10 && y < 24) return 0.8;
    if (x >= 28 && x < 38 && y >= 26 && y < 34) return 0.15;
    if (y >= 28 && y < 40 && x >= 10 && x - 10 <= y - 28) return 0.7;
    return 0.4;
  });
const params = { sigmaD: 1, sigmaI: 1.5, alpha: 0.05, radius: 2, threshold: 0.05, relative: true };
const margin = 6;

describe('transform', () => {
  it('maps points forth and back', () => {
    const T = { ...IDENTITY, angle: 0.7, scale: 1.3, tx: 4, ty: -2 };
    const [x, y] = mapPoint(T, 40, 30, 12, 7);
    const [u, v] = unmapPoint(T, 40, 30, x, y);
    expect(u).toBeCloseTo(12, 9);
    expect(v).toBeCloseTo(7, 9);
  });

  it('turns clockwise on screen for positive angles, around the image center', () => {
    const [x, y] = mapPoint({ ...IDENTITY, angle: Math.PI / 2 }, 11, 11, 10, 5);
    expect(x).toBeCloseTo(5, 9);
    expect(y).toBeCloseTo(10, 9);
  });
});

describe('warp', () => {
  it('keeps the image for the identity and applies gain and bias with clipping', () => {
    const A = shapes();
    expect(Array.from(warp(A, IDENTITY).data)).toEqual(Array.from(A.data));
    const B = warp(A, { ...IDENTITY, gain: 2, bias: -0.3 });
    expect(at(B, 15, 15)).toBeCloseTo(1, 6);
    expect(at(B, 2, 2)).toBeCloseTo(0.5, 6);
  });

  it('rotates by 90° as a permutation of pixels', () => {
    const A = shapes();
    const B = warp(A, { ...IDENTITY, angle: Math.PI / 2 });
    // p' = R(p − c) + c with c = (23.5, 23.5): (x, y) → (47 − y, x)
    expect(at(B, 47 - 12, 15)).toBeCloseTo(at(A, 15, 12), 6);
    expect(at(B, 47 - 30, 33)).toBeCloseTo(at(A, 33, 30), 6);
  });
});

describe('repeatability', () => {
  const A = shapes();
  const a = detectCorners(A, params);

  it('finds every corner again in the same image', () => {
    const cmp = compareCorners(a, a, IDENTITY, 48, 48, margin, 1);
    expect(cmp.nA).toBeGreaterThanOrEqual(6);
    expect(cmp.matches).toBe(cmp.nA);
  });

  it('finds the corners again after a 90° rotation and an integer shift: covariance', () => {
    const T = { ...IDENTITY, angle: Math.PI / 2, tx: 2, ty: -1 };
    const cmp = compareCorners(a, detectCorners(warp(A, T), params), T, 48, 48, margin, 1);
    expect(cmp.nA).toBeGreaterThan(0);
    expect(cmp.matches).toBe(cmp.nA);
  });

  it('is unaffected by a brightness shift, since only derivatives are used', () => {
    const T = { ...IDENTITY, bias: 0.15 };
    const b = detectCorners(warp(A, T), { ...params, relative: false, threshold: 1e-6 });
    const a0 = detectCorners(A, { ...params, relative: false, threshold: 1e-6 });
    expect(b.map((c) => [c.x, c.y])).toEqual(a0.map((c) => [c.x, c.y]));
  });

  it('loses corners under lower contrast with a fixed threshold, but not with a relative one', () => {
    const T = { ...IDENTITY, gain: 0.5 };
    const B = warp(A, T);
    // C scales with a⁴ = 1/16.
    const fixed = { ...params, relative: false, threshold: 0.5 * a[a.length - 1].response };
    const cmpFixed = compareCorners(detectCorners(A, fixed), detectCorners(B, fixed), T, 48, 48, margin, 1);
    expect(cmpFixed.matches).toBeLessThan(cmpFixed.nA);
    const cmpRelative = compareCorners(a, detectCorners(B, params), T, 48, 48, margin, 1);
    expect(cmpRelative.matches).toBe(cmpRelative.nA);
  });
});
