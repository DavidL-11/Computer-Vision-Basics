/**
 * Parametric alignment: one motion model x′ = f(x; p) for the whole image, estimated with Gauss–Newton like
 * Lucas–Kanade, but with n parameters instead of a 2D shift.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates. The motion acts on coordinates relative to the
 *    image center c = ((W − 1) / 2, (H − 1) / 2), so that rotation and scaling turn around the middle of the image.
 *    Since y points down, a positive angle turns clockwise on screen.
 *  - f maps a pixel xᵢ of I₀ to the point x′ᵢ of I₁ that shows the same content: I₁(f(xᵢ; p)) ≈ I₀(xᵢ).
 *  - p = 0 is the identity for every model; each model is written as a 3 × 3 matrix H(p) acting on (x, y, 1):
 *      translation  (t_x, t_y)                     [1 0 t_x; 0 1 t_y; 0 0 1]
 *      Euclidean    (t_x, t_y, θ)                  [cos θ −sin θ t_x; sin θ cos θ t_y; 0 0 1]
 *      affine       (t_x, t_y, a00, a01, a10, a11) [1+a00 a01 t_x; a10 1+a11 t_y; 0 0 1]
 *      projective   (h00, h01, h02, h10, h11, h12, h20, h21)  [1+h00 h01 h02; h10 1+h11 h12; h20 h21 1]
 *  - Only pixels whose x′ lands inside I₁ count. E is the mean of eᵢ² over them, since their number changes with p.
 *  - One step linearizes eᵢ(p + Δp) ≈ eᵢ + J₁(xᵢ) Δp with the row J₁(xᵢ) = ∇I₁(x′ᵢ) ∂x′/∂p (1 × n) and solves the
 *    n × n normal equations A Δp = b, A = Σ J₁ᵀJ₁, b = −Σ eᵢ J₁ᵀ. The update is additive: p ← p + Δp.
 */

import { correlateSeparable, gaussianKernel } from '../../src/shared/filter';
import { type Derivatives, derivatives } from '../../src/shared/harris';
import { type Plane, createPlane } from '../../src/shared/image';
import { type Mat3, inverse3, mulMat3Vec } from '../../src/shared/linalg';
import { type Matrix, solve } from '../../src/shared/matrix';
import { bilinear } from '../../src/shared/warp';

export type Model = 'translation' | 'euclidean' | 'affine' | 'projective';

/** Parameter names as TeX, in the order of p. */
export const PARAMETERS: Record<Model, string[]> = {
  translation: ['t_x', 't_y'],
  euclidean: ['t_x', 't_y', '\\theta'],
  affine: ['t_x', 't_y', 'a_{00}', 'a_{01}', 'a_{10}', 'a_{11}'],
  projective: ['h_{00}', 'h_{01}', 'h_{02}', 'h_{10}', 'h_{11}', 'h_{12}', 'h_{20}', 'h_{21}'],
};

export function homography(model: Model, p: readonly number[]): Mat3 {
  switch (model) {
    case 'translation':
      return [1, 0, p[0], 0, 1, p[1], 0, 0, 1];
    case 'euclidean': {
      const c = Math.cos(p[2]);
      const s = Math.sin(p[2]);
      return [c, -s, p[0], s, c, p[1], 0, 0, 1];
    }
    case 'affine':
      return [1 + p[2], p[3], p[0], p[4], 1 + p[5], p[1], 0, 0, 1];
    case 'projective':
      return [1 + p[0], p[1], p[2], p[3], 1 + p[4], p[5], p[6], p[7], 1];
  }
}

/** A point (relative to the center) mapped by H, with the division by w. */
export function apply(H: Mat3, x: number, y: number): [number, number] {
  const [u, v, w] = mulMat3Vec(H, [x, y, 1]);
  return [u / w, v / w];
}

/** x′ = f(x; p) and the two rows of ∂x′/∂p, for (x, y) relative to the center. */
export function warpJacobian(model: Model, p: readonly number[], x: number, y: number): { xp: number; yp: number; dx: number[]; dy: number[] } {
  switch (model) {
    case 'translation':
      return { xp: x + p[0], yp: y + p[1], dx: [1, 0], dy: [0, 1] };
    case 'euclidean': {
      const c = Math.cos(p[2]);
      const s = Math.sin(p[2]);
      return { xp: c * x - s * y + p[0], yp: s * x + c * y + p[1], dx: [1, 0, -s * x - c * y], dy: [0, 1, c * x - s * y] };
    }
    case 'affine':
      return {
        xp: (1 + p[2]) * x + p[3] * y + p[0],
        yp: p[4] * x + (1 + p[5]) * y + p[1],
        dx: [1, 0, x, y, 0, 0],
        dy: [0, 1, 0, 0, x, y],
      };
    case 'projective': {
      const D = p[6] * x + p[7] * y + 1;
      const xp = ((1 + p[0]) * x + p[1] * y + p[2]) / D;
      const yp = (p[3] * x + (1 + p[4]) * y + p[5]) / D;
      return {
        xp,
        yp,
        dx: [x / D, y / D, 1 / D, 0, 0, 0, (-xp * x) / D, (-xp * y) / D],
        dy: [0, 0, 0, x / D, y / D, 1 / D, (-yp * x) / D, (-yp * y) / D],
      };
    }
  }
}

/**
 * I₁ of size w × h with I₁(x′) = source(H⁻¹ x′): the content at x in the middle of `source` moves to x′ = H x. Both
 * coordinates are relative to the respective image center; outside `source` the edge pixels continue.
 */
