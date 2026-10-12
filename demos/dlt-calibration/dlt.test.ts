import { describe, expect, it } from 'vitest';
import { buildK, buildR, buildT, lookAtAngles, project } from '../../src/shared/camera';
import { type Mat34, type Vec3, det3, mulMat3, transpose3 } from '../../src/shared/linalg';
import { random } from '../../src/shared/noise';
import { type Vec2, calibrate, factorize, normalizeM, projectionRows, reprojectionErrors, rotationError, rq3 } from './dlt';
import { RIG_CENTER, selectPoints, xzPoints, yzPoints } from './scene';

const close = (a: readonly number[], b: readonly number[], digits: number) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

const K = buildK({ fx: 800, fy: 780, u0: 330, v0: 235, skew: 2 });
const C: Vec3 = [0.9, 0.7, 0.55];
const { yaw, pitch } = lookAtAngles(C, RIG_CENTER);
const R = buildR(yaw, pitch, 4);
const t = buildT(R, C);
const X = [...xzPoints, ...yzPoints];
const pixels = (pts: Vec3[]): Vec2[] => pts.map((p) => project(K, R, t, p).uv);

describe('projectionRows', () => {
  it('vanishes for the true M = K[R | t]', () => {
    const KR = mulMat3(K, R);
    const Kt = [K[0] * t[0] + K[1] * t[1] + K[2] * t[2], K[4] * t[1] + K[5] * t[2], t[2]];
    const m = [KR[0], KR[1], KR[2], Kt[0], KR[3], KR[4], KR[5], Kt[1], KR[6], KR[7], KR[8], Kt[2]];
    for (const row of projectionRows(X[5], pixels([X[5]])[0], 'Ax=0')) expect(row.reduce((s, v, i) => s + v * m[i], 0)).toBeCloseTo(0, 8);
  });
});

describe('rq3', () => {
  it('splits a matrix into upper triangular times orthogonal', () => {
    const Q = mulMat3(K, R);
    const { K: Kq, R: Rq } = rq3(Q);
    expect(Kq[3]).toBeCloseTo(0, 10);
    expect(Kq[6]).toBeCloseTo(0, 10);
    expect(Kq[7]).toBeCloseTo(0, 10);
    close(mulMat3(Rq, transpose3(Rq)), [1, 0, 0, 0, 1, 0, 0, 0, 1], 12);
    close(mulMat3(Kq, Rq), Q, 9);
  });
});

describe('calibrate + factorize', () => {
  for (const method of ['Ax=b', 'Ax=0'] as const) {
    it(`recovers K, R, t and C exactly without noise (${method})`, () => {
      const { M } = calibrate(X, pixels(X), method);
      const f = factorize(M!)!;
      close(f.K, K, 6);
      close(f.R, R, 8);
      close(f.t, t, 7);
      close(f.C, C, 7);
      expect(det3(f.R)).toBeCloseTo(1, 12);
    });
  }

  it('needs only 6 points', () => {
    const pts = selectPoints(6, false, random(3));
    const f = factorize(calibrate(pts, pixels(pts), 'Ax=0').M!)!;
    close(f.K, K, 5);
    close(f.C, C, 6);
  });

  it('gives the same M with both methods, up to scale', () => {
    const uv = pixels(X);
    const m1 = normalizeM(calibrate(X, uv, 'Ax=b').M!);
    const m2 = normalizeM(calibrate(X, uv, 'Ax=0').M!);
    const s = Math.sign(m1[11]) * Math.sign(m2[11]);
    close(m1, m2.map((v) => s * v), 8);
  });

  it('fixes the sign when the SVD returns −M', () => {
    const { M } = calibrate(X, pixels(X), 'Ax=0');
    const negated = M!.map((v) => -v) as Mat34;
    const a = factorize(M!)!;
    const b = factorize(negated)!;
    close(b.R, a.R, 10);
    close(b.t, a.t, 8);
    expect(a.sign * b.sign).toBe(-1);
  });

  it('has small reprojection errors and a rotation error near 0 with noise', () => {
    const rand = random(7);
    const noise = () => 0.5 * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const uv = pixels(X).map(([u, v]): Vec2 => [u + noise(), v + noise()]);
    const { M } = calibrate(X, uv, 'Ax=0');
    const errors = reprojectionErrors(M!, X, uv);
    const mean = errors.reduce((s, [du, dv]) => s + Math.hypot(du, dv), 0) / errors.length;
    expect(mean).toBeLessThan(1.5);
    expect(rotationError(factorize(M!)!.R, R)).toBeLessThan(1);
  });
});

describe('degenerate targets', () => {
  it('points on one plane leave several zero singular values in the 12-column A', () => {
    const { svd } = calibrate(xzPoints, pixels(xzPoints), 'Ax=0');
    const s = svd.sigma;
    // All points have Y = 0, so the columns of m12, m22 and m32 are zero, and the remaining 9 columns still
    // have a null vector: four zero singular values in total.
    expect(s[9] / s[0]).toBeLessThan(1e-12);
    expect(s[10] / s[0]).toBeLessThan(1e-12);
    expect(s[11] / s[0]).toBeLessThan(1e-12);
    expect(s[8] / s[0]).toBeLessThan(1e-9);
    expect(s[7] / s[0]).toBeGreaterThan(1e-9);
  });

  it('points on one plane make AᵀA singular for Method 1', () => {
    expect(calibrate(xzPoints, pixels(xzPoints), 'Ax=b').M).toBeNull();
  });

  it('a tilted plane (not a coordinate plane) is just as degenerate', () => {
    const tilted = xzPoints.map(([x, , z]): Vec3 => [x, 0.3 * x + 0.2 * z, z]);
    const s = calibrate(tilted, pixels(tilted), 'Ax=0').svd.sigma;
    expect(s[8] / s[0]).toBeLessThan(1e-9);
  });
});

describe('scene', () => {
  it('alternates between the two boards', () => {
    const pts = selectPoints(6, false, random(1));
    expect(pts.filter((p) => p[1] === 0).length).toBe(3);
    expect(selectPoints(6, true, random(1)).every((p) => p[1] === 0)).toBe(true);
  });
});
