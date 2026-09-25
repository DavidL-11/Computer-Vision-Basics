/**
 * The local autocorrelation E(u, v) of the window around a pixel, and its quadratic approximation by the second
 * moment matrix M.
 *
 * Conventions:
 *  - x to the right, y down; a shift (u, v) is in pixels, u along x and v along y.
 *  - E(u, v) = Σ_{x,y} w(x, y) [I(x + u, y + v) − I(x, y)]² over the window centered on the selected pixel.
 *  - The window weights sum to 1, so E and M are weighted means and don't grow with the window size.
 *  - Derivatives are central differences of the unsmoothed image, since the Taylor expansion is of I itself.
 *  - Pixels outside the image copy the nearest edge pixel.
 */

import { pixelAt } from '../../src/shared/filter';
import type { Derivatives } from '../../src/shared/harris';
import { type Plane, createPlane } from '../../src/shared/image';

export type WindowType = 'box' | 'gaussian';

/** (2r + 1) × (2r + 1) window weights that sum to 1; the Gaussian has σ = r / 2. */
export function windowWeights(radius: number, type: WindowType): Plane {
  const n = 2 * radius + 1;
  const w = createPlane(n, n);
  const s2 = 2 * (radius / 2) ** 2;
  for (let l = -radius; l <= radius; l++)
    for (let k = -radius; k <= radius; k++) w.data[(l + radius) * n + k + radius] = type === 'box' ? 1 : Math.exp(-(k * k + l * l) / s2);
  const sum = w.data.reduce((a, b) => a + b, 0);
  return { ...w, data: w.data.map((v) => v / sum) };
}

/** E(u, v) for all shifts with |u|, |v| ≤ R, as a (2R + 1) × (2R + 1) plane with (0, 0) in the middle. */
export function autocorrelation(I: Plane, x0: number, y0: number, w: Plane, R: number): Plane {
  const r = (w.width - 1) / 2;
  const n = 2 * R + 1;
  const E = createPlane(n, n);
  for (let v = -R; v <= R; v++)
    for (let u = -R; u <= R; u++) {
      let sum = 0;
      for (let l = -r; l <= r; l++)
        for (let k = -r; k <= r; k++) {
          const x = x0 + k;
          const y = y0 + l;
          const diff = pixelAt(I, x + u, y + v, 'clamp') - pixelAt(I, x, y, 'clamp');
          sum += w.data[(l + r) * w.width + k + r] * diff * diff;
        }
      E.data[(v + R) * n + u + R] = sum;
    }
  return E;
}

/** M = Σ w [I_x², I_x I_y; I_x I_y, I_y²] over the window around (x0, y0), returned as [a, b, c] for [a b; b c]. */
export function secondMomentAt({ ix, iy }: Derivatives, x0: number, y0: number, w: Plane): [number, number, number] {
  const r = (w.width - 1) / 2;
  let a = 0;
  let b = 0;
  let c = 0;
  for (let l = -r; l <= r; l++)
    for (let k = -r; k <= r; k++) {
      const gx = pixelAt(ix, x0 + k, y0 + l, 'clamp');
      const gy = pixelAt(iy, x0 + k, y0 + l, 'clamp');
      const weight = w.data[(l + r) * w.width + k + r];
      a += weight * gx * gx;
      b += weight * gx * gy;
      c += weight * gy * gy;
    }
  return [a, b, c];
}

/** The quadratic approximation E(u, v) ≈ [u v] M [u v]ᵀ. */
export const quadratic = ([a, b, c]: readonly number[], u: number, v: number) => a * u * u + 2 * b * u * v + c * v * v;

export type Structure = 'flat' | 'edge' | 'corner';

/** Both eigenvalues large: corner; one large: edge; none: flat. */
export function classify(l1: number, l2: number, large: number): Structure {
  if (l2 >= large) return 'corner';
  return l1 >= large ? 'edge' : 'flat';
}
