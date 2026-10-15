/**
 * Coarse-to-fine (pyramidal) Lucas–Kanade: the translation u of a window between two frames, estimated on an image
 * pyramid from the smallest level down to the full image.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates. Level 0 is the full image. Level l + 1 keeps every
 *    other pixel of level l in x and y, after a Gaussian low-pass with σ = 1 unless that is turned off. Pixel x of
 *    level l therefore lies at 2ˡ x in level 0, and a displacement u in level 0 is u / 2ˡ in level l.
 *  - The window has the same radius r in pixels of every level (as far as the level is large enough), around the
 *    pixel nearest to x₀ / 2ˡ, so at coarse levels it covers a larger part of the scene.
 *  - Window pixels xᵢ count if xᵢ + u lies inside I₁, and E(u) is the mean of eᵢ² = [I₁(xᵢ + u) − I₀(xᵢ)]² over
 *    them, so shifts with different overlaps are comparable.
 *  - Within a level, both frames are smoothed with a Gaussian of σ (separate from the pyramid's low-pass), and
 *    Lucas–Kanade steps u ← u + Δu solve AᵀA Δu = Aᵀb, with the rows ∇I₁(xᵢ + u) of A and bᵢ = −eᵢ. I₁ and its
 *    central-difference gradient are sampled bilinearly. Without the smoothing, the central differences
 *    underestimate the slope at sharp edges, and full steps overshoot.
 *  - Displacements in Step are given in pixels of level 0.
 */

import { correlateSeparable, gaussianKernel } from '../../src/shared/filter';
import { derivatives } from '../../src/shared/harris';
import { type Plane, createPlane } from '../../src/shared/image';

/** Levels 0 … top, each half the size of the one before. */
export function pyramid(I: Plane, top: number, prefilter: boolean): Plane[] {
  const g = gaussianKernel(1);
  const levels = [I];
  for (let l = 1; l <= top; l++) {
    const prev = levels[l - 1];
    const src = prefilter ? correlateSeparable(prev, g, g, 'clamp') : prev;
    const out = createPlane(Math.ceil(prev.width / 2), Math.ceil(prev.height / 2));
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.data[y * out.width + x] = src.data[2 * y * src.width + 2 * x];
    levels.push(out);
  }
  return levels;
}

export interface Level {
  /** The pyramid level of I₀ before smoothing. */
  P0: Plane;
  I0: Plane;
  I1: Plane;
  ix: Plane;
  iy: Plane;
}

export function levels(I0: Plane, I1: Plane, top: number, prefilter: boolean, sigma: number): Level[] {
  const g = gaussianKernel(sigma);
  const smooth = (I: Plane) => (sigma > 0 ? correlateSeparable(I, g, g, 'clamp') : I);
  const p0 = pyramid(I0, top, prefilter);
  const p1 = pyramid(I1, top, prefilter);
  return p0.map((P0, l) => {
    const I1 = smooth(p1[l]);
    return { P0, I0: smooth(P0), I1, ...derivatives(I1, 0) };
  });
}

export interface Window {
  x: number;
  y: number;
  r: number;
}

/** The window at level l for the window w of level 0, moved inside the level. */
export function windowAt(w: Window, l: number, L: Level): Window {
  const { width, height } = L.I0;
  const r = Math.min(w.r, Math.floor((Math.min(width, height) - 1) / 2));
  const clamp = (v: number, n: number) => Math.max(r, Math.min(n - 1 - r, v));
  return { x: clamp(Math.round(w.x / 2 ** l), width), y: clamp(Math.round(w.y / 2 ** l), height), r };
}

/** Bilinear interpolation of p at a position inside it. */
function sample(p: Plane, x: number, y: number): number {
  const w = p.width;
  const x0 = Math.min(Math.floor(x), w - 2);
  const y0 = Math.min(Math.floor(y), p.height - 2);
  const fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  const d = p.data;
  return (1 - fy) * ((1 - fx) * d[i] + fx * d[i + 1]) + fy * ((1 - fx) * d[i + w] + fx * d[i + w + 1]);
}

const inside = (p: Plane, x: number, y: number) => x >= 0 && y >= 0 && x <= p.width - 1 && y <= p.height - 1;

/** AᵀA = [sxx sxy; sxy syy], Aᵀb = (bx, by), the mean squared error E and the number of counted pixels. */
export interface System {
  sxx: number;
  sxy: number;
  syy: number;
  bx: number;
  by: number;
  E: number;
  count: number;
}

