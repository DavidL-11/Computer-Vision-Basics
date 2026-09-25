/**
 * Gamma encoding and why it matters for image processing.
 *
 * Pixel values v are gamma-encoded: the light intensity is roughly v^2.2 (exactly: the sRGB curve). Operations that
 * model light, such as blurring, belong on linear intensities: decode, process, encode.
 */

import { linearToSrgb, luma, srgbToLinear } from '../../src/shared/color';
import { gaussianKernel } from '../../src/shared/filter';
import { type RGBImage, clamp01, createImage, mapPixels } from '../../src/shared/image';

export type BlurSpace = 'encoded' | 'linear';

export const decodeGamma = (v: number, gamma: number) => v ** gamma;
export const encodeGamma = (v: number, gamma: number) => v ** (1 / gamma);

/** Separable Gaussian blur, clamping coordinates at the border. */
function gaussianBlur(img: RGBImage, sigma: number): RGBImage {
  if (sigma <= 0) return img;
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const { width: w, height: h } = img;
  const pass = (src: RGBImage, dx: number, dy: number) => {
    const out = createImage(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let i = -r; i <= r; i++) {
            const sx = Math.min(w - 1, Math.max(0, x + i * dx));
            const sy = Math.min(h - 1, Math.max(0, y + i * dy));
            sum += k[i + r] * src.data[(sy * w + sx) * 3 + c];
          }
          out.data[(y * w + x) * 3 + c] = sum;
        }
    return out;
  };
  return pass(pass(img, 1, 0), 0, 1);
}

export function blur(img: RGBImage, sigma: number, space: BlurSpace): RGBImage {
  if (space === 'encoded') return gaussianBlur(img, sigma);
  const linear = mapPixels(img, (rgb) => rgb.map(srgbToLinear) as typeof rgb);
  return mapPixels(gaussianBlur(linear, sigma), (rgb) => rgb.map(linearToSrgb) as typeof rgb);
}

/** v → v^γ on every channel separately. */
export function adjustChannels(img: RGBImage, gamma: number): RGBImage {
  return mapPixels(img, ([r, g, b]) => [r ** gamma, g ** gamma, b ** gamma]);
}

/** Applies v → v^γ to the luma Y′ only and scales R, G, B by the same factor, keeping their ratios. */
export function adjustLuma(img: RGBImage, gamma: number): RGBImage {
  return mapPixels(img, (rgb) => {
    const y = luma(rgb);
    const s = y > 0 ? y ** gamma / y : 0;
    return [clamp01(rgb[0] * s), clamp01(rgb[1] * s), clamp01(rgb[2] * s)];
  });
}
