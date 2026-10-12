import { describe, expect, it } from 'vitest';
import { eigen } from '../../src/shared/harris';
import { createPlane } from '../../src/shared/image';
import { svd } from '../../src/shared/svd';
import { type Mat2, approximate, det2, energy, mul2, planeToMatrix, solve2, stages, storage, svd2 } from './svd2';

const close = (a: readonly number[], b: readonly number[], digits = 10) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('svd2', () => {
  const cases: Record<string, Mat2> = {
    general: [1.2, 0.8, -0.4, 0.9],
    mirror: [-1, 0, 0, 1],
    shear: [1, 1, 0, 1],
    singular: [1, 2, 0.5, 1],
  };
  for (const [name, A] of Object.entries(cases)) {
    it(`splits ${name} into rotate · scale · rotate with det V = 1`, () => {
      const s = svd2(A);
      expect(det2(s.V)).toBeCloseTo(1, 12);
      expect(s.mirrored).toBe(det2(A) < -1e-12);
      for (const x of [
        [1, 0],
        [0.3, -0.7],
      ] as [number, number][])
        close(stages(s, x)[3], mul2(A, x));
    });
  }

  it('has σᵢ² equal to the eigenvalues of AᵀA', () => {
    const A: Mat2 = [1.2, 0.8, -0.4, 0.9];
    const [a, b, c, d] = A;
    const { l1, l2 } = eigen(a * a + c * c, a * b + c * d, b * b + d * d);
    const { sigma } = svd2(A);
    expect(sigma[0] ** 2).toBeCloseTo(l1, 12);
    expect(sigma[1] ** 2).toBeCloseTo(l2, 12);
  });

  it('maps v₁ to σ₁u₁', () => {
    const s = svd2([2, 1, 1, 3]);
    close(mul2([2, 1, 1, 3], [s.V[0], s.V[2]]), [s.sigma[0] * s.U[0], s.sigma[0] * s.U[2]]);
  });
});

describe('solve2', () => {
  it('inverts a regular matrix', () => {
    const A: Mat2 = [1.2, 0.8, -0.4, 0.9];
    const sol = solve2(A, svd2(A), [1, 0.5], 1e-9);
    close(sol.Ax, [1, 0.5]);
    expect(sol.inverted).toEqual([true, true]);
  });

  it('drops 1/σ₂ for a singular matrix and returns the least-squares, minimum-norm x', () => {
    const A: Mat2 = [1, 2, 0.5, 1];
    const s = svd2(A);
    expect(s.sigma[1]).toBeLessThan(1e-12);
    const b: [number, number] = [1, 1];
    const sol = solve2(A, s, b, 0.01);
    expect(sol.inverted).toEqual([true, false]);
    // A x is the projection of b onto the column space, spanned by (2, 1).
    const u = [2 / Math.sqrt(5), 1 / Math.sqrt(5)];
    const proj = u[0] * b[0] + u[1] * b[1];
    close(sol.Ax, [proj * u[0], proj * u[1]]);
    // Minimum norm: x lies in the row space, spanned by (1, 2).
    expect(sol.x[0] * 2 - sol.x[1]).toBeCloseTo(0, 12);
  });
});

describe('image approximation', () => {
  it('reproduces the image at full rank and a rank-1 image exactly with p = 1', () => {
    const p = createPlane(6, 4);
    p.data.forEach((_, i) => (p.data[i] = ((i % 6) + 1) * (Math.floor(i / 6) + 2) * 0.02));
    const s = svd(planeToMatrix(p));
    // Not exactly 0: the pixel values are stored as 32-bit floats.
    expect(s.sigma[1]).toBeLessThan(1e-6);
    approximate(s, 1).data.forEach((v, i) => expect(v).toBeCloseTo(p.data[i], 6));
    expect(energy(s.sigma, 1)).toBeCloseTo(1, 10);
  });

  it('counts storage as p(m + n + 1)', () => {
    expect(storage(120, 160, 10)).toEqual({ rankP: 2810, full: 19200 });
  });
});
