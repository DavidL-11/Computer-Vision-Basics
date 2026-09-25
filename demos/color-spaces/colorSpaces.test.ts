import { describe, expect, it } from 'vitest';
import type { RGB } from '../../src/shared/image';
import { type Space, fromSpace, hsvToRgb, interpolate, rgbToHsv, rgbToLab, toSpace } from './colorSpaces';

const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('HSV', () => {
  it('converts primary colors', () => {
    close(rgbToHsv([1, 0, 0]), [0, 1, 1]);
    close(rgbToHsv([0, 1, 0]), [120, 1, 1]);
    close(rgbToHsv([0, 0, 1]), [240, 1, 1]);
    close(rgbToHsv([0.5, 0.5, 0.5]), [0, 0, 0.5]);
  });

  it('converts back', () => {
    close(hsvToRgb([300, 0.5, 0.8]), [0.8, 0.4, 0.8]);
  });
});

describe('L*a*b*', () => {
  it('white is L* = 100 without chroma, black is 0', () => {
    close(rgbToLab([1, 1, 1]), [100, 0, 0], 3);
    close(rgbToLab([0, 0, 0]), [0, 0, 0], 6);
  });

  it('matches the reference value for sRGB red', () => {
    close(rgbToLab([1, 0, 0]), [53.24, 80.09, 67.2], 1);
  });
});

describe('round trips', () => {
  const colors: RGB[] = [
    [0.1, 0.7, 0.3],
    [0.9, 0.9, 0.2],
    [0.05, 0.02, 0.6],
  ];
  for (const space of ['rgb', 'hsv', 'ycbcr', 'lab'] as Space[]) {
    it(space, () => colors.forEach((c) => close(fromSpace(space, toSpace(space, c)), c, 5)));
  }
});

describe('interpolation', () => {
  const a: RGB = [1, 0, 0];
  const b: RGB = [0, 0, 1];

  it('starts and ends at the two colors', () => {
    for (const space of ['rgb', 'hsv', 'ycbcr', 'lab'] as Space[]) {
      close(interpolate(space, a, b, 0), a, 5);
      close(interpolate(space, a, b, 1), b, 5);
    }
  });

  it('RGB and YCbCr give the same colors, since YCbCr is an affine map of RGB', () => {
    close(interpolate('ycbcr', a, b, 0.3), interpolate('rgb', a, b, 0.3), 9);
  });

  it('HSV goes the short way around the hue circle', () => {
    // Red (0°) to blue (240°): the short way passes magenta at 300°.
    close(rgbToHsv(interpolate('hsv', a, b, 0.5)), [300, 1, 1]);
  });
});
