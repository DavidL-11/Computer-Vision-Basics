import type { RGB } from './image';

/** sRGB decoding: encoded pixel value in [0, 1] → linear light intensity in [0, 1]. */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** BT.601 luma weights, as used by JPEG. Applied to encoded values, so this is luma Y′, not luminance. */
export const LUMA: RGB = [0.299, 0.587, 0.114];

export const luma = ([r, g, b]: RGB) => LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;

/** Full-range YCbCr as in JPEG, all in [0, 1]; Cb and Cr are offset by 0.5 (128 in 8 bit). */
export function rgbToYCbCr(rgb: RGB): RGB {
  const y = luma(rgb);
  return [y, 0.5 + (rgb[2] - y) / 1.772, 0.5 + (rgb[0] - y) / 1.402];
}

export function yCbCrToRgb([y, cb, cr]: RGB): RGB {
  const r = y + 1.402 * (cr - 0.5);
  const b = y + 1.772 * (cb - 0.5);
  const g = (y - LUMA[0] * r - LUMA[2] * b) / LUMA[1];
  return [r, g, b];
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb: RGB): string {
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

export const cssRgb = (rgb: RGB) => `rgb(${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`;
