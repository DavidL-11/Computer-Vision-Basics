import { describe, expect, it } from 'vitest';
import { buildK } from '../../src/shared/camera';
import { type Vec3, identity3 } from '../../src/shared/linalg';
import { type Motion, deltaRotation, depthFromFlow, focusOfExpansion, moveCamera, nextPose, pointFlow, toCamera } from './egomotion';
import { INTRINSICS } from './scene';

const K = buildK(INTRINSICS);
const still: Motion = { T: [0, 0, 0], pan: 0, tilt: 0, roll: 0 };
const cross2 = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];

describe('camera motion', () => {
  it('moves points opposite to the camera', () => {
    expect(moveCamera([1, 2, 10], { ...still, T: [0.5, 0, 1] })).toEqual([0.5, 2, 9]);
  });

  it('pans to the right: a point straight ahead moves left in the image', () => {
    const f = pointFlow(K, [0, 0, 10], { ...still, pan: 2 });
    expect(f.x1[0]).toBeLessThan(f.x0[0]);
    expect(f.x1[1]).toBeCloseTo(f.x0[1], 9);
    expect(deltaRotation({ ...still, pan: 90 }).map((v) => +v.toFixed(12))).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
  });

  it('tilts up: a point straight ahead moves down in the image', () => {
    const f = pointFlow(K, [0, 0, 10], { ...still, tilt: 2 });
    expect(f.x1[1]).toBeGreaterThan(f.x0[1]);
  });

  it('keeps world points consistent over a sequence of poses', () => {
    const m: Motion = { T: [0.2, -0.1, 0.5], pan: 1, tilt: -0.5, roll: 0.3 };
    const pose = { R: identity3(), C: [0, 0, 0] as Vec3 };
    const X: Vec3 = [1, -0.5, 8];
    const next = nextPose(pose, m);
    const a = toCamera(next, X), b = moveCamera(toCamera(pose, X), m);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
  });
});

describe('translational flow', () => {
  it('is f·T/Z for sideways motion: near points move faster (parallax)', () => {
    const m = { ...still, T: [0.5, 0, 0] as Vec3 };
    for (const Z of [2, 5, 20]) {
      const f = pointFlow(K, [1, 0.5, Z], m);
      expect(f.x1[0] - f.x0[0]).toBeCloseTo((-INTRINSICS.fx * 0.5) / Z, 9);
      expect(f.x1[1]).toBeCloseTo(f.x0[1], 9);
    }
  });

  it('radiates from the focus of expansion for forward motion', () => {
    const T: Vec3 = [0.3, -0.1, 1];
    const e = focusOfExpansion(K, T)!;
    for (const Xc of [[2, 1, 6], [-3, 0.5, 12], [0.5, -2, 9]] as Vec3[]) {
      const f = pointFlow(K, Xc, { ...still, T });
      const d0 = [f.x0[0] - e[0], f.x0[1] - e[1]];
      const d1 = [f.x1[0] - e[0], f.x1[1] - e[1]];
      expect(cross2(d0, d1)).toBeCloseTo(0, 6);
      // x₁ − e = Z / (Z − T_z) · (x₀ − e)
      expect(d1[0] / d0[0]).toBeCloseTo(Xc[2] / (Xc[2] - T[2]), 9);
    }
    expect(focusOfExpansion(K, [1, 0, 0])).toBeNull();
  });

  it('does not depend on depth for a pure rotation', () => {
    const m = { ...still, pan: 1.5, tilt: 0.5 };
    const a = pointFlow(K, [1, 1, 2], m), b = pointFlow(K, [10, 10, 20], m);
    expect(a.x1[0] - a.x0[0]).toBeCloseTo(b.x1[0] - b.x0[0], 9);
    expect(a.x1[1] - a.x0[1]).toBeCloseTo(b.x1[1] - b.x0[1], 9);
  });
});

describe('depth from flow', () => {
  it('recovers the depth when the motion is known', () => {
    const m: Motion = { T: [0.4, 0.1, 0.6], pan: 1, tilt: 0.3, roll: 0 };
    const Xc: Vec3 = [2, -1, 7];
    const f = pointFlow(K, Xc, m);
    expect(depthFromFlow(K, f.x0, f.x1, m.T, deltaRotation(m))).toBeCloseTo(7, 9);
    expect(Math.abs(depthFromFlow(K, f.x0, f.x1, m.T) - 7)).toBeGreaterThan(0.5);
  });

  it('has no answer without parallax', () => {
    expect(depthFromFlow(K, [320, 200], [320, 200], [0, 0, 1])).toBeNaN();
  });
});
