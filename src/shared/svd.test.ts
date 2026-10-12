import { describe, expect, it } from 'vitest';
import { type Matrix, identity, matVec, multiply, transpose } from './matrix';
import { nullVector, pseudoInverseSolve, rankApprox, svd } from './svd';
import { random } from './noise';

function expectClose(A: Matrix, B: Matrix, digits = 10) {
  expect(A.length).toBe(B.length);
  A.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(B[i][j], digits)));
}

function randomMatrix(m: number, n: number, seed: number): Matrix {
  const rand = random(seed);
  return Array.from({ length: m }, () => Array.from({ length: n }, () => 2 * rand() - 1));
}

function reconstruct({ U, sigma, V }: ReturnType<typeof svd>): Matrix {
  const US = U.map((row) => row.map((v, k) => v * sigma[k]));
  return multiply(US, transpose(V).slice(0, sigma.length));
}

describe('svd', () => {
  for (const [m, n] of [
    [5, 3],
    [3, 3],
    [8, 9],
    [2, 6],
  ]) {
    it(`reconstructs a random ${m} × ${n} matrix with orthogonal U and V`, () => {
      const A = randomMatrix(m, n, m * 10 + n);
      const s = svd(A);
      expectClose(reconstruct(s), A);
      expectClose(multiply(transpose(s.U), s.U), identity(Math.min(m, n)));
      expectClose(multiply(s.V, transpose(s.V)), identity(n));
      for (let k = 1; k < s.sigma.length; k++) expect(s.sigma[k]).toBeLessThanOrEqual(s.sigma[k - 1]);
    });
  }

  it('finds known singular values', () => {
    // [3 0; 4 5] has σ = 3√5 and √5.
    const { sigma } = svd([
      [3, 0],
      [4, 5],
    ]);
    expect(sigma[0]).toBeCloseTo(3 * Math.sqrt(5), 12);
    expect(sigma[1]).toBeCloseTo(Math.sqrt(5), 12);
  });

  it('gives σ² = eigenvalues of AᵀA', () => {
    const A = randomMatrix(4, 2, 7);
    const [[a, b], [, c]] = multiply(transpose(A), A);
    const mean = (a + c) / 2;
    const d = Math.hypot((a - c) / 2, b);
    const { sigma } = svd(A);
    expect(sigma[0] ** 2).toBeCloseTo(mean + d, 12);
    expect(sigma[1] ** 2).toBeCloseTo(mean - d, 12);
  });

  it('handles a rank-deficient matrix and still returns an orthonormal U', () => {
    const A = [
      [1, 2, 3],
      [2, 4, 6],
      [1, 1, 1],
      [0, 0, 0],
    ];
    const s = svd(A);
    expect(s.sigma[2]).toBeLessThan(1e-12);
    expectClose(multiply(transpose(s.U), s.U), identity(3));
    expectClose(reconstruct(s), A);
  });
});

describe('nullVector', () => {
  it('finds the direction that A maps to zero', () => {
    const x0 = [1, -2, 0.5, 3];
    const norm = Math.hypot(...x0);
    // Three rows orthogonal to x0, plus a fourth one that is a combination of them.
    const rows = randomMatrix(3, 4, 3).map((r) => {
      const d = r.reduce((s, v, i) => s + v * x0[i], 0) / norm ** 2;
      return r.map((v, i) => v - d * x0[i]);
    });
    const A = [...rows, rows[0].map((v, i) => v + 2 * rows[1][i])];
    const { x, svd: s } = nullVector(A);
    expect(Math.abs(x.reduce((acc, v, i) => acc + (v * x0[i]) / norm, 0))).toBeCloseTo(1, 10);
    expect(s.sigma[3]).toBeLessThan(1e-12);
    expect(Math.hypot(...matVec(A, x))).toBeLessThan(1e-12);
  });
});

describe('pseudoInverseSolve', () => {
  it('solves a square system', () => {
    const A = randomMatrix(3, 3, 11);
    const x = pseudoInverseSolve(svd(A), [1, 2, 3]);
    matVec(A, x).forEach((v, i) => expect(v).toBeCloseTo([1, 2, 3][i], 10));
  });

  it('gives the minimum-norm least-squares solution for a singular matrix', () => {
    // A maps everything onto the x-axis; the best x for b = (2, 5) has A x = (2, 0) and no part in the null space.
    const A = [
      [1, 1],
      [0, 0],
    ];
    const x = pseudoInverseSolve(svd(A), [2, 5]);
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(1, 12);
  });
});

describe('rankApprox', () => {
  it('keeps the matrix at full rank and drops the smallest part at lower rank', () => {
    const A = randomMatrix(6, 4, 5);
    const s = svd(A);
    expectClose(rankApprox(s, 4), A);
    const A3 = rankApprox(s, 3);
    // The error of the best rank-3 approximation in the Frobenius norm is σ₄.
    const err = Math.sqrt(A.flat().reduce((sum, v, i) => sum + (v - A3.flat()[i]) ** 2, 0));
    expect(err).toBeCloseTo(s.sigma[3], 10);
  });
});
