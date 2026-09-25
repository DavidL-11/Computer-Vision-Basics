/**
 * Conversions between sRGB and HSV, YCbCr and CIE L*a*b*.
 *
 * Conventions:
 *  - RGB values are sRGB-encoded in [0, 1].
 *  - HSV: hue in degrees [0, 360), saturation and value in [0, 1].
 *  - YCbCr: full range as in JPEG, in [0, 1] with Cb, Cr offset by 0.5.
 *  - L*a*b*: D65 white point, L* in [0, 100], a* and b* roughly in [−128, 127].
 */

import { rgbToYCbCr, srgbToLinear, linearToSrgb, yCbCrToRgb } from '../../src/shared/color';
import type { RGB } from '../../src/shared/image';
import { type Mat3, mulMat3Vec } from '../../src/shared/linalg';

export type Space = 'rgb' | 'hsv' | 'ycbcr' | 'lab';

export const SPACE_NAMES: Record<Space, string> = { rgb: 'RGB', hsv: 'HSV', ycbcr: 'YCbCr', lab: 'L*a*b*' };
export const CHANNEL_NAMES: Record<Space, [string, string, string]> = {
  rgb: ['R', 'G', 'B'],
  hsv: ['H', 'S', 'V'],
  ycbcr: ['Y', 'Cb', 'Cr'],
  lab: ['L*', 'a*', 'b*'],
};

export function rgbToHsv([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb([h, s, v]: RGB): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

// Linear sRGB → CIE XYZ (D65).
const RGB_TO_XYZ: Mat3 = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
const XYZ_TO_RGB: Mat3 = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];
const WHITE: RGB = [0.95047, 1, 1.08883];
const DELTA = 6 / 29;

const f = (t: number) => (t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA ** 2) + 4 / 29);
const fInv = (t: number) => (t > DELTA ? t ** 3 : 3 * DELTA ** 2 * (t - 4 / 29));

export function rgbToXyz(rgb: RGB): RGB {
  return mulMat3Vec(RGB_TO_XYZ, rgb.map(srgbToLinear) as RGB);
}

export function rgbToLab(rgb: RGB): RGB {
  const [fx, fy, fz] = rgbToXyz(rgb).map((v, i) => f(v / WHITE[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** May leave [0, 1]: not every L*a*b* color can be shown in sRGB. */
export function labToRgb([l, a, b]: RGB): RGB {
  const fy = (l + 16) / 116;
  const xyz = [fy + a / 500, fy, fy - b / 200].map((v, i) => fInv(v) * WHITE[i]) as RGB;
  return mulMat3Vec(XYZ_TO_RGB, xyz).map((v) => Math.sign(v) * linearToSrgb(Math.abs(v))) as RGB;
}

export function toSpace(space: Space, rgb: RGB): RGB {
  switch (space) {
    case 'rgb':
      return [...rgb];
    case 'hsv':
      return rgbToHsv(rgb);
    case 'ycbcr':
      return rgbToYCbCr(rgb);
    case 'lab':
      return rgbToLab(rgb);
  }
}

export function fromSpace(space: Space, c: RGB): RGB {
  switch (space) {
    case 'rgb':
      return [...c];
    case 'hsv':
      return hsvToRgb(c);
    case 'ycbcr':
      return yCbCrToRgb(c);
    case 'lab':
      return labToRgb(c);
  }
}

/** Channel values mapped to [0, 1] for display as gray; signed channels show 0 as mid gray. */
export function channelsForDisplay(space: Space, c: RGB): RGB {
  switch (space) {
    case 'hsv':
      return [c[0] / 360, c[1], c[2]];
    case 'lab':
      return [c[0] / 100, (c[1] + 128) / 255, (c[2] + 128) / 255];
    default:
      return c;
  }
}

/** Straight line from a to b in the given space. HSV takes the shorter way around the hue circle. */
export function interpolate(space: Space, a: RGB, b: RGB, t: number): RGB {
  const ca = toSpace(space, a);
  const cb = toSpace(space, b);
  if (space === 'hsv') {
    // Gray has no hue; take the other color's so that only saturation and value change.
    if (ca[1] === 0) ca[0] = cb[0];
    if (cb[1] === 0) cb[0] = ca[0];
    let dh = cb[0] - ca[0];
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    cb[0] = ca[0] + dh;
    const c = ca.map((v, i) => v + t * (cb[i] - v)) as RGB;
    c[0] = (c[0] + 360) % 360;
    return fromSpace(space, c);
  }
  return fromSpace(space, ca.map((v, i) => v + t * (cb[i] - v)) as RGB);
}

export const inGamut = (rgb: RGB, eps = 1e-6) => rgb.every((v) => v >= -eps && v <= 1 + eps);
