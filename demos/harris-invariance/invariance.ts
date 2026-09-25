/**
 * Repeatability of Harris corners when the image is transformed.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates.
 *  - The geometric part maps a point p of A to p' = s R(θ) (p − c) + c + t in B, around the image center
 *    c = ((W − 1) / 2, (H − 1) / 2). Since y points down, positive angles turn clockwise on screen.
 *  - The photometric part is an affine intensity change B = a · A + b (gain a, bias b), clipped to [0, 1].
 *  - B is sampled bilinearly from A. Where B shows no part of A, it is filled with the mean of A.
 */

import { correlateSeparable, gaussianKernel, pixelAt } from '../../src/shared/filter';
import { type Corner, type HarrisParams, harris, localMaxima, maxOf } from '../../src/shared/harris';
import { type Plane, clamp01, createPlane } from '../../src/shared/image';

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

function bilinear(p: Plane, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (u: number, v: number) => pixelAt(p, u, v, 'clamp');
  return (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
}

export function warp(A: Plane, T: Transform): Plane {
  const { width: w, height: h } = A;
  // Shrinking needs a low-pass filter first, or fine patterns alias into new structures (and corners).
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

export interface DetectorParams extends HarrisParams {
  /** Non-maximum suppression radius. */
  radius: number;
  threshold: number;
  /** true: the threshold is a fraction of the largest C in the image; false: an absolute value of C. */
  relative: boolean;
}

export function detectCorners(I: Plane, p: DetectorParams): Corner[] {
  const { response } = harris(I, p);
  const t = p.relative ? p.threshold * Math.max(0, maxOf(response)) : p.threshold;
  return localMaxima(response, t, p.radius);
}

/**
 * The points of A that B shows too, at least `margin` pixels away from the borders of both images, where the filters
 * see pixels outside the image or the fill.
 */
export function commonRegion(T: Transform, width: number, height: number, margin: number): (x: number, y: number) => boolean {
  const inside = (x: number, y: number, m: number) => x >= m && x <= width - 1 - m && y >= m && y <= height - 1 - m;
  // The border of A appears in B, where m pixels correspond to m / s pixels in A.
  const marginA = margin * Math.max(1, 1 / T.scale);
  return (x, y) => inside(x, y, marginA) && inside(...mapPoint(T, width, height, x, y), margin);
}

export interface Comparison {
  /** Per corner: inside the region that both images show, at least `margin` away from all borders. */
  commonA: boolean[];
  commonB: boolean[];
  /** Index of the matched corner in the other image, or −1. */
  matchOfA: number[];
  matchOfB: number[];
  nA: number;
  nB: number;
  matches: number;
}

/**
 * Which corners of A are detected again in B? Only corners in the common region count. Each corner of A, mapped into
 * B, is paired one-to-one with a corner of B at most `eps` pixels away, closest pairs first.
 */
export function compareCorners(a: Corner[], b: Corner[], T: Transform, width: number, height: number, margin: number, eps: number): Comparison {
  const common = commonRegion(T, width, height, margin);
  const commonA = a.map((c) => common(c.x, c.y));
  const commonB = b.map((c) => common(...unmapPoint(T, width, height, c.x, c.y)));

  const pairs: [number, number, number][] = [];
  a.forEach((ca, i) => {
    if (!commonA[i]) return;
    const [x, y] = mapPoint(T, width, height, ca.x, ca.y);
    b.forEach((cb, j) => {
      const d = Math.hypot(cb.x - x, cb.y - y);
      if (commonB[j] && d <= eps) pairs.push([d, i, j]);
    });
  });
  pairs.sort((p, q) => p[0] - q[0]);
  const matchOfA = a.map(() => -1);
  const matchOfB = b.map(() => -1);
  let matches = 0;
  for (const [, i, j] of pairs) {
    if (matchOfA[i] >= 0 || matchOfB[j] >= 0) continue;
    matchOfA[i] = j;
    matchOfB[j] = i;
    matches++;
  }
  const count = (flags: boolean[]) => flags.filter(Boolean).length;
  return { commonA, commonB, matchOfA, matchOfB, nA: count(commonA), nB: count(commonB), matches };
}
