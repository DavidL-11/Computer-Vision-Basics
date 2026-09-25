/**
 * The Canny edge detector in four steps:
 *  1. filter the image with the x and y derivatives of a Gaussian,
 *  2. compute the gradient magnitude and orientation,
 *  3. thin the edges by non-maximum suppression along the gradient direction,
 *  4. keep edges by hysteresis thresholding.
 *
 * Conventions:
 *  - x to the right, y down, so the angle θ = atan2(I_y, I_x) turns clockwise on screen.
 *  - Pixels outside the image copy the nearest edge pixel.
 *  - A derivative is the central difference (f[x + 1] − f[x − 1]) / 2 of the Gaussian-smoothed image. By
 *    associativity of convolution, this is the same as filtering with the (sampled) derivative of the Gaussian.
 */

import { correlateSeparable, gaussianKernel, pixelAt } from '../../src/shared/filter';
import { type Plane, createPlane } from '../../src/shared/image';

export interface Gradient {
  ix: Plane;
  iy: Plane;
  magnitude: Plane;
  /** θ = atan2(I_y, I_x) in radians. */
  angle: Plane;
}

export function gradient(I: Plane, sigma: number): Gradient {
  const g = gaussianKernel(sigma);
  const s = correlateSeparable(I, g, g, 'clamp');
  const { width: w, height: h } = I;
  const [ix, iy, magnitude, angle] = [0, 1, 2, 3].map(() => createPlane(w, h));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = (pixelAt(s, x + 1, y, 'clamp') - pixelAt(s, x - 1, y, 'clamp')) / 2;
      const dy = (pixelAt(s, x, y + 1, 'clamp') - pixelAt(s, x, y - 1, 'clamp')) / 2;
      ix.data[i] = dx;
      iy.data[i] = dy;
      magnitude.data[i] = Math.hypot(dx, dy);
      angle.data[i] = Math.atan2(dy, dx);
    }
  return { ix, iy, magnitude, angle };
}

/** Bilinear interpolation between the four pixels around a real position (x, y). */
export function sample(p: Plane, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (u: number, v: number) => pixelAt(p, u, v, 'clamp');
  return (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
}

export interface Suppression {
  /** Unit gradient direction at q. */
  dx: number;
  dy: number;
  /** Magnitude one pixel ahead along the gradient, at p = q + ∇I/‖∇I‖, and one pixel behind, at r = q − ∇I/‖∇I‖. */
  p: number;
  r: number;
  keep: boolean;
}

/** Non-maximum suppression at pixel q = (x, y): is its magnitude a maximum along the gradient direction? */
export function suppressionAt(g: Gradient, x: number, y: number): Suppression {
  const i = y * g.magnitude.width + x;
  const m = g.magnitude.data[i];
  if (m === 0) return { dx: 0, dy: 0, p: 0, r: 0, keep: false };
  const dx = g.ix.data[i] / m;
  const dy = g.iy.data[i] / m;
  const p = sample(g.magnitude, x + dx, y + dy);
  const r = sample(g.magnitude, x - dx, y - dy);
  // Strictly greater on one side only, so of a ridge two pixels wide with equal values, one pixel stays.
  return { dx, dy, p, r, keep: m > p && m >= r };
}

/** The gradient magnitude where it is a maximum along the gradient direction, 0 elsewhere. */
export function nonMaximumSuppression(g: Gradient): Plane {
  const { width: w, height: h } = g.magnitude;
  const out = createPlane(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (suppressionAt(g, x, y).keep) out.data[y * w + x] = g.magnitude.data[y * w + x];
  return out;
}

export const NONE = 0;
/** Between the thresholds, but not connected to a strong edge. */
export const WEAK = 1;
/** Between the thresholds and connected to a strong edge. */
export const WEAK_EDGE = 2;
export const STRONG = 3;

/**
 * Hysteresis thresholding of the thinned magnitude: pixels ≥ high are strong edges, pixels below low are noise, and
 * pixels in between are weak. Starting from the strong pixels, edges are followed into weak pixels that are
 * connected to them (8-neighborhood). Returns NONE, WEAK, WEAK_EDGE or STRONG per pixel; edges are WEAK_EDGE and STRONG.
 */
export function hysteresis(thin: Plane, low: number, high: number): Uint8Array {
  const { width: w, height: h } = thin;
  const classes = new Uint8Array(w * h);
  const stack: number[] = [];
  thin.data.forEach((v, i) => {
    if (v <= 0) return;
    if (v >= high) {
      classes[i] = STRONG;
      stack.push(i);
    } else if (v >= low) {
      classes[i] = WEAK;
    }
  });
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (let v = Math.max(y - 1, 0); v <= Math.min(y + 1, h - 1); v++)
      for (let u = Math.max(x - 1, 0); u <= Math.min(x + 1, w - 1); u++) {
        const j = v * w + u;
        if (classes[j] === WEAK) {
          classes[j] = WEAK_EDGE;
          stack.push(j);
        }
      }
  }
  return classes;
}
