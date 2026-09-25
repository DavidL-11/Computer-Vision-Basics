import { describe, expect, it } from 'vitest';
import { createPlane } from './image';
import { gaussianNoise } from './noise';

describe('Gaussian noise', () => {
  const gray = createPlane(100, 100);
  gray.data.fill(0.5);

  it('has zero mean and standard deviation σ', () => {
    const noisy = gaussianNoise(gray, 0.05, 2);
    const mean = noisy.data.reduce((a, b) => a + b, 0) / noisy.data.length;
    const sd = Math.sqrt(noisy.data.reduce((a, b) => a + (b - mean) ** 2, 0) / noisy.data.length);
    expect(mean).toBeCloseTo(0.5, 2);
    expect(sd).toBeCloseTo(0.05, 2);
  });

  it('is the same for the same seed and stays in [0, 1]', () => {
    const a = gaussianNoise(gray, 0.4, 5);
    expect(a.data).toEqual(gaussianNoise(gray, 0.4, 5).data);
    expect(Math.min(...a.data)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a.data)).toBeLessThanOrEqual(1);
  });
});
