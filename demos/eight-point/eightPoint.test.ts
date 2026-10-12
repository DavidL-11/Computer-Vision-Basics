import { describe, expect, it } from 'vitest';
import { twoView, unitF } from '../../src/shared/epipolar';
import { det3 } from '../../src/shared/linalg';
import { random } from '../../src/shared/noise';
import { applyT, columnMagnitudes, epipolarDistances, epipolarRow, estimateF, normalization } from './eightPoint';
import { CAMERAS, observe, randomPoints } from './scene';

const trueF = unitF(twoView(CAMERAS[0].P, CAMERAS[1].P).F);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

describe('epipolar constraint row', () => {
  it('expands x₁ᵀ F x₀ in the order f11 … f33', () => {
    const x0: [number, number] = [3, -2];
    const x1: [number, number] = [5, 7];
    const row = epipolarRow(x0, x1);
    const direct = [x1[0], x1[1], 1].reduce((s, a, i) => s + a * [0, 1, 2].reduce((t, j) => t + trueF[3 * i + j] * [x0[0], x0[1], 1][j], 0), 0);
    expect(row.reduce((s, r, k) => s + r * trueF[k], 0)).toBeCloseTo(direct, 12);
  });
});

describe('normalization', () => {
  it('moves the centroid to 0 and the mean distance to √2', () => {
    const pts = observe(randomPoints(20, random(3)), 0, random(4)).x0;
    const T = normalization(pts);
    const q = pts.map((p) => applyT(T, p));
    expect(mean(q.map((p) => p[0]))).toBeCloseTo(0, 12);
    expect(mean(q.map((p) => p[1]))).toBeCloseTo(0, 12);
    expect(mean(q.map((p) => Math.hypot(...p)))).toBeCloseTo(Math.SQRT2, 12);
  });

  it('makes the columns of A comparable in size', () => {
    const { x0, x1 } = observe(randomPoints(20, random(3)), 0, random(4));
    const raw = columnMagnitudes(estimateF(x0, x1, { normalize: false, rank2: true }).A);
    const norm = columnMagnitudes(estimateF(x0, x1, { normalize: true, rank2: true }).A);
    expect(Math.max(...raw) / Math.min(...raw)).toBeGreaterThan(1e4);
    expect(Math.max(...norm) / Math.min(...norm)).toBeLessThan(10);
  });
});

describe('8-point algorithm', () => {
  it('recovers F exactly from 8 noise-free correspondences, with and without normalization', () => {
    const { x0, x1 } = observe(randomPoints(8, random(1)), 0, random(2));
    for (const normalize of [false, true]) {
      const F = unitF(estimateF(x0, x1, { normalize, rank2: false }).F, trueF);
      F.forEach((v, i) => expect(v).toBeCloseTo(trueF[i], 6));
    }
  });

  it('enforces rank 2', () => {
    const { x0, x1 } = observe(randomPoints(30, random(5)), 1, random(6));
    const free = estimateF(x0, x1, { normalize: true, rank2: false });
    const constrained = estimateF(x0, x1, { normalize: true, rank2: true });
    expect(free.sigmaF[2]).toBeGreaterThan(1e-6);
    expect(Math.abs(det3(unitF(constrained.F)))).toBeLessThan(1e-12);
    expect(Math.abs(det3(unitF(free.F)))).toBeGreaterThan(1e-12);
  });

  it('is more accurate with normalization when the points are noisy', () => {
    const errors = { raw: [] as number[], normalized: [] as number[] };
    const test = observe(randomPoints(100, random(99)), 0, random(98));
    for (let seed = 0; seed < 20; seed++) {
      const { x0, x1 } = observe(randomPoints(12, random(10 + seed)), 1, random(50 + seed));
      for (const normalize of [false, true]) {
        const { F } = estimateF(x0, x1, { normalize, rank2: true });
        errors[normalize ? 'normalized' : 'raw'].push(mean(epipolarDistances(F, test.x0, test.x1)));
      }
    }
    expect(mean(errors.normalized)).toBeLessThan(mean(errors.raw));
  });
});
