import { type Plane, clamp01 } from './image';

/** Deterministic pseudo-random numbers in [0, 1), so the same seed gives the same noise. */
export function random(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Adds zero-mean Gaussian noise with standard deviation σ (Box–Muller transform) and clips to [0, 1]. */
export function gaussianNoise(p: Plane, sigma: number, seed: number): Plane {
  const rand = random(seed);
  return {
    ...p,
    data: p.data.map((v) => clamp01(v + sigma * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()))),
  };
}
