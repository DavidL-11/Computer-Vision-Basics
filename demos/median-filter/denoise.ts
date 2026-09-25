/**
 * Noise models and two denoising filters: the (linear) mean and the (non-linear) median of a size × size window.
 * Both copy the edge pixels outward at the border.
 */

import { boxKernel1D, correlateSeparable, pixelAt } from '../../src/shared/filter';
import { type Plane, clamp01, createPlane } from '../../src/shared/image';

export type Noise = 'salt-pepper' | 'gaussian';

/** Deterministic pseudo-random numbers in [0, 1), so the same seed gives the same noise. */
export function random(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Each pixel is replaced with probability `density` by black or white (half each). */
export function saltAndPepper(p: Plane, density: number, seed: number): Plane {
  const rand = random(seed);
  return { ...p, data: p.data.map((v) => (rand() < density ? (rand() < 0.5 ? 0 : 1) : v)) };
}

/** Adds zero-mean Gaussian noise (Box–Muller transform) and clips to [0, 1]. */
export function gaussianNoise(p: Plane, sigma: number, seed: number): Plane {
  const rand = random(seed);
  return {
    ...p,
    data: p.data.map((v) => {
      const n = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
      return clamp01(v + sigma * n);
    }),
  };
}

export function meanFilter(p: Plane, size: number): Plane {
  const box = boxKernel1D(size);
  return correlateSeparable(p, box, box, 'clamp');
}

/** The size × size window around (x, y), row by row. */
export function neighborhood(p: Plane, x: number, y: number, size: number): number[] {
  const r = (size - 1) / 2;
  const values: number[] = [];
  for (let v = -r; v <= r; v++) for (let u = -r; u <= r; u++) values.push(pixelAt(p, x + u, y + v, 'clamp'));
  return values;
}

/** Middle value after sorting; the window has an odd number of pixels. */
export const median = (values: number[]) => [...values].sort((a, b) => a - b)[(values.length - 1) / 2];

export function medianFilter(p: Plane, size: number): Plane {
  const r = (size - 1) / 2;
  const out = createPlane(p.width, p.height);
  const values = new Float32Array(size * size);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      let n = 0;
      for (let v = -r; v <= r; v++) for (let u = -r; u <= r; u++) values[n++] = pixelAt(p, x + u, y + v, 'clamp');
      // Typed arrays sort numerically.
      out.data[y * p.width + x] = values.sort()[(values.length - 1) / 2];
    }
  return out;
}
