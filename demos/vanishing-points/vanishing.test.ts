import { describe, expect, it } from 'vitest';
import { project, snapshot } from '../../src/shared/camera';
import { type Vec3, add, dot, norm, scale } from '../../src/shared/linalg';
import {
  clipLine,
  horizon,
  intersect,
  isAtInfinity,
  lineThrough,
  normalizeLine,
  toCartesian,
  vanishingLine,
  vanishingPoint,
} from './vanishing';

const intrinsics = { fx: 500, fy: 500, u0: 320, v0: 240, skew: 0 };
const camera = (yaw: number, pitch: number, roll: number, height = 1.6) =>
  snapshot(intrinsics, { C: [0.3, -1, height], yaw, pitch, roll });

/** Homogeneous image point of a world point. */
const image = (cam: ReturnType<typeof camera>, X: Vec3): Vec3 => {
  const [u, v] = project(cam.K, cam.R, cam.t, X).uv;
  return [u, v, 1];
};

function expectSamePoint(p: Vec3, q: Vec3) {
  // Homogeneous vectors are the same point iff they are parallel.
  expect(Math.abs(dot(p, q)) / (norm(p) * norm(q))).toBeCloseTo(1, 9);
}

describe('vanishing points', () => {
  const cam = camera(25, -10, 5);

  it('K R d is where the images of two parallel lines meet', () => {
    for (const d of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 2, 1],
    ] as Vec3[]) {
      const A: Vec3 = [-2, 6, 0];
      const B: Vec3 = [3, 9, 0.5];
      const l1 = lineThrough(image(cam, A), image(cam, add(A, scale(d, 2))));
      const l2 = lineThrough(image(cam, B), image(cam, add(B, scale(d, 3))));
      expectSamePoint(intersect(l1, l2), vanishingPoint(cam.K, cam.R, d));
    }
  });

  it('is the limit of the projection of X + s·d', () => {
    const d: Vec3 = [0, 2, 1];
    const far = image(cam, add([1, 5, 0], scale(d, 1e7)));
    const v = toCartesian(vanishingPoint(cam.K, cam.R, d))!;
    expect(far[0]).toBeCloseTo(v[0], 3);
    expect(far[1]).toBeCloseTo(v[1], 3);
  });

  it('does not depend on the camera position', () => {
    const low = camera(25, -10, 5, 0.5);
    const high = camera(25, -10, 5, 5);
    expect(vanishingPoint(low.K, low.R, [0, 1, 0])).toEqual(vanishingPoint(high.K, high.R, [0, 1, 0]));
  });
});

describe('points at infinity', () => {
  it('vertical lines stay parallel when the camera does not pitch', () => {
    const cam = camera(30, 0, 0);
    expect(isAtInfinity(vanishingPoint(cam.K, cam.R, [0, 0, 1]))).toBe(true);
    expect(toCartesian(vanishingPoint(cam.K, cam.R, [0, 0, 1]))).toBeNull();
  });

  it('with yaw = pitch = 0 only the Y direction has a finite vanishing point, at the principal point', () => {
    const cam = camera(0, 0, 0);
    expect(isAtInfinity(vanishingPoint(cam.K, cam.R, [1, 0, 0]))).toBe(true);
    expect(isAtInfinity(vanishingPoint(cam.K, cam.R, [0, 0, 1]))).toBe(true);
    const v = toCartesian(vanishingPoint(cam.K, cam.R, [0, 1, 0]))!;
    expect(v[0]).toBeCloseTo(320, 9);
    expect(v[1]).toBeCloseTo(240, 9);
  });
});

describe('horizon', () => {
  const cam = camera(-35, 12, 8);
  const l = horizon(cam.K, cam.R);

  it('contains the vanishing point of every horizontal direction', () => {
    for (let a = 0; a < 180; a += 15) {
      const d: Vec3 = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180), 0];
      const v = vanishingPoint(cam.K, cam.R, d);
      expect(dot(normalizeLine(l), v) / Math.hypot(...v)).toBeCloseTo(0, 9);
    }
  });

  it('does not contain the vanishing point of a rising direction', () => {
    const v = vanishingPoint(cam.K, cam.R, [0, 2, 1]);
    expect(Math.abs(dot(normalizeLine(l), v) / v[2])).toBeGreaterThan(10);
  });

  it('passes through the images of all points at the height of the camera', () => {
    for (const X of [
      [4, 7, 1.6],
      [-3, 20, 1.6],
    ] as Vec3[])
      expect(dot(normalizeLine(l), image(cam, X))).toBeCloseTo(0, 6);
  });

  it('a tilted plane has its own vanishing line through the rising direction', () => {
    const ramp = vanishingLine(cam.K, cam.R, [1, 0, 0], [0, 2, 1]);
    const v = vanishingPoint(cam.K, cam.R, [0, 4, 2]);
    expect(dot(normalizeLine(ramp), v) / v[2]).toBeCloseTo(0, 6);
  });
});

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
