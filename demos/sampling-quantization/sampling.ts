/**
 * Sampling and quantization of an image.
 *
 *  - Sampling keeps one value per s × s cell of the original: either the value at the cell center ('point') or the
 *    average over the cell ('area', like a sensor pixel that collects all light falling on it).
 *  - Quantization with b bits allows L = 2^b levels: q(v) = round(v·(L − 1)) / (L − 1) for v in [0, 1].
 */

import { luma } from '../../src/shared/color';
import { type RGBImage, createImage, mapPixels } from '../../src/shared/image';

export type SampleMode = 'point' | 'area';

export function downsample(img: RGBImage, step: number, mode: SampleMode): RGBImage {
  const w = Math.floor(img.width / step);
  const h = Math.floor(img.height / step);
  const out = createImage(w, h);
  const offset = Math.floor(step / 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let v: number;
        if (mode === 'point') {
          v = img.data[((y * step + offset) * img.width + x * step + offset) * 3 + c];
        } else {
          v = 0;
          for (let dy = 0; dy < step; dy++)
            for (let dx = 0; dx < step; dx++) v += img.data[((y * step + dy) * img.width + x * step + dx) * 3 + c];
          v /= step * step;
        }
        out.data[(y * w + x) * 3 + c] = v;
      }
  return out;
}

/** Enlarges by repeating each sample `step` times, so the result lines up with the original. */
export function upsampleNearest(img: RGBImage, step: number, width: number, height: number): RGBImage {
  const out = createImage(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / step));
      const sy = Math.min(img.height - 1, Math.floor(y / step));
      out.data.set(img.data.subarray((sy * img.width + sx) * 3, (sy * img.width + sx) * 3 + 3), (y * width + x) * 3);
    }
  return out;
}

export const levels = (bits: number) => 2 ** bits;

export function quantizeValue(v: number, bits: number): number {
  const n = levels(bits) - 1;
  return Math.round(v * n) / n;
}

export function quantize(img: RGBImage, bits: number): RGBImage {
  return mapPixels(img, ([r, g, b]) => [quantizeValue(r, bits), quantizeValue(g, bits), quantizeValue(b, bits)]);
}

export function toGray(img: RGBImage): RGBImage {
  return mapPixels(img, (rgb) => {
    const y = luma(rgb);
    return [y, y, y];
  });
}

/** Storage for w × h samples with `channels` channels of `bits` bits each. */
export const storageBits = (w: number, h: number, channels: number, bits: number) => w * h * channels * bits;
