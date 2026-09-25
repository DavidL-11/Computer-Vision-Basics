/**
 * Template matching: a score for every position of a template f over an image I.
 *
 * Conventions:
 *  - The template is s × s with odd s; h[m, n] is the score with the template centered on pixel [m, n].
 *  - Only positions where the template lies completely inside the image are defined; the others are 0.
 *  - Higher is better for every method, so the score for SSD is the negated sum of squared differences.
 */

import { type Plane, createPlane } from '../../src/shared/image';

export type Method = 'correlation' | 'zero-mean' | 'ssd' | 'ncc';

export interface Template {
  size: number;
  data: Float32Array;
  mean: number;
  /** f − f̄ */
  zeroMean: Float32Array;
  /** √Σ (f − f̄)² */
  norm: number;
}

export interface Peak {
  x: number;
  y: number;
  score: number;
}

/** The s × s patch centered on (cx, cy), which must lie inside the image. */
export function extractPatch(I: Plane, cx: number, cy: number, size: number): Plane {
  const r = (size - 1) / 2;
  const out = createPlane(size, size);
  for (let l = 0; l < size; l++) out.data.set(I.data.subarray((cy - r + l) * I.width + cx - r, (cy - r + l) * I.width + cx - r + size), l * size);
  return out;
}

export function prepareTemplate(f: Plane): Template {
  const mean = f.data.reduce((a, b) => a + b, 0) / f.data.length;
  const zeroMean = f.data.map((v) => v - mean);
  return { size: f.width, data: f.data, mean, zeroMean, norm: Math.sqrt(zeroMean.reduce((a, b) => a + b * b, 0)) };
}

/** Score at one position [m, n], which must be a defined position. */
export function scoreAt(I: Plane, t: Template, m: number, n: number, method: Method): number {
  const r = (t.size - 1) / 2;
  const N = t.size * t.size;
  let sum = 0;
  let sumI = 0;
  let sumII = 0;
  for (let l = 0; l < t.size; l++)
    for (let k = 0; k < t.size; k++) {
      const value = I.data[(n - r + l) * I.width + m - r + k];
      const i = l * t.size + k;
      if (method === 'correlation') sum += t.data[i] * value;
      else if (method === 'ssd') sum += (value - t.data[i]) ** 2;
      else sum += t.zeroMean[i] * value;
      sumI += value;
      sumII += value * value;
    }
  if (method === 'ssd') return -sum;
  if (method !== 'ncc') return sum;
  // Σ (f − f̄)(I − Ī) = Σ (f − f̄) I, since Σ (f − f̄) = 0.
  const normI = Math.sqrt(Math.max(0, sumII - (sumI * sumI) / N));
  return normI * t.norm < 1e-6 ? 0 : sum / (t.norm * normI);
}

export function scoreMap(I: Plane, t: Template, method: Method): Plane {
  const r = (t.size - 1) / 2;
  const h = createPlane(I.width, I.height);
  for (let n = r; n < I.height - r; n++) for (let m = r; m < I.width - r; m++) h.data[n * I.width + m] = scoreAt(I, t, m, n, method);
  return h;
}

/**
 * The `count` best positions with non-maximum suppression: a position is only kept if no better one lies within
 * `minDistance` pixels (in x and y), so every match is reported once.
 */
export function findPeaks(map: Plane, count: number, r: number, minDistance: number): Peak[] {
  const candidates: number[] = [];
  for (let y = r; y < map.height - r; y++) for (let x = r; x < map.width - r; x++) candidates.push(y * map.width + x);
  candidates.sort((a, b) => map.data[b] - map.data[a]);
  const peaks: Peak[] = [];
  for (const i of candidates) {
    if (peaks.length === count) break;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    if (peaks.every((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) >= minDistance)) peaks.push({ x, y, score: map.data[i] });
  }
  return peaks;
}
