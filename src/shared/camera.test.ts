import { describe, expect, it } from 'vitest';
import type { Vec3 } from './linalg';
import { det3, mulMat3, transpose3 } from './linalg';
import {
  backproject,
  buildK,
  buildP,
  buildR,
  buildT,
  cameraCenter,
  cameraToWorldRotation,
  clipSegmentNear,
  fieldOfView,
  lookAtAngles,
  project,
  projectP,
} from './camera';

const K = buildK({ fx: 500, fy: 450, u0: 320, v0: 240, skew: 0 });

function expectVecClose(a: readonly number[], b: readonly number[], digits = 9) {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
}

describe('rotation', () => {
  it('is a proper rotation for arbitrary angles', () => {
    const R = buildR(33, -12, 71);
    expectVecClose(mulMat3(R, transpose3(R)), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(det3(R)).toBeCloseTo(1);
  });

  it('looks along world +Y with x right and y down at zero angles', () => {
    const Rwc = cameraToWorldRotation(0, 0, 0);
    // Columns: camera x, y, z axes in world coordinates.
    expectVecClose([Rwc[0], Rwc[3], Rwc[6]], [1, 0, 0]);
    expectVecClose([Rwc[1], Rwc[4], Rwc[7]], [0, 0, -1]);
    expectVecClose([Rwc[2], Rwc[5], Rwc[8]], [0, 1, 0]);
  });

  it('positive pitch looks up', () => {
    const Rwc = cameraToWorldRotation(0, 30, 0);
    expect(Rwc[8]).toBeGreaterThan(0); // forward axis has positive world z
  });
});

describe('projection', () => {
  it('projects a point on the optical axis to the principal point', () => {
    const R = buildR(0, 0, 0);
    const t = buildT(R, [0, 0, 0]);
    const p = project(K, R, t, [0, 5, 0]);
    expect(p.inFront).toBe(true);
    expect(p.depth).toBeCloseTo(5);
    expectVecClose(p.uv, [320, 240]);
  });

  it('projects a known point to the expected pixel', () => {
    // Camera at origin looking along +Y: world (1, 4, 0.5) → camera (1, -0.5, 4).
    const R = buildR(0, 0, 0);
    const t = buildT(R, [0, 0, 0]);
    const p = project(K, R, t, [1, 4, 0.5]);
    expectVecClose(p.Xc, [1, -0.5, 4]);
    expectVecClose(p.uv, [320 + (500 * 1) / 4, 240 + (450 * -0.5) / 4]);
  });

  it('agrees with P = K[R|t]', () => {
    const R = buildR(20, -15, 5);
    const t = buildT(R, [1, -6, 2]);
    const P = buildP(K, R, t);
    const X: Vec3 = [0.3, 0.2, 0.7];
    const a = project(K, R, t, X);
    const b = projectP(P, X);
    expectVecClose(a.uv, b.uv);
    expect(a.depth).toBeCloseTo(b.depth);
  });

  it('flags points behind the camera', () => {
    const R = buildR(0, 0, 0);
    const t = buildT(R, [0, 0, 0]);
    expect(project(K, R, t, [0, -2, 0]).inFront).toBe(false);
  });

  it('includes skew in the u coordinate', () => {
    const Ks = buildK({ fx: 500, fy: 500, u0: 320, v0: 240, skew: 100 });
    const R = buildR(0, 0, 0);
    const t = buildT(R, [0, 0, 0]);
    // camera coords (0, -1, 2): u = fx·0/2 + s·(-1)/2 + u0
    const p = project(Ks, R, t, [0, 2, 1]);
    expectVecClose(p.uv, [320 - 50, 240 - 250]);
  });
});

describe('extrinsics', () => {
  it('t = -R C and C = -Rᵀ t are consistent', () => {
    const C: Vec3 = [2, -3, 1.5];
    const R = buildR(40, 10, -20);
    const t = buildT(R, C);
    expectVecClose(cameraCenter(R, t), C);
  });

  it('the camera center maps to the camera origin', () => {
    const C: Vec3 = [2, -3, 1.5];
    const R = buildR(40, 10, -20);
    const t = buildT(R, C);
    expectVecClose(project(K, R, t, C).Xc, [0, 0, 0]);
  });

  it('lookAtAngles puts the target on the principal point', () => {
    const C: Vec3 = [3, -5, 2.5];
    const target: Vec3 = [0.2, 0.1, 0.4];
    const { yaw, pitch } = lookAtAngles(C, target);
    const R = buildR(yaw, pitch, 0);
    const t = buildT(R, C);
    const p = project(K, R, t, target);
    expect(p.inFront).toBe(true);
    expectVecClose(p.uv, [320, 240], 6);
  });
});

describe('field of view', () => {
  it('follows AFOV = 2·arctan(H / 2f)', () => {
    const fov = fieldOfView({ fx: 320, fy: 240, u0: 320, v0: 240, skew: 0 }, 640, 480);
    expect(fov.h).toBeCloseTo(90);
    expect(fov.v).toBeCloseTo(90);
  });
});

describe('backprojection', () => {
  it('round-trips with projection', () => {
    const Ks = buildK({ fx: 520, fy: 480, u0: 300, v0: 250, skew: 12 });
    const R = buildR(-25, 8, 14);
    const t = buildT(R, [1, -4, 1.2]);
    const X = backproject(Ks, R, t, 123.4, 321.5, 3.7);
    const p = project(Ks, R, t, X);
    expectVecClose(p.uv, [123.4, 321.5], 6);
    expect(p.depth).toBeCloseTo(3.7);
  });
});

describe('clipSegmentNear', () => {
  it('keeps, drops and cuts segments', () => {
    expect(clipSegmentNear([0, 0, 1], [0, 0, 2], 0.1)).toEqual([[0, 0, 1], [0, 0, 2]]);
    expect(clipSegmentNear([0, 0, -1], [0, 0, -2], 0.1)).toBeNull();
    const clipped = clipSegmentNear([0, 0, -1], [2, 0, 1], 0)!;
    expectVecClose(clipped[0], [1, 0, 0]);
    expectVecClose(clipped[1], [2, 0, 1]);
  });
});
