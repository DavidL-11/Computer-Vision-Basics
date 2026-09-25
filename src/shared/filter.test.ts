import { describe, expect, it } from 'vitest';
import {
  borderIndex,
  boxKernel1D,
  convolve,
  correlate,
  correlateSeparable,
  flipKernel,
  gaussianKernel,
  kernelFromRows,
  outerProduct,
  padPlane,
} from './filter';
import { type Plane, createPlane } from './image';

function ramp(width: number, height: number): Plane {
  const p = createPlane(width, height);
  p.data.forEach((_, i) => (p.data[i] = ((i * 7) % 13) / 13));
  return p;
}

const at = (p: Plane, x: number, y: number) => p.data[y * p.width + x];

describe('border modes', () => {
  const row = kernelFromRows([[1, 2, 3]]);
  const padded = (border: Parameters<typeof padPlane>[2]) => Array.from(padPlane(row, 2, border).data.slice(14, 21));

  it('extend a row a b c by two pixels on each side', () => {
    expect(padded('zero')).toEqual([0, 0, 1, 2, 3, 0, 0]);
    expect(padded('wrap')).toEqual([2, 3, 1, 2, 3, 1, 2]);
    expect(padded('clamp')).toEqual([1, 1, 1, 2, 3, 3, 3]);
    expect(padded('reflect')).toEqual([2, 1, 1, 2, 3, 3, 2]);
  });

  it('handle offsets larger than the image', () => {
    expect(borderIndex(-7, 3, 'wrap')).toBe(2);
    expect(borderIndex(8, 3, 'reflect')).toBe(2);
    expect(borderIndex(-100, 3, 'zero')).toBe(-1);
  });
});

describe('correlation and convolution', () => {
  const img = ramp(9, 7);

  it('the identity kernel leaves the image unchanged', () => {
    const id = kernelFromRows([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    expect(correlate(img, id, 'zero').data).toEqual(img.data);
    expect(convolve(img, id, 'zero').data).toEqual(img.data);
  });

  it('shift in opposite directions with an asymmetric kernel', () => {
    // f[1, 0] = 1: correlation reads I[m + 1, n], convolution I[m − 1, n].
    const shift = kernelFromRows([
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 0],
    ]);
    const corr = correlate(img, shift, 'zero');
    const conv = convolve(img, shift, 'zero');
    expect(at(corr, 4, 3)).toBe(at(img, 5, 3));
    expect(at(conv, 4, 3)).toBe(at(img, 3, 3));
    expect(flipKernel(shift).data[3]).toBe(1);
  });

  it('agree for a symmetric kernel', () => {
    const k = outerProduct(gaussianKernel(1), gaussianKernel(1));
    expect(Array.from(convolve(img, k, 'clamp').data)).toEqual(Array.from(correlate(img, k, 'clamp').data));
  });
});

describe('separable filtering', () => {
  it('equals the direct 2D filter with the outer product kernel', () => {
    const img = ramp(12, 10);
    const g = gaussianKernel(1.2);
    const box = boxKernel1D(3);
    for (const border of ['zero', 'wrap', 'clamp', 'reflect'] as const) {
      const sep = correlateSeparable(img, g, box, border);
      const direct = correlate(img, outerProduct(g, box), border);
      sep.data.forEach((v, i) => expect(v).toBeCloseTo(direct.data[i], 6));
    }
  });
});

describe('Gaussian kernel', () => {
  it('sums to 1, is symmetric and has radius ⌈3σ⌉', () => {
    const k = gaussianKernel(1.5);
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(k[0]).toBeCloseTo(k[k.length - 1], 9);
    expect(k.length).toBe(11);
  });
});