/** The normal equations for a window of this level at a displacement (u, v) in pixels of this level. */
export function linearize(L: Level, w: Window, u: number, v: number): System {
  const s: System = { sxx: 0, sxy: 0, syy: 0, bx: 0, by: 0, E: 0, count: 0 };
  for (let y = w.y - w.r; y <= w.y + w.r; y++)
    for (let x = w.x - w.r; x <= w.x + w.r; x++) {
      if (!inside(L.I1, x + u, y + v)) continue;
      const e = sample(L.I1, x + u, y + v) - L.I0.data[y * L.I0.width + x];
      const jx = sample(L.ix, x + u, y + v);
      const jy = sample(L.iy, x + u, y + v);
      s.sxx += jx * jx;
      s.sxy += jx * jy;
      s.syy += jy * jy;
      s.bx -= jx * e;
      s.by -= jy * e;
      s.E += e * e;
      s.count++;
    }
  if (s.count) s.E /= s.count;
  return s;
}

/** Per window pixel, row by row: I₀(xᵢ), I₁(xᵢ + u) and eᵢ; NaN where xᵢ + u is outside I₁. */
export function windowSamples(L: Level, w: Window, u: number, v: number): { i0: Float32Array; i1: Float32Array; e: Float32Array } {
  const n = 2 * w.r + 1;
  const out = { i0: new Float32Array(n * n), i1: new Float32Array(n * n), e: new Float32Array(n * n) };
  for (let j = 0, k = 0; j < n; j++)
    for (let i = 0; i < n; i++, k++) {
      const x = w.x - w.r + i, y = w.y - w.r + j;
      out.i0[k] = L.I0.data[y * L.I0.width + x];
      out.i1[k] = inside(L.I1, x + u, y + v) ? sample(L.I1, x + u, y + v) : NaN;
      out.e[k] = out.i1[k] - out.i0[k];
    }
  return out;
}

/** Δu = (AᵀA)⁻¹ Aᵀb, or null if AᵀA is (numerically) singular. */
export function solveStep({ sxx, sxy, syy, bx, by }: System): [number, number] | null {
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-12 * (sxx + syy) ** 2) || sxx + syy < 1e-12) return null;
  return [(syy * bx - sxy * by) / det, (sxx * by - sxy * bx) / det];
}

export interface Step {
  level: number;
  /** The estimate, in pixels of level 0. */
  u: number;
  v: number;
  /** Mean squared error at this estimate, at this level. */
  E: number;
  /** The update computed here, in pixels of this level; null if AᵀA is singular. */
  du: [number, number] | null;
}

export interface Options {
  /** Lucas–Kanade updates per level at most. */
  iterations: number;
  /** Move on to the next level once an update is shorter than this, in pixels of the level. */
  epsilon: number;
}

/**
 * Starts with u = 0 at the top level, refines it there with Lucas–Kanade, doubles it for the next finer level and
 * repeats down to level 0. With top = 0 this is plain single-scale Lucas–Kanade.
 */
export function coarseToFine(pyr: Level[], w: Window, top: number, o: Options): Step[] {
  const steps: Step[] = [];
  let u = 0, v = 0;
  for (let l = top; l >= 0; l--) {
    const s = 2 ** l;
    const win = windowAt(w, l, pyr[l]);
    for (let k = 0; ; k++) {
      const system = linearize(pyr[l], win, u / s, v / s);
      const du = system.count ? solveStep(system) : null;
      steps.push({ level: l, u, v, E: system.E, du });
      if (!du || Math.hypot(...du) < o.epsilon || k === o.iterations) break;
      u += s * du[0];
      v += s * du[1];
    }
  }
  return steps;
}

/**
 * E of the window at level l for the integer displacements −R … R in pixels of level 0, in x and y, row by row; NaN
 * where no window pixel overlaps I₁.
 */
export function errorSurface(L: Level, w: Window, level: number, R: number): Float64Array {
  const n = 2 * R + 1;
  const s = 2 ** level;
  const out = new Float64Array(n * n);
  for (let b = -R; b <= R; b++)
    for (let a = -R; a <= R; a++) {
      const u = a / s, v = b / s;
      let sum = 0, count = 0;
      for (let y = w.y - w.r; y <= w.y + w.r; y++)
        for (let x = w.x - w.r; x <= w.x + w.r; x++) {
          if (!inside(L.I1, x + u, y + v)) continue;
          sum += (sample(L.I1, x + u, y + v) - L.I0.data[y * L.I0.width + x]) ** 2;
          count++;
        }
      out[(b + R) * n + a + R] = count ? sum / count : NaN;
    }
  return out;
}
