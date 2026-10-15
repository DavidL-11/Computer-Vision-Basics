import { describe, expect, it } from 'vitest';
import { snapshot } from '../../src/shared/camera';
import type { Vec3 } from '../../src/shared/linalg';
import { applyH, cameras, fixationDistance, projectTo, rectifyingHomography, rectifyingRotation } from './rectify';

const K = { fx: 360, fy: 360, u0: 240, v0: 160, skew: 0 };
const [left, right] = cameras(K, 0.4, 8, 1.2);
const D = fixationDistance(0.4, 8);

describe('verged cameras', () => {
  it('fixate a point straight ahead at D = c / (2 tan(θ/2))', () => {
    expect(D).toBeCloseTo(0.2 / Math.tan((4 * Math.PI) / 180), 12);
    const F: Vec3 = [0, D, 1.2];
    for (const cam of [left, right]) {
      const { uv } = projectTo(cam, F);
      expect(uv[0]).toBeCloseTo(240, 9);
      expect(uv[1]).toBeCloseTo(160, 9);
    }
  });

  it('give nearer points a positive and farther points a negative disparity', () => {
    const d = (Y: number) => projectTo(left, [0, Y, 1.2]).uv[0] - projectTo(right, [0, Y, 1.2]).uv[0];
    expect(d(D / 2)).toBeGreaterThan(0);
    expect(d(2 * D)).toBeLessThan(0);
    expect(d(D)).toBeCloseTo(0, 9);
  });
});

describe('rectification', () => {
  const R = rectifyingRotation(left, right);
  const H = [rectifyingHomography(left, R), rectifyingHomography(right, R)];

  it('is a rotation with x along the baseline and y down', () => {
    expect(R.slice(0, 3).map((v) => +v.toFixed(12))).toEqual([1, 0, 0]);
    expect(R.slice(3, 6).map((v) => +v.toFixed(12))).toEqual([0, 0, -1]);
  });

  it('puts corresponding points on the same row, with a positive disparity f c / Z', () => {
    for (const X of [[0.5, 3, 2], [-1, 7, 0], [2, 12, 3.5]] as Vec3[]) {
      const l = applyH(H[0], projectTo(left, X).uv);
      const r = applyH(H[1], projectTo(right, X).uv);
      expect(l[1]).toBeCloseTo(r[1], 9);
      expect(l[0] - r[0]).toBeCloseTo((360 * 0.4) / X[1], 9);
    }
  });

  it('matches projecting with the rotated camera directly', () => {
    const rotated = snapshot(K, { C: left.C, yaw: 0, pitch: 0, roll: 0 });
    const X: Vec3 = [1, 5, 2];
    const a = applyH(H[0], projectTo(left, X).uv);
    const b = projectTo(rotated, X).uv;
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[1]).toBeCloseTo(b[1], 9);
  });

  it('leaves parallel cameras unchanged', () => {
    const [l, r] = cameras(K, 0.4, 0, 1.2);
    const Hl = rectifyingHomography(l, rectifyingRotation(l, r));
    expect(Hl.map((v) => +v.toFixed(9))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(fixationDistance(0.4, 0)).toBe(Infinity);
  });
});
