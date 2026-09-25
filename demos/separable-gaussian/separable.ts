/**
 * Separability of the Gaussian and the central limit theorem for repeated box filters.
 *
 * 1D kernels are Float32Arrays of odd length with the origin in the middle.
 */

import { boxKernel1D } from '../../src/shared/filter';

/** Full 1D convolution: the result has length a + b − 1 and again its origin in the middle. */
export function convolve1D(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

/** A box of width w convolved with itself: n boxes in total, of width n(w − 1) + 1. */
export function repeatedBox(w: number, n: number): Float32Array {
  const box = boxKernel1D(w);
  let k: Float32Array = box;
  for (let i = 1; i < n; i++) k = convolve1D(k, box);
  return k;
}

/** σ² = Σ x² B(x) for a kernel B with sum 1 and mean 0. */
export function kernelVariance(k: Float32Array): number {
  const r = (k.length - 1) / 2;
  return k.reduce((sum, v, i) => sum + (i - r) ** 2 * v, 0);
}

/** Variance of n box filters of width w: each contributes (w² − 1) / 12. */
export const repeatedBoxVariance = (w: number, n: number) => (n * (w * w - 1)) / 12;

/** The Gaussian density with standard deviation σ, sampled on −r … r (not normalized to sum 1). */
export function sampledGaussian(sigma: number, r: number): Float32Array {
  return Float32Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)) / (Math.sqrt(2 * Math.PI) * sigma));
}

/** Multiplications for filtering an M × N image with a P × Q kernel, directly and as two 1D passes. */
export function multiplications(M: number, N: number, P: number, Q: number): { direct: number; separable: number } {
  return { direct: M * N * P * Q, separable: M * N * (P + Q) };
}

export function maxAbsDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}
