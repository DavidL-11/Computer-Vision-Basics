import { describe, expect, it } from 'vitest';
import { createImage, createPlane } from '../../src/shared/image';
import { applySubsampling, samplesPerPixel, subsample, upsample } from './chroma';

describe('subsampling', () => {
  it('averages blocks', () => {
    const p = createPlane(4, 2);
    p.data.set([0, 2, 4, 6, 2, 4, 6, 8]);
    const s = subsample(p, 2, 2);
    expect([s.width, s.height]).toEqual([2, 1]);
    expect(Array.from(s.data)).toEqual([2, 6]);
  });

  it('nearest upsampling repeats, bilinear interpolates between block centers', () => {
    const s = createPlane(2, 1);
    s.data.set([0, 1]);
    expect(Array.from(upsample(s, 4, 1, 2, 1, 'nearest').data)).toEqual([0, 0, 1, 1]);
    expect(Array.from(upsample(s, 4, 1, 2, 1, 'bilinear').data)).toEqual([0, 0.25, 0.75, 1]);
  });

  it('keeps a flat color unchanged', () => {
    const img = createImage(6, 4);
    for (let i = 0; i < 24; i++) img.data.set([0.8, 0.3, 0.1], i * 3);
    const out = applySubsampling(img, 2, 2, 'chroma', 'bilinear').image;
    out.data.forEach((v, i) => expect(v).toBeCloseTo(img.data[i], 6));
  });

  it('counts stored values per pixel', () => {
    expect(samplesPerPixel(1, 1, 'chroma')).toBe(3);
    expect(samplesPerPixel(2, 1, 'chroma')).toBe(2);
    expect(samplesPerPixel(2, 2, 'chroma')).toBe(1.5);
    expect(samplesPerPixel(2, 2, 'luma')).toBe(2.25);
  });
});
