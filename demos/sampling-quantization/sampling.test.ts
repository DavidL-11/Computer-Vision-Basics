import { describe, expect, it } from 'vitest';
import { createImage, getPixel } from '../../src/shared/image';
import { downsample, levels, quantize, quantizeValue, upsampleNearest } from './sampling';

function ramp(width: number, height: number) {
  const img = createImage(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) img.data.fill(x / (width - 1), (y * width + x) * 3, (y * width + x) * 3 + 3);
  return img;
}

describe('quantization', () => {
  it('has 2^b levels', () => {
    expect(levels(1)).toBe(2);
    expect(levels(8)).toBe(256);
  });

  it('rounds to the nearest level', () => {
    expect(quantizeValue(0.4, 1)).toBe(0);
    expect(quantizeValue(0.6, 1)).toBe(1);
    expect(quantizeValue(0.5, 2)).toBeCloseTo(2 / 3);
  });

  it('error is at most half a step', () => {
    for (let v = 0; v <= 1; v += 0.01) expect(Math.abs(quantizeValue(v, 3) - v)).toBeLessThanOrEqual(0.5 / 7 + 1e-12);
  });

  it('produces exactly L distinct values on a fine ramp', () => {
    const q = quantize(ramp(512, 1), 3);
    expect(new Set(q.data).size).toBe(8);
  });
});

describe('sampling', () => {
  it('reduces the size by the step', () => {
    const d = downsample(ramp(10, 7), 3, 'point');
    expect([d.width, d.height]).toEqual([3, 2]);
  });

  it('point sampling takes the cell center, area sampling the cell mean', () => {
    const img = ramp(4, 4);
    expect(getPixel(downsample(img, 2, 'point'), 1, 0)[0]).toBeCloseTo(3 / 3);
    expect(getPixel(downsample(img, 2, 'area'), 1, 0)[0]).toBeCloseTo(2.5 / 3);
  });

  it('upsampling repeats samples', () => {
    const small = downsample(ramp(4, 2), 2, 'point');
    const big = upsampleNearest(small, 2, 4, 2);
    expect(getPixel(big, 2, 1)).toEqual(getPixel(small, 1, 0));
    expect(getPixel(big, 3, 0)).toEqual(getPixel(small, 1, 0));
  });
});
