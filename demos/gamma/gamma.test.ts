import { describe, expect, it } from 'vitest';
import { luma } from '../../src/shared/color';
import { createImage, getPixel } from '../../src/shared/image';
import { adjustChannels, adjustLuma, blur, decodeGamma, encodeGamma } from './gamma';

describe('gamma 2.2', () => {
  it('pixel value 186 is about half the light', () => {
    expect(encodeGamma(0.5, 2.2) * 255).toBeCloseTo(186, 0);
    expect(decodeGamma(128 / 255, 2.2)).toBeCloseTo(0.22, 2);
  });
});

describe('blur', () => {
  // Alternating black and white columns: strong blurring leaves the average.
  const stripes = createImage(40, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 40; x++) stripes.data.fill(x % 2, (y * 40 + x) * 3, (y * 40 + x) * 3 + 3);

  it('in encoded values, black and white average to 0.5 (too dark)', () => {
    expect(getPixel(blur(stripes, 4, 'encoded'), 20, 2)[0]).toBeCloseTo(0.5, 2);
  });

  it('in linear light, they average to half the intensity: about 188 / 255', () => {
    expect(getPixel(blur(stripes, 4, 'linear'), 20, 2)[0] * 255).toBeCloseTo(187.5, 0);
  });
});

describe('gamma adjustment', () => {
  const img = createImage(1, 1);
  img.data.set([0.8, 0.4, 0.2]);

  it('per channel changes the ratios between channels', () => {
    const [r, g] = getPixel(adjustChannels(img, 2), 0, 0);
    expect(r / g).toBeCloseTo(4, 6);
  });

  it('on luma keeps the ratios and applies the curve to Y′', () => {
    const out = getPixel(adjustLuma(img, 2), 0, 0);
    expect(out[0] / out[1]).toBeCloseTo(2, 6);
    expect(luma(out)).toBeCloseTo(luma([0.8, 0.4, 0.2]) ** 2, 6);
  });
});
