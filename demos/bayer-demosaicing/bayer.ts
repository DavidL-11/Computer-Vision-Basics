/**
 * Bayer color filter array and demosaicing.
 *
 * Conventions:
 *  - RGGB pattern: R at (even x, even y), B at (odd x, odd y), G at the other two positions of each 2 × 2 block.
 *  - Image width and height are even.
 *  - Channels: 0 = R, 1 = G, 2 = B.
 */

import { type Plane, type RGBImage, createImage, createPlane } from '../../src/shared/image';

export type Channel = 0 | 1 | 2;
export type Method = 'nearest' | 'bilinear';

export function filterColor(x: number, y: number): Channel {
  if ((x & 1) === 0 && (y & 1) === 0) return 0;
  if ((x & 1) === 1 && (y & 1) === 1) return 2;
  return 1;
}

/** What the sensor records: one value per pixel, the channel of its color filter. */
export function mosaic(img: RGBImage): Plane {
  const raw = createPlane(img.width, img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) raw.data[y * img.width + x] = img.data[(y * img.width + x) * 3 + filterColor(x, y)];
  return raw;
}

/** Shows each raw value in its filter color, or as gray (the numbers the sensor actually stores). */
export function mosaicToImage(raw: Plane, tinted: boolean): RGBImage {
  const img = createImage(raw.width, raw.height);
  for (let y = 0; y < raw.height; y++)
    for (let x = 0; x < raw.width; x++) {
      const i = y * raw.width + x;
      if (tinted) img.data[i * 3 + filterColor(x, y)] = raw.data[i];
      else img.data.fill(raw.data[i], i * 3, i * 3 + 3);
    }
  return img;
}

export interface Sample {
  x: number;
  y: number;
  weight: number;
  value: number;
}

// Bilinear interpolation as a convolution of each sparse channel, normalized by the weights of the samples present.
const KERNEL_G = [0, 1, 0, 1, 4, 1, 0, 1, 0];
const KERNEL_RB = [1, 2, 1, 2, 4, 2, 1, 2, 1];

/** Nearest neighbor: the sample of channel c in the same 2 × 2 block (G from the same row). */
function nearestSource(x: number, y: number, c: Channel): [number, number] {
  const bx = x & ~1;
  const by = y & ~1;
  if (c === 0) return [bx, by];
  if (c === 2) return [bx + 1, by + 1];
  if (filterColor(x, y) === 1) return [x, y];
  return (y & 1) === 0 ? [bx + 1, by] : [bx, by + 1];
}

/** Value of channel c at (x, y). If `samples` is given, the raw samples used and their weights are appended. */
export function interpolate(raw: Plane, x: number, y: number, c: Channel, method: Method, samples?: Sample[]): number {
  const { width, height, data } = raw;
  if (method === 'nearest') {
    const [sx, sy] = nearestSource(x, y, c);
    const value = data[sy * width + sx];
    samples?.push({ x: sx, y: sy, weight: 1, value });
    return value;
  }
  const kernel = c === 1 ? KERNEL_G : KERNEL_RB;
  let sum = 0;
  let weights = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || filterColor(sx, sy) !== c) continue;
      const weight = kernel[(dy + 1) * 3 + dx + 1];
      if (weight === 0) continue;
      const value = data[sy * width + sx];
      sum += weight * value;
      weights += weight;
      samples?.push({ x: sx, y: sy, weight, value });
    }
  return sum / weights;
}

export function demosaic(raw: Plane, method: Method): RGBImage {
  const img = createImage(raw.width, raw.height);
  for (let y = 0; y < raw.height; y++)
    for (let x = 0; x < raw.width; x++)
      for (const c of [0, 1, 2] as const) img.data[(y * raw.width + x) * 3 + c] = interpolate(raw, x, y, c, method);
  return img;
}

/** |a − b|, amplified so that small errors become visible. */
export function errorImage(a: RGBImage, b: RGBImage, gain: number): RGBImage {
  const img = createImage(a.width, a.height);
  for (let i = 0; i < a.data.length; i++) img.data[i] = Math.min(1, gain * Math.abs(a.data[i] - b.data[i]));
  return img;
}
