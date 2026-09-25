import { describe, expect, it } from 'vitest';
import { correlate, correlateSeparable, gaussianKernel, outerProduct } from '../../src/shared/filter';
import { createPlane } from '../../src/shared/image';
import {
  convolve1D,
  kernelVariance,
  maxAbsDifference,
  multiplications,
  repeatedBox,
  repeatedBoxVariance,
  sampledGaussian,
} from './separable';

describe('1D convolution', () => {
  it('of two boxes of width 3 is a triangle', () => {
    const k = convolve1D(Float32Array.of(1, 1, 1), Float32Array.of(1, 1, 1));
    expect(Array.from(k)).toEqual([1, 2, 3, 2, 1]);
  });
});

describe('repeated box filter', () => {
  it('has width n(w − 1) + 1 and sums to 1', () => {
    const k = repeatedBox(5, 3);
    expect(k.length).toBe(13);
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('has variance n(w² − 1) / 12', () => {
    for (const [w, n] of [
      [3, 1],
      [5, 2],
      [7, 4],
    ]) {
      expect(kernelVariance(repeatedBox(w, n))).toBeCloseTo(repeatedBoxVariance(w, n), 5);
    }
  });

  it('approaches the Gaussian of equal variance', () => {
    const deviation = (n: number) => {
      const k = repeatedBox(3, n);
      return maxAbsDifference(k, sampledGaussian(Math.sqrt(repeatedBoxVariance(3, n)), (k.length - 1) / 2));
    };
    expect(deviation(4)).toBeLessThan(deviation(1));
    expect(deviation(6)).toBeLessThan(0.01);
  });
});

describe('separable Gaussian', () => {
  const g = gaussianKernel(1.3);

  it('the 2D kernel is an outer product: rank 1 and sum 1', () => {
    const k = outerProduct(g, g);
    const at = (u: number, v: number) => k.data[v * k.width + u];
    expect(k.data.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // Every 2 × 2 minor of a rank-1 matrix vanishes.
    expect(at(1, 2) * at(4, 5) - at(4, 2) * at(1, 5)).toBeCloseTo(0, 9);
    expect(at(3, 3) * at(0, 6) - at(0, 3) * at(3, 6)).toBeCloseTo(0, 9);
  });

  it('two 1D passes give the same result as the 2D kernel', () => {
    const img = createPlane(15, 11);
    img.data.forEach((_, i) => (img.data[i] = ((i * 5) % 7) / 7));
    const sep = correlateSeparable(img, g, g, 'reflect');
    const direct = correlate(img, outerProduct(g, g), 'reflect');
    expect(maxAbsDifference(sep.data, direct.data)).toBeLessThan(1e-6);
  });

  it('needs P + Q instead of P · Q multiplications per pixel', () => {
    expect(multiplications(640, 480, 9, 9)).toEqual({ direct: 640 * 480 * 81, separable: 640 * 480 * 18 });
  });
});
