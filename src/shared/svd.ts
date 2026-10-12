/**
 * Singular value decomposition A = U Σ Vᵀ by one-sided Jacobi rotations (Hestenes).
 *
 * Idea: rotate pairs of columns of A until all columns are orthogonal to each other. Each rotation is also applied
 * to V (starting from I), so at the end A V = W with orthogonal columns wⱼ. Then σⱼ = |wⱼ| and uⱼ = wⱼ / σⱼ, i.e.
 * A V = U Σ and, since V is orthogonal, A = U Σ Vᵀ.
 *
 * Conventions:
 *  - A is m × n (row arrays, see matrix.ts). With k = min(m, n), U is m × k, σ has k entries sorted descending and
 *    V is always the full n × n matrix, so for m < n (e.g. 8 equations, 9 unknowns) its last columns span the null
 *    space of A.
 *  - Columns of U whose σ is 0 are completed to an orthonormal set.
 */

import { type Matrix, zeros } from './matrix';

export interface SVD {
  U: Matrix;
  sigma: number[];
  V: Matrix;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function svd(A: Matrix, maxSweeps = 60): SVD {
  const m = A.length;
  const n = A[0].length;
  // Columns as arrays: the rotations act on whole columns.
  const W = Array.from({ length: n }, (_, j) => Float64Array.from(A, (row) => row[j]));
  const V = Array.from({ length: n }, (_, j) => Float64Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const alpha = dot(W[p], W[p]);
        const beta = dot(W[q], W[q]);
        const gamma = dot(W[p], W[q]);
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta)) continue;
        rotated = true;
        // The angle that makes columns p and q orthogonal: tan(2θ) = 2γ / (β − α); t = tan θ, the smaller root.
        const zeta = (beta - alpha) / (2 * gamma);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (const X of [W, V]) {
          const a = X[p], b = X[q];
          for (let i = 0; i < a.length; i++) {
            const ai = a[i];
            a[i] = c * ai - s * b[i];
            b[i] = s * ai + c * b[i];
          }
        }
      }
    }
    if (!rotated) break;
  }

  const order = W.map((w, j) => ({ j, norm: Math.sqrt(dot(w, w)) })).sort((a, b) => b.norm - a.norm);
  const k = Math.min(m, n);
  const sigma = order.slice(0, k).map((o) => o.norm);
  const tol = (sigma[0] || 1) * 1e-13 * Math.max(m, n);
  const Ucols: Float64Array[] = [];
  for (let c = 0; c < k; c++) {
    const { j, norm } = order[c];
    Ucols.push(norm > tol ? W[j].map((v) => v / norm) : completeBasis(Ucols, m));
  }
  const U = zeros(m, k);
  Ucols.forEach((u, c) => u.forEach((v, i) => (U[i][c] = v)));
  const Vout = zeros(n, n);
  order.forEach(({ j }, c) => V[j].forEach((v, i) => (Vout[i][c] = v)));
  return { U, sigma, V: Vout };
}

/** A unit vector orthogonal to all given ones (Gram–Schmidt on the standard basis). */
function completeBasis(basis: Float64Array[], m: number): Float64Array {
  let best = new Float64Array(m);
  let bestNorm = 0;
  for (let e = 0; e < m; e++) {
    const v = Float64Array.from({ length: m }, (_, i) => (i === e ? 1 : 0));
    for (const u of basis) {
      const d = u[e];
      for (let i = 0; i < m; i++) v[i] -= d * u[i];
    }
    const norm = Math.sqrt(dot(v, v));
    if (norm > bestNorm) [best, bestNorm] = [v, norm];
  }
  return best.map((v) => v / bestNorm);
}

export const column = (M: Matrix, j: number): number[] => M.map((row) => row[j]);

/** Minimizes |Ax|² subject to |x| = 1: the right singular vector of the smallest singular value. */
export function nullVector(A: Matrix): { x: number[]; svd: SVD } {
  const s = svd(A);
  return { x: column(s.V, s.V.length - 1), svd: s };
}

/**
 * x = V Σ⁻¹ Uᵀ b. Only singular values above `rtol` · σ₁ are inverted, the others are treated as 0. This gives the
 * least-squares solution of Ax = b, and among those the one of minimum norm.
 */
export function pseudoInverseSolve({ U, sigma, V }: SVD, b: readonly number[], rtol = 1e-10): number[] {
  const x = new Array(V.length).fill(0);
  sigma.forEach((s, k) => {
    if (s <= rtol * sigma[0]) return;
    const coef = U.reduce((sum, row, i) => sum + row[k] * b[i], 0) / s;
    for (let i = 0; i < x.length; i++) x[i] += coef * V[i][k];
  });
  return x;
}

/** Rank-p approximation aᵢⱼ ≈ Σₖ₌₁ᵖ uᵢₖ σₖ vⱼₖ. */
export function rankApprox({ U, sigma, V }: SVD, p: number): Matrix {
  const out = zeros(U.length, V.length);
  for (let k = 0; k < Math.min(p, sigma.length); k++)
    for (let i = 0; i < U.length; i++) {
      const us = U[i][k] * sigma[k];
      if (us === 0) continue;
      const row = out[i];
      for (let j = 0; j < V.length; j++) row[j] += us * V[j][k];
    }
  return out;
}
