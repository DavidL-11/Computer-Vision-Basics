import { describe, expect, it } from 'vitest';
import { lookAtAngles, projectP, snapshot } from './camera';
import { type Mat3, type Vec3, cross, det3, mulMat3Vec } from './linalg';
import { pointLineDistance } from './lines';
import { multiply } from './matrix';
import { epipolarLine, epipolarLineT, epipolarResidual, epipoles, mulP, pseudoInverseP, rowsOfP, skew, toPixel, twoView, unitF } from './epipolar';

const target: Vec3 = [0, 0, 0.5];
function camera(C: Vec3, f: number) {
  const { yaw, pitch } = lookAtAngles(C, target);
  return snapshot({ fx: f, fy: f, u0: 320, v0: 240, skew: 0 }, { C, yaw, pitch, roll: 0 });
}
const cam0 = camera([-0.6, -4, 1.6], 700);
const cam1 = camera([1.2, -3.6, 1.4], 900);
const points: Vec3[] = [
  [0, 0, 0],
  [0.5, 0.3, 1],
  [-0.7, 0.4, 0.2],
  [0.2, -0.8, 0.9],
  [-0.3, 1.1, 1.3],
];
const pixel = (P: typeof cam0.P, X: Vec3) => projectP(P, X).uv;

describe('cross-product matrix', () => {
  it('[v]× m = v × m', () => {
    const v: Vec3 = [1, -2, 3];
    const m: Vec3 = [0.5, 4, -1];
    expect(mulMat3Vec(skew(v), m)).toEqual(cross(v, m));
  });
});

describe('projection matrix anatomy', () => {
  it('P P⁺ = I', () => {
    const PPplus = multiply(rowsOfP(cam0.P), pseudoInverseP(cam0.P));
    PPplus.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)));
  });

  it('the camera center is the right null space of P', () => {
    const { C0, C1 } = twoView(cam0.P, cam1.P);
    C0.slice(0, 3).forEach((v, i) => expect(v).toBeCloseTo(cam0.C[i], 9));
    C1.slice(0, 3).forEach((v, i) => expect(v).toBeCloseTo(cam1.C[i], 9));
    mulP(cam0.P, C0).forEach((v) => expect(v).toBeCloseTo(0, 6));
  });
});

describe('fundamental matrix from two cameras', () => {
  const view = twoView(cam0.P, cam1.P);
  const F = unitF(view.F);

  it('satisfies the epipolar constraint for every 3D point', () => {
    for (const X of points) {
      const x0 = pixel(cam0.P, X);
      const x1 = pixel(cam1.P, X);
      expect(pointLineDistance(epipolarLine(F, x0), x1)).toBeCloseTo(0, 8);
      expect(pointLineDistance(epipolarLineT(F, x1), x0)).toBeCloseTo(0, 8);
      expect(epipolarResidual(F, x0, x1)).toBeCloseTo(0, 8);
    }
  });

  it('has rank 2, with the epipoles as null vectors', () => {
    expect(det3(F)).toBeCloseTo(0, 12);
    mulMat3Vec(F, view.e0).forEach((v) => expect(v / Math.hypot(...view.e0)).toBeCloseTo(0, 10));
    const Ft = [F[0], F[3], F[6], F[1], F[4], F[7], F[2], F[5], F[8]] as Mat3;
    mulMat3Vec(Ft, view.e1).forEach((v) => expect(v / Math.hypot(...view.e1)).toBeCloseTo(0, 10));
  });

  it('puts each epipole at the image of the other camera center', () => {
    const e1 = toPixel(view.e1)!;
    pixel(cam1.P, cam0.C).forEach((v, i) => expect(e1[i]).toBeCloseTo(v, 8));
    const { e0, e1: e1FromF } = epipoles(F);
    toPixel(e0)!.forEach((v, i) => expect(v).toBeCloseTo(pixel(cam0.P, cam1.C)[i], 6));
    toPixel(e1FromF)!.forEach((v, i) => expect(v).toBeCloseTo(e1[i], 6));
  });

  it('sends all epipolar lines through the epipole', () => {
    const e1 = toPixel(view.e1)!;
    for (const X of points) expect(pointLineDistance(epipolarLine(F, pixel(cam0.P, X)), e1)).toBeCloseTo(0, 6);
  });

  it('has epipoles at infinity for parallel cameras shifted along x', () => {
    const a = snapshot({ fx: 800, fy: 800, u0: 320, v0: 240, skew: 0 }, { C: [0, 0, 1], yaw: 0, pitch: 0, roll: 0 });
    const b = snapshot({ fx: 800, fy: 800, u0: 320, v0: 240, skew: 0 }, { C: [0.5, 0, 1], yaw: 0, pitch: 0, roll: 0 });
    const v = twoView(a.P, b.P);
    expect(toPixel(v.e0)).toBeNull();
    expect(toPixel(v.e1)).toBeNull();
    // The epipolar lines are horizontal: l = (0, b, c).
    const l = epipolarLine(v.F, [100, 200]);
    expect(l[0] / Math.hypot(l[0], l[1])).toBeCloseTo(0, 10);
    expect(-l[2] / l[1]).toBeCloseTo(200, 8);
  });
});

describe('scaling F', () => {
  it('normalizes to unit norm and matches the sign of a reference', () => {
    const F = twoView(cam0.P, cam1.P).F;
    const a = unitF(F);
    const b = unitF(F.map((v) => -3 * v) as Mat3, a);
    expect(Math.hypot(...a)).toBeCloseTo(1, 12);
    b.forEach((v, i) => expect(v).toBeCloseTo(a[i], 12));
  });
});
