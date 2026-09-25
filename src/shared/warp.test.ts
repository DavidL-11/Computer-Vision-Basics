import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from './image';
import { IDENTITY, bilinear, commonRegion, mapPoint, unmapPoint, warp } from './warp';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

const at = (p: Plane, x: number, y: number) => p.data[y * p.width + x];
/** Two rectangles on a square image. */
const shapes = () =>
  image(48, 48, (x, y) => {
    if (x >= 12 && x < 22 && y >= 10 && y < 24) return 0.8;
    if (x >= 28 && x < 38 && y >= 26 && y < 34) return 0.15;
    return 0.4;
  });

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

describe('bilinear', () => {
  it('interpolates linearly between pixel centers', () => {
    const ramp = image(6, 4, (x, y) => x + 10 * y);
    expect(bilinear(ramp, 2.25, 1.5)).toBeCloseTo(17.25, 5);
  });
});

describe('commonRegion', () => {
  it('keeps points that stay inside both images, away from the borders', () => {
    const inside = commonRegion({ ...IDENTITY, tx: 10 }, 40, 30, 3);
    expect(inside(20, 15)).toBe(true);
    expect(inside(28, 15)).toBe(false);
    expect(inside(2, 15)).toBe(false);
  });
});
