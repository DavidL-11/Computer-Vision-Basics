/**
 * The SIFT descriptor: orientation assignment and 4 × 4 histograms of 8 gradient orientations.
 *
 * Conventions:
 *  - Everything is computed on the Gaussian image L of the keypoint's octave and scale, in that octave's pixels.
 *  - Gradients are central differences of L. Angles are in radians from +x towards +y (clockwise on screen).
 *  - Orientation: a histogram of 36 bins of 10° over the gradients within 3 · 1.5σ of the keypoint, weighted by
 *    their magnitude and a Gaussian of 1.5σ. Bin j is centered at j · 10°. Every peak of at least 80% of the highest
 *    one gives an orientation.
 *  - Descriptor: a 16 × 16 grid of samples in the keypoint's frame, i.e. rotated by θ, split into 4 × 4 cells of
 *    4 × 4 samples. The sample spacing is 3σ / 4, so one cell is 3σ wide and the window grows with the scale. Each
 *    sample adds its gradient magnitude, weighted with a Gaussian of half the window width, to the 8 orientation bins
 *    of its cell. It is split linearly between the neighboring cells and bins, so that small shifts and rotations
 *    don't move whole votes from one bin to the next.
 *  - Element (row r, column c, bin b) is at index (4r + c) · 8 + b. Rows follow the keypoint's y axis, columns its
 *    x axis, and bin b covers orientations b · 45° … (b + 1) · 45° relative to θ.
 */

import type { Keypoint, Octave } from './dog';
import type { Plane } from './image';
import { bilinear } from './warp';

export const ORIENTATION_BINS = 36;
export const PEAK_RATIO = 0.8;
/** Width of the orientation window in units of the keypoint's σ. */
export const ORIENTATION_SIGMA = 1.5;
export const CELLS = 4;
export const BINS = 8;
export const SAMPLES = 16;
/** Width of one cell in units of the keypoint's σ. */
export const CELL_WIDTH = 3;
export const LENGTH = CELLS * CELLS * BINS;

const TAU = 2 * Math.PI;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** (L_x, L_y) at a real-valued position, from bilinearly interpolated central differences. */
export function gradientAt(L: Plane, x: number, y: number): [number, number] {
  return [(bilinear(L, x + 1, y) - bilinear(L, x - 1, y)) / 2, (bilinear(L, x, y + 1) - bilinear(L, x, y - 1)) / 2];
}

/** Magnitude-weighted histogram of the gradient orientations around (u, v). */
export function orientationHistogram(L: Plane, u: number, v: number, sigma: number): Float32Array {
  const hist = new Float32Array(ORIENTATION_BINS);
  const s = ORIENTATION_SIGMA * sigma;
  const radius = Math.round(3 * s);
  const cx = Math.round(u);
  const cy = Math.round(v);
  for (let y = cy - radius; y <= cy + radius; y++)
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 1 || y < 1 || x >= L.width - 1 || y >= L.height - 1) continue;
      const d2 = (x - u) ** 2 + (y - v) ** 2;
      if (d2 > radius * radius) continue;
      const gx = (L.data[y * L.width + x + 1] - L.data[y * L.width + x - 1]) / 2;
      const gy = (L.data[(y + 1) * L.width + x] - L.data[(y - 1) * L.width + x]) / 2;
      const bin = Math.round((wrap(Math.atan2(gy, gx)) / TAU) * ORIENTATION_BINS) % ORIENTATION_BINS;
      hist[bin] += Math.exp(-d2 / (2 * s * s)) * Math.hypot(gx, gy);
    }
  return hist;
}

/**
 * The orientations of all local peaks of at least `ratio` times the highest one, strongest first. Each peak is refined
 * with a parabola through the bin and its two neighbors.
 */
export function dominantOrientations(hist: Float32Array, ratio = PEAK_RATIO): number[] {
  const n = hist.length;
  const max = Math.max(...hist);
  if (max <= 0) return [];
  const peaks: [number, number][] = [];
  for (let j = 0; j < n; j++) {
    const l = hist[(j + n - 1) % n];
    const c = hist[j];
    const r = hist[(j + 1) % n];
    // Of two equal neighboring bins, the first is the peak.
    if (c < ratio * max || c <= l || c < r) continue;
    const shift = (0.5 * (l - r)) / (l - 2 * c + r);
    peaks.push([c, wrap(((j + shift) / n) * TAU)]);
  }
  return peaks.sort((a, b) => b[0] - a[0]).map((p) => p[1]);
}

