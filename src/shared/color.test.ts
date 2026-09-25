import { describe, expect, it } from 'vitest';
import { hexToRgb, linearToSrgb, luma, rgbToHex, rgbToYCbCr, srgbToLinear, yCbCrToRgb } from './color';
import type { RGB } from './image';

describe('sRGB', () => {
  it('maps 0 and 1 to themselves', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
  });

  it('pixel value 128 is only about 22 % of the light', () => {
    expect(srgbToLinear(128 / 255)).toBeCloseTo(0.216, 3);
  });

  it('half the light is encoded as about 188', () => {
    expect(linearToSrgb(0.5) * 255).toBeCloseTo(187.5, 0);
  });

  it('encoding inverts decoding, also in the linear segment', () => {
    for (const v of [0, 0.01, 0.04, 0.3, 0.8, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 10);
  });
});

describe('YCbCr', () => {
  it('gray has neutral chroma', () => {
    const [y, cb, cr] = rgbToYCbCr([0.4, 0.4, 0.4]);
    expect(y).toBeCloseTo(0.4, 12);
    expect(cb).toBeCloseTo(0.5, 12);
    expect(cr).toBeCloseTo(0.5, 12);
  });

  it('matches the JPEG coefficients', () => {
    // Cb = 128 − 0.168736 R − 0.331264 G + 0.5 B
    const [, cb, cr] = rgbToYCbCr([1, 0, 0]);
    expect(cb - 0.5).toBeCloseTo(-0.168736, 5);
    expect(cr - 0.5).toBeCloseTo(0.5, 12);
  });

  it('round trips', () => {
    const rgb: RGB = [0.9, 0.2, 0.55];
    yCbCrToRgb(rgbToYCbCr(rgb)).forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 12));
  });

  it('luma weights sum to 1', () => {
    expect(luma([1, 1, 1])).toBeCloseTo(1, 12);
  });
});

describe('hex', () => {
  it('round trips', () => {
    expect(rgbToHex(hexToRgb('#1a2bff'))).toBe('#1a2bff');
  });
});
