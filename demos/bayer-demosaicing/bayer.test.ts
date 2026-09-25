import { describe, expect, it } from 'vitest';
import { type RGBImage, createImage, getPixel } from '../../src/shared/image';
import { type Sample, demosaic, filterColor, interpolate, mosaic } from './bayer';

function fill(width: number, height: number, f: (x: number, y: number) => [number, number, number]): RGBImage {
  const img = createImage(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) img.data.set(f(x, y), (y * width + x) * 3);
  return img;
}

describe('Bayer pattern', () => {
  it('is RGGB', () => {
    expect([filterColor(0, 0), filterColor(1, 0), filterColor(0, 1), filterColor(1, 1)]).toEqual([0, 1, 1, 2]);
  });

  it('samples green twice as often as red or blue', () => {
    const counts = [0, 0, 0];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) counts[filterColor(x, y)]++;
    expect(counts).toEqual([16, 32, 16]);
  });

  it('keeps the filter channel of each pixel', () => {
    const img = fill(4, 4, (x, y) => [0.2, (x + 2 * y) / 10, 0.5]);
    const raw = mosaic(img);
    expect(raw.data[0]).toBeCloseTo(0.2);
    expect(raw.data[1]).toBeCloseTo(0.1);
    expect(raw.data[4]).toBeCloseTo(0.2);
    expect(raw.data[5]).toBeCloseTo(0.5);
  });
});

describe('demosaicing', () => {
  it('reconstructs a constant color exactly', () => {
    const img = fill(6, 6, () => [0.2, 0.5, 0.9]);
    for (const method of ['nearest', 'bilinear'] as const) {
      const out = demosaic(mosaic(img), method);
      for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBeCloseTo(img.data[i], 6);
    }
  });

  it('bilinear is exact for a linear ramp in the interior, nearest is not', () => {
    const img = fill(8, 8, (x, y) => [x / 8, y / 8, (x + y) / 16]);
    const raw = mosaic(img);
    const bilinear = demosaic(raw, 'bilinear');
    for (let y = 1; y < 7; y++)
      for (let x = 1; x < 7; x++) getPixel(bilinear, x, y).forEach((v, c) => expect(v).toBeCloseTo(getPixel(img, x, y)[c], 6));
    expect(getPixel(demosaic(raw, 'nearest'), 1, 1)[0]).not.toBeCloseTo(getPixel(img, 1, 1)[0], 3);
  });

  it('bilinear G at a red pixel averages its four neighbors', () => {
    const raw = mosaic(fill(4, 4, (x, y) => [0, x + 10 * y, 0]));
    const samples: Sample[] = [];
    const g = interpolate(raw, 2, 2, 1, 'bilinear', samples);
    expect(samples.map((s) => [s.x, s.y])).toEqual([[2, 1], [1, 2], [3, 2], [2, 3]]);
    expect(g).toBeCloseTo((12 + 21 + 23 + 32) / 4);
  });

  it('nearest takes G from the same row', () => {
    const raw = mosaic(fill(4, 4, (x, y) => [0, x + 10 * y, 0]));
    expect(interpolate(raw, 0, 0, 1, 'nearest')).toBe(1);
    expect(interpolate(raw, 1, 1, 1, 'nearest')).toBe(10);
  });
});
