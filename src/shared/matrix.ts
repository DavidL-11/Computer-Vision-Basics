// Dense matrices of any size as arrays of rows, e.g. the 2n × 12 system of a calibration. Readable rather than
// fast: the systems in the demos have at most a few hundred rows.

export type Matrix = number[][];

export const zeros = (rows: number, cols: number): Matrix => Array.from({ length: rows }, () => new Array(cols).fill(0));

export function identity(n: number): Matrix {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

export const transpose = (A: Matrix): Matrix => A[0].map((_, j) => A.map((row) => row[j]));

export function multiply(A: Matrix, B: Matrix): Matrix {
  return A.map((row) => B[0].map((_, j) => row.reduce((sum, a, k) => sum + a * B[k][j], 0)));
}

export const matVec = (A: Matrix, x: readonly number[]): number[] => A.map((row) => row.reduce((sum, a, k) => sum + a * x[k], 0));

/** Solves the square system A x = b by Gaussian elimination with partial pivoting; null if A is (nearly) singular. */
export function solve(A: Matrix, b: readonly number[], tol = 1e-12): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  const scale = Math.max(...A.flat().map(Math.abs)) || 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) <= tol * scale) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export interface LeastSquares {
  AtA: Matrix;
  Atb: number[];
  /** null when AᵀA is singular, e.g. for vertical least squares on a vertical line. */
  x: number[] | null;
}

/** Minimizes |Ax − b|² with the normal equations AᵀA x = Aᵀb, i.e. x = (AᵀA)⁻¹Aᵀb. */
export function leastSquares(A: Matrix, b: readonly number[]): LeastSquares {
  const At = transpose(A);
  const AtA = multiply(At, A);
  const Atb = matVec(At, b);
  return { AtA, Atb, x: solve(AtA, Atb) };
}
