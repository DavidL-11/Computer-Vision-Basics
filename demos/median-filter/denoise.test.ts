import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { gaussianNoise, meanFilter, median, medianFilter, saltAndPepper } from './denoise';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

const at = (p: Plane, x: number, y: number) => p.data[y * p.width + x];

describe('median filter', () => {
  it('takes the middle of the sorted values', () => {
    expect(median([0.9, 0.1, 0.5, 1, 0])).toBe(0.5);
  });

  it('removes a single impulse completely', () => {
    const img = image(9, 9, (x, y) => (x === 4 && y === 4 ? 1 : 0.3));
    expect(at(medianFilter(img, 3), 4, 4)).toBeCloseTo(0.3, 6);
  });

  it('keeps a step edge exactly, where the mean blurs it', () => {
    const step = image(12, 8, (x) => (x < 6 ? 0.2 : 0.8));
    const med = medianFilter(step, 5);
    const mean = meanFilter(step, 5);
    expect(Array.from(med.data)).toEqual(Array.from(step.data));
    expect(at(mean, 5, 4)).toBeCloseTo(0.2 + 0.6 * (2 / 5), 6);
    expect(at(mean, 6, 4)).toBeCloseTo(0.2 + 0.6 * (3 / 5), 6);
  });
});

describe('noise', () => {
  const gray = image(100, 100, () => 0.5);

  it('salt and pepper hits about the given fraction of pixels', () => {
    const noisy = saltAndPepper(gray, 0.2, 1);
    const hit = noisy.data.filter((v) => v === 0 || v === 1).length;
    expect(hit / 10000).toBeGreaterThan(0.17);
    expect(hit / 10000).toBeLessThan(0.23);
  });

  it('Gaussian noise has zero mean and standard deviation σ', () => {
    const noisy = gaussianNoise(gray, 0.05, 2);
    const mean = noisy.data.reduce((a, b) => a + b, 0) / noisy.data.length;
    const sd = Math.sqrt(noisy.data.reduce((a, b) => a + (b - mean) ** 2, 0) / noisy.data.length);
    expect(mean).toBeCloseTo(0.5, 2);
    expect(sd).toBeCloseTo(0.05, 2);
  });

  it('is the same for the same seed', () => {
    expect(saltAndPepper(gray, 0.1, 5).data).toEqual(saltAndPepper(gray, 0.1, 5).data);
  });
});