export function warpImage(source: Plane, H: Mat3, w: number, h: number): Plane {
  const Hi = inverse3(H);
  const out = createPlane(w, h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const sx = (source.width - 1) / 2;
  const sy = (source.height - 1) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [u, v] = apply(Hi, x - cx, y - cy);
      out.data[y * w + x] = bilinear(source, u + sx, v + sy);
    }
  return out;
}

export interface Frames {
  I0: Plane;
  I1: Plane;
  d1: Derivatives;
}

/** Both frames smoothed with a Gaussian of σ, and the gradient of I₁. */
export function prepare(I0: Plane, I1: Plane, sigma: number): Frames {
  const g = gaussianKernel(sigma);
  const smooth = (I: Plane) => (sigma > 0 ? correlateSeparable(I, g, g, 'clamp') : I);
  const s1 = smooth(I1);
  return { I0: smooth(I0), I1: s1, d1: derivatives(s1, 0) };
}

/** The normal equations of one step at p. */
export interface System {
  A: Matrix;
  b: number[];
  /** Mean of eᵢ² over the pixels that count. */
  E: number;
  /** Number of pixels whose x′ lies inside I₁. */
  count: number;
}

/** Per pixel of I₀ (NaN where x′ lies outside I₁): I₁(x′ᵢ), eᵢ and one image J₁ per parameter. */
export interface StepImages {
  warped: Float32Array;
  e: Float32Array;
  J: Float32Array[];
}

export function linearize(f: Frames, model: Model, p: readonly number[]): System;
export function linearize(f: Frames, model: Model, p: readonly number[], images: true): System & StepImages;
export function linearize(f: Frames, model: Model, p: readonly number[], images = false): System & Partial<StepImages> {
  const { width: w, height: h } = f.I0;
  const n = p.length;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const A: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  const row = new Array(n).fill(0);
  let sum = 0;
  let count = 0;
  const out = images
    ? { warped: new Float32Array(w * h).fill(NaN), e: new Float32Array(w * h).fill(NaN), J: Array.from({ length: n }, () => new Float32Array(w * h).fill(NaN)) }
    : null;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const { xp, yp, dx, dy } = warpJacobian(model, p, x - cx, y - cy);
      const u = xp + cx;
      const v = yp + cy;
      if (!(u >= 0 && u <= w - 1 && v >= 0 && v <= h - 1)) continue;
      const i1 = bilinear(f.I1, u, v);
      const e = i1 - f.I0.data[y * w + x];
      const gx = bilinear(f.d1.ix, u, v);
      const gy = bilinear(f.d1.iy, u, v);
      for (let j = 0; j < n; j++) row[j] = gx * dx[j] + gy * dy[j];
      for (let j = 0; j < n; j++) {
        b[j] -= e * row[j];
        for (let k = j; k < n; k++) A[j][k] += row[j] * row[k];
      }
      sum += e * e;
      count++;
      if (out) {
        out.warped[y * w + x] = i1;
        out.e[y * w + x] = e;
        for (let j = 0; j < n; j++) out.J[j][y * w + x] = row[j];
      }
    }
  for (let j = 0; j < n; j++) for (let k = 0; k < j; k++) A[j][k] = A[k][j];
  return { A, b, E: count ? sum / count : NaN, count, ...out };
}

/** The four image corners relative to the center. */
export const corners = (w: number, h: number): [number, number][] => {
  const x = (w - 1) / 2;
  const y = (h - 1) / 2;
  return [
    [-x, -y],
    [x, -y],
    [x, y],
    [-x, y],
  ];
};

/** Root mean square distance between where H and H* move the four image corners, in pixels. */
export function cornerError(H: Mat3, Hstar: Mat3, w: number, h: number): number {
  const d2 = corners(w, h).map(([x, y]) => {
    const [a, b] = apply(H, x, y);
    const [c, d] = apply(Hstar, x, y);
    return (a - c) ** 2 + (b - d) ** 2;
  });
  return Math.sqrt(d2.reduce((s, v) => s + v, 0) / 4);
}

export interface Step {
  p: number[];
  system: System;
  /** The update computed at p; null if A is singular. */
  dp: number[] | null;
}

export type Outcome = 'converged' | 'singular' | 'diverged' | 'max-iterations';

export interface Options {
  maxIterations: number;
  /** Stop when the update moves the image corners by less than this (root mean square, in pixels). */
  epsilon: number;
}

/** All estimates p₀ = 0, p₁, … until the iteration stops. */
export function align(f: Frames, model: Model, o: Options): { steps: Step[]; outcome: Outcome } {
  const { width: w, height: h } = f.I0;
  const steps: Step[] = [];
  let p = new Array(PARAMETERS[model].length).fill(0);
  for (let k = 0; ; k++) {
    const system = linearize(f, model, p);
    // Too few pixels left inside I₁: the estimate has run off.
    if (system.count < 0.2 * w * h) {
      steps.push({ p, system, dp: null });
      return { steps, outcome: 'diverged' };
    }
    const dp = solve(system.A, system.b);
    steps.push({ p, system, dp });
    if (!dp) return { steps, outcome: 'singular' };
    const next = p.map((v, i) => v + dp[i]);
    if (cornerError(homography(model, p), homography(model, next), w, h) < o.epsilon) return { steps, outcome: 'converged' };
    if (k === o.maxIterations) return { steps, outcome: 'max-iterations' };
    p = next;
  }
}
