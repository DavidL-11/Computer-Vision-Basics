// Images as plain arrays, so the image-processing math stays visible and testable without a DOM.

export type RGB = [number, number, number];

/** Interleaved RGB with values in [0, 1]. Values are sRGB-encoded unless stated otherwise. */
export interface RGBImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** A single channel, e.g. one plane of YCbCr or a raw sensor image. */
export interface Plane {
  width: number;
  height: number;
  data: Float32Array;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function createImage(width: number, height: number): RGBImage {
  return { width, height, data: new Float32Array(width * height * 3) };
}

export function createPlane(width: number, height: number): Plane {
  return { width, height, data: new Float32Array(width * height) };
}

export function getPixel(img: RGBImage, x: number, y: number): RGB {
  const i = (y * img.width + x) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

export function mapPixels(img: RGBImage, f: (rgb: RGB) => RGB): RGBImage {
  const out = createImage(img.width, img.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 3) {
    const [r, g, b] = f([d[i], d[i + 1], d[i + 2]]);
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
  }
  return out;
}

/** Shows a plane as a gray image. */
export function planeToImage(p: Plane): RGBImage {
  const out = createImage(p.width, p.height);
  p.data.forEach((v, i) => out.data.fill(v, i * 3, i * 3 + 3));
  return out;
}

/** Peak signal-to-noise ratio in dB for values in [0, 1]: 10·log₁₀(1 / MSE). */
export function psnr(a: RGBImage, b: RGBImage): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += (a.data[i] - b.data[i]) ** 2;
  const mse = sum / a.data.length;
  return mse === 0 ? Infinity : 10 * Math.log10(1 / mse);
}
