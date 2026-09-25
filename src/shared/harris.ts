/**
 * The second moment matrix M and the Harris corner detector built on it.
 *
 * Conventions:
 *  - x to the right, y down; pixel (x, y) is at index y · width + x.
 *  - Derivatives are central differences (f[x + 1] − f[x − 1]) / 2, of the image smoothed with a Gaussian of σ_D
 *    first (σ_D = 0: no smoothing). Pixels outside the image copy the nearest edge pixel.
 *  - The window w is a Gaussian of σ_I whose weights sum to 1, so the entries of M are weighted means of the
 *    derivative products and don't grow with the window size.
 */

import { correlateSeparable, gaussianKernel, pixelAt } from './filter';
import { type Plane, createPlane } from './image';

export interface Derivatives {
  ix: Plane;
  iy: Plane;
}

export function derivatives(I: Plane, sigmaD: number): Derivatives {
  const g = sigmaD > 0 ? gaussianKernel(sigmaD) : null;
  const s = g ? correlateSeparable(I, g, g, 'clamp') : I;
  const { width: w, height: h } = I;
  const ix = createPlane(w, h);
  const iy = createPlane(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      ix.data[y * w + x] = (pixelAt(s, x + 1, y, 'clamp') - pixelAt(s, x - 1, y, 'clamp')) / 2;
      iy.data[y * w + x] = (pixelAt(s, x, y + 1, 'clamp') - pixelAt(s, x, y - 1, 'clamp')) / 2;
    }
  return { ix, iy };
}

/** Per pixel M = [sxx sxy; sxy syy] = g(I_x²), g(I_x I_y), g(I_y²) with the Gaussian window g of σ_I. */
export interface SecondMoment {
  sxx: Plane;
  sxy: Plane;
  syy: Plane;
}

export function secondMoment({ ix, iy }: Derivatives, sigmaI: number): SecondMoment {
  const g = gaussianKernel(sigmaI);
  const product = (a: Plane, b: Plane): Plane => ({ ...a, data: a.data.map((v, i) => v * b.data[i]) });
  return {
    sxx: correlateSeparable(product(ix, ix), g, g, 'clamp'),
    sxy: correlateSeparable(product(ix, iy), g, g, 'clamp'),
    syy: correlateSeparable(product(iy, iy), g, g, 'clamp'),
  };
}

export interface Eigen {
  /** λ₁ ≥ λ₂ */
  l1: number;
  l2: number;
  /** Direction of the eigenvector of λ₁ in radians, measured from +x towards +y (clockwise on screen). */
  angle: number;
}

/** Eigenvalues and eigenvectors of the symmetric matrix [a b; b c]. */
export function eigen(a: number, b: number, c: number): Eigen {
  const mean = (a + c) / 2;
  const d = Math.hypot((a - c) / 2, b);
  return { l1: mean + d, l2: mean - d, angle: 0.5 * Math.atan2(2 * b, a - c) };
}

/** Harris cornerness C = det(M) − α trace(M)² = λ₁λ₂ − α(λ₁ + λ₂)². */
export const cornerness = (a: number, b: number, c: number, alpha: number) => a * c - b * b - alpha * (a + c) ** 2;

export function harrisResponse(m: SecondMoment, alpha: number): Plane {
  const out = createPlane(m.sxx.width, m.sxx.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = cornerness(m.sxx.data[i], m.sxy.data[i], m.syy.data[i], alpha);
  return out;
}

export interface HarrisParams {
  sigmaD: number;
  sigmaI: number;
  alpha: number;
}

export interface Harris {
  d: Derivatives;
  m: SecondMoment;
  response: Plane;
}

export function harris(I: Plane, p: HarrisParams): Harris {
  const d = derivatives(I, p.sigmaD);
  const m = secondMoment(d, p.sigmaI);
  return { d, m, response: harrisResponse(m, p.alpha) };
}

export interface Corner {
  x: number;
  y: number;
  response: number;
}

/**
 * Non-maximum suppression: pixels with C ≥ threshold (and C > 0) that are the maximum of their (2r + 1) × (2r + 1)
 * neighborhood, strongest first.
 */
export function localMaxima(C: Plane, threshold: number, radius: number): Corner[] {
  const { width: w, height: h, data } = C;
  const out: Corner[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = data[i];
      if (c <= 0 || c < threshold) continue;
      let max = true;
      for (let v = Math.max(0, y - radius); v <= Math.min(h - 1, y + radius) && max; v++)
        for (let u = Math.max(0, x - radius); u <= Math.min(w - 1, x + radius); u++) {
          const j = v * w + u;
          // Of equal neighbors, only the first in scan order survives.
          if (data[j] > c || (data[j] === c && j < i)) {
            max = false;
            break;
          }
        }
      if (max) out.push({ x, y, response: c });
    }
  return out.sort((a, b) => b.response - a.response);
}

export const maxOf = (p: Plane) => p.data.reduce((m, v) => Math.max(m, v), -Infinity);
