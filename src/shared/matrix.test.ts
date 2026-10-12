import { describe, expect, it } from 'vitest';
import { identity, leastSquares, matVec, multiply, solve, transpose } from './matrix';

describe('matrix basics', () => {
  it('transposes and multiplies', () => {
    const A = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(transpose(A)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
    expect(multiply(A, transpose(A))).toEqual([
      [14, 32],
      [32, 77],
    ]);
    expect(matVec(A, [1, 0, -1])).toEqual([-2, -2]);
    expect(multiply(identity(2), A)).toEqual(A);
  });
});

describe('solve', () => {
  it('solves a system that needs pivoting', () => {
    const A = [
      [0, 2, 1],
      [1, 1, 1],
      [2, 1, 0],
    ];
    const x = solve(A, [5, 6, 4])!;
    matVec(A, x).forEach((v, i) => expect(v).toBeCloseTo([5, 6, 4][i], 12));
  });

  it('reports a singular matrix', () => {
    expect(
      solve(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
  });
});

describe('leastSquares', () => {
  it('fits a line through noisy points like the normal equations', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [1.1, 2.9, 5.2, 6.8, 9.1];
    const { x } = leastSquares(
      xs.map((x) => [x, 1]),
      ys,
    );
    // Closed form of simple linear regression.
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b) / n;
    const my = ys.reduce((a, b) => a + b) / n;
    const m = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    expect(x![0]).toBeCloseTo(m, 12);
    expect(x![1]).toBeCloseTo(my - m * mx, 12);
  });

  it('is exact for a consistent system', () => {
    const A = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    expect(leastSquares(A, [2, 3, 5]).x!.map((v) => +v.toFixed(12))).toEqual([2, 3]);
  });
});
