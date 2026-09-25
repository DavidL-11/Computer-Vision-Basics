/**
 * A known similarity transform plus an affine intensity change, for comparing an image with a transformed copy.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates.
 *  - The geometric part maps a point p of A to p' = s R(θ) (p − c) + c + t in B, around the image center
 *    c = ((W − 1) / 2, (H − 1) / 2). Since y points down, positive angles turn clockwise on screen.
 *  - The photometric part is an affine intensity change B = a · A + b (gain a, bias b), clipped to [0, 1].
 *  - B is sampled bilinearly from A. Where B shows no part of A, it is filled with the mean of A.
 */

import { correlateSeparable, gaussianKernel, pixelAt } from './filter';
import { type Plane, clamp01, createPlane } from './image';

export interface Transform {
  /** θ in radians */
  angle: number;
  scale: number;
  tx: number;
  ty: number;
  gain: number;
  bias: number;
}

export const IDENTITY: Transform = { angle: 0, scale: 1, tx: 0, ty: 0, gain: 1, bias: 0 };

/** p in A → p' in B */
export function mapPoint(T: Transform, width: number, height: number, x: number, y: number): [number, number] {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const c = T.scale * Math.cos(T.angle);
  const s = T.scale * Math.sin(T.angle);
  return [c * (x - cx) - s * (y - cy) + cx + T.tx, s * (x - cx) + c * (y - cy) + cy + T.ty];
}

/** p' in B → p in A */
export function unmapPoint(T: Transform, width: number, height: number, x: number, y: number): [number, number] {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const c = Math.cos(T.angle) / T.scale;
  const s = Math.sin(T.angle) / T.scale;
  const dx = x - cx - T.tx;
  const dy = y - cy - T.ty;
  return [c * dx + s * dy + cx, -s * dx + c * dy + cy];
}

/** p at a real-valued position, interpolated between the four nearest pixels; edge pixels continue outside. */
export function bilinear(p: Plane, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (u: number, v: number) => pixelAt(p, u, v, 'clamp');
  return (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
}

export function warp(A: Plane, T: Transform): Plane {
  const { width: w, height: h } = A;
  // Shrinking needs a low-pass filter first, or fine patterns alias into new structures.
  const sigma = T.scale < 1 ? 0.5 * Math.sqrt(1 / T.scale ** 2 - 1) : 0;
  const src = sigma > 0.05 ? correlateSeparable(A, gaussianKernel(sigma), gaussianKernel(sigma), 'clamp') : A;
  const fill = A.data.reduce((a, b) => a + b, 0) / A.data.length;
  const B = createPlane(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [u, v] = unmapPoint(T, w, h, x, y);
      const inside = u >= 0 && u <= w - 1 && v >= 0 && v <= h - 1;
      B.data[y * w + x] = clamp01(T.gain * (inside ? bilinear(src, u, v) : fill) + T.bias);
    }
  return B;
}

/**
 * The points of A that B shows too, at least `margin` pixels away from the borders of both images, where filters
 * see pixels outside the image or the fill.
 */
export function commonRegion(T: Transform, width: number, height: number, margin: number): (x: number, y: number) => boolean {
  const inside = (x: number, y: number, m: number) => x >= m && x <= width - 1 - m && y >= m && y <= height - 1 - m;
  // The border of A appears in B, where m pixels correspond to m / s pixels in A.
  const marginA = margin * Math.max(1, 1 / T.scale);
  return (x, y) => inside(x, y, marginA) && inside(...mapPoint(T, width, height, x, y), margin);
}