export interface Sample {
  /** Position in octave pixels. */
  x: number;
  y: number;
  /** Gradient in the image frame. */
  gx: number;
  gy: number;
  /** Gaussian weight of the sample. */
  weight: number;
}

export interface Descriptor {
  /** 16 × 16 samples, row by row in the keypoint's frame. */
  samples: Sample[];
  /** The histograms before normalization. */
  raw: Float32Array;
  /** Scaled to unit length. */
  normalized: Float32Array;
  /** Values above the clamp limit set to the limit. */
  clamped: Float32Array;
  /** Clamped and scaled to unit length again: the final descriptor. */
  descriptor: Float32Array;
}

const unit = (v: Float32Array) => {
  const n = Math.hypot(...v);
  return n > 0 ? v.map((x) => x / n) : v.slice();
};

export function normalizeDescriptor(raw: Float32Array, clamp: number): Pick<Descriptor, 'normalized' | 'clamped' | 'descriptor'> {
  const normalized = unit(raw);
  const clamped = normalized.map((x) => Math.min(x, clamp));
  return { normalized, clamped, descriptor: unit(clamped) };
}

/** The descriptor of the keypoint at (u, v) with blur σ and orientation θ in L. */
export function describe(L: Plane, u: number, v: number, sigma: number, theta: number, clamp = 0.2): Descriptor {
  const raw = new Float32Array(LENGTH);
  const samples: Sample[] = [];
  const spacing = (CELL_WIDTH * sigma) / (SAMPLES / CELLS);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const half = SAMPLES / 2;
  const add = (r: number, c: number, b: number, w: number) => {
    if (r >= 0 && r < CELLS && c >= 0 && c < CELLS) raw[(r * CELLS + c) * BINS + ((b + BINS) % BINS)] += w;
  };
  for (let i = 0; i < SAMPLES; i++)
    for (let j = 0; j < SAMPLES; j++) {
      // (a, b): sample offset in the keypoint's frame, rotated into the image.
      const a = (j + 0.5 - half) * spacing;
      const b = (i + 0.5 - half) * spacing;
      const x = u + a * cos - b * sin;
      const y = v + a * sin + b * cos;
      const [gx, gy] = gradientAt(L, x, y);
      const weight = Math.exp(-((j + 0.5 - half) ** 2 + (i + 0.5 - half) ** 2) / (2 * half * half));
      samples.push({ x, y, gx, gy, weight });

      // Cell coordinates with cell centers at integers, and the bin relative to θ.
      const rc = (i + 0.5) / (SAMPLES / CELLS) - 0.5;
      const cc = (j + 0.5) / (SAMPLES / CELLS) - 0.5;
      const bc = (wrap(Math.atan2(gy, gx) - theta) / TAU) * BINS;
      const r0 = Math.floor(rc);
      const c0 = Math.floor(cc);
      const b0 = Math.floor(bc);
      const [fr, fc, fb] = [rc - r0, cc - c0, bc - b0];
      const m = weight * Math.hypot(gx, gy);
      for (const [dr, wr] of [[0, 1 - fr], [1, fr]])
        for (const [dc, wc] of [[0, 1 - fc], [1, fc]])
          for (const [db, wb] of [[0, 1 - fb], [1, fb]]) add(r0 + dr, c0 + dc, b0 + db, m * wr * wc * wb);
    }
  return { samples, raw, ...normalizeDescriptor(raw, clamp) };
}

export interface Feature {
  keypoint: Keypoint;
  /** Orientation θ in radians. */
  theta: number;
  descriptor: Float32Array;
}

/** One feature per kept keypoint and dominant orientation. */
export function siftFeatures(octaves: Octave[], keypoints: Keypoint[], clamp = 0.2): Feature[] {
  const out: Feature[] = [];
  for (const k of keypoints) {
    if (k.status !== 'kept') continue;
    const L = octaves[k.octave].gaussians[k.level];
    const hist = orientationHistogram(L, k.u, k.v, k.sigmaOctave);
    for (const theta of dominantOrientations(hist))
      out.push({ keypoint: k, theta, descriptor: describe(L, k.u, k.v, k.sigmaOctave, theta, clamp).descriptor });
  }
  return out;
}

/** Euclidean distance between two descriptors. */
export function distance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}
