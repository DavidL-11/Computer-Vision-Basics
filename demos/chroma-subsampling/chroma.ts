/**
 * Chroma subsampling: store Cb and Cr (or, for comparison, Y) at a lower resolution.
 *
 * A plane is subsampled by averaging fx × fy blocks and brought back to full size by nearest-neighbor or bilinear
 * upsampling, as a decoder would. Scheme names J:a:b count samples in a region 4 pixels wide and 2 rows high: J = 4
 * luma samples per row, a chroma samples in the first row, b in the second.
 */

import { rgbToYCbCr, yCbCrToRgb } from '../../src/shared/color';
import { type Plane, type RGBImage, clamp01, createImage, createPlane } from '../../src/shared/image';

export type Upsampling = 'nearest' | 'bilinear';
export type Target = 'chroma' | 'luma';

export function splitYCbCr(img: RGBImage): [Plane, Plane, Plane] {
  const planes = [0, 1, 2].map(() => createPlane(img.width, img.height)) as [Plane, Plane, Plane];
  for (let i = 0; i < img.width * img.height; i++) {
    const c = rgbToYCbCr([img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]]);
    planes.forEach((p, k) => (p.data[i] = c[k]));
  }
  return planes;
}

/** Decoders clamp, since subsampled chroma can combine with luma into colors outside the RGB cube. */
export function mergeYCbCr([y, cb, cr]: Plane[]): RGBImage {
  const img = createImage(y.width, y.height);
  for (let i = 0; i < y.data.length; i++) img.data.set(yCbCrToRgb([y.data[i], cb.data[i], cr.data[i]]).map(clamp01), i * 3);
  return img;
}

/** Averages each fx × fy block; blocks at the border may be smaller. */
export function subsample(p: Plane, fx: number, fy: number): Plane {
  const out = createPlane(Math.ceil(p.width / fx), Math.ceil(p.height / fy));
  for (let j = 0; j < out.height; j++)
    for (let i = 0; i < out.width; i++) {
      let sum = 0;
      let n = 0;
      for (let y = j * fy; y < Math.min(p.height, (j + 1) * fy); y++)
        for (let x = i * fx; x < Math.min(p.width, (i + 1) * fx); x++) {
          sum += p.data[y * p.width + x];
          n++;
        }
      out.data[j * out.width + i] = sum / n;
    }
  return out;
}

export function upsample(small: Plane, width: number, height: number, fx: number, fy: number, mode: Upsampling): Plane {
  const out = createPlane(width, height);
  const at = (i: number, j: number) => small.data[Math.min(small.height - 1, j) * small.width + Math.min(small.width - 1, i)];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (mode === 'nearest') {
        out.data[y * width + x] = at(Math.floor(x / fx), Math.floor(y / fy));
        continue;
      }
      // Position in sample coordinates, with samples at the centers of their blocks.
      const sx = Math.max(0, (x + 0.5) / fx - 0.5);
      const sy = Math.max(0, (y + 0.5) / fy - 0.5);
      const i = Math.floor(sx);
      const j = Math.floor(sy);
      const tx = sx - i;
      const ty = sy - j;
      out.data[y * width + x] =
        (1 - ty) * ((1 - tx) * at(i, j) + tx * at(i + 1, j)) + ty * ((1 - tx) * at(i, j + 1) + tx * at(i + 1, j + 1));
    }
  return out;
}

export interface Subsampled {
  planes: [Plane, Plane, Plane];
  image: RGBImage;
}

export function applySubsampling(img: RGBImage, fx: number, fy: number, target: Target, mode: Upsampling): Subsampled {
  const planes = splitYCbCr(img);
  const reduce = (p: Plane) => upsample(subsample(p, fx, fy), p.width, p.height, fx, fy, mode);
  const out: [Plane, Plane, Plane] = target === 'chroma' ? [planes[0], reduce(planes[1]), reduce(planes[2])] : [reduce(planes[0]), planes[1], planes[2]];
  return { planes: out, image: mergeYCbCr(out) };
}

/** Stored values per pixel, out of 3 without subsampling. */
export function samplesPerPixel(fx: number, fy: number, target: Target): number {
  const reduced = 1 / (fx * fy);
  return target === 'chroma' ? 1 + 2 * reduced : reduced + 2;
}
