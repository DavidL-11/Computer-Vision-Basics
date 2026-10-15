/**
 * Iterative Lucas–Kanade: the translation u of one window between two frames, found by repeatedly linearizing the
 * image and solving a 2 × 2 least-squares problem.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates. The window of radius r around x₀ has the N pixels
 *    xᵢ = x₀ + (i, j) with |i|, |j| ≤ r, which must lie inside I₀, and u = (u, v) is the displacement for which
 *    I₁(xᵢ + u) ≈ I₀(xᵢ).
 *  - I₁ and its derivatives are sampled bilinearly at the real-valued positions xᵢ + u; outside the image the edge
 *    pixels continue.
 *  - Derivatives are central differences, as in harris.ts. Both frames can be smoothed with a Gaussian of σ first.
 *  - One step linearizes I₁(xᵢ + u + Δu) ≈ I₁(xᵢ + u) + J(xᵢ) Δu and minimizes Σ [J(xᵢ) Δu + eᵢ]² with the errors
 *    eᵢ = I₁(xᵢ + u) − I₀(xᵢ). Stacking the gradients J(xᵢ) as the rows of A (N × 2) and −eᵢ as b gives the normal
 *    equations AᵀA Δu = Aᵀb. The next estimate is u + α Δu with step size α.
 *  - J(xᵢ) is either ∇I₁(xᵢ + u), new in every step, or ∇I₀(xᵢ), the same in every step since I₁(xᵢ + u) = I₀(xᵢ) at
 *    the solution.
 */

import { correlateSeparable, gaussianKernel } from '../../src/shared/filter';
import { type Derivatives, derivatives } from '../../src/shared/harris';
import type { Plane } from '../../src/shared/image';
import { bilinear } from '../../src/shared/warp';

export type Jacobian = 'i1' | 'i0';

export interface Frames {
  I0: Plane;
  I1: Plane;
  d0: Derivatives;
  d1: Derivatives;
}

export function prepare(I0: Plane, I1: Plane, sigma: number): Frames {
  const g = gaussianKernel(sigma);
  const smooth = (I: Plane) => (sigma > 0 ? correlateSeparable(I, g, g, 'clamp') : I);
  const s0 = smooth(I0);
  const s1 = smooth(I1);
  return { I0: s0, I1: s1, d0: derivatives(s0, 0), d1: derivatives(s1, 0) };
}

export interface Window {
  x: number;
  y: number;
  r: number;
}

/** The normal equations AᵀA Δu = Aᵀb of one step, with AᵀA = [sxx sxy; sxy syy] and Aᵀb = (bx, by). */
export interface System {
  sxx: number;
  sxy: number;
  syy: number;
  bx: number;
  by: number;
  /** E(u) = Σ eᵢ² */
  E: number;
  /** Per window pixel, row by row: I₁(xᵢ + u), eᵢ and the row J(xᵢ) = (Jx, Jy) of A. */
  warped: Float64Array;
  e: Float64Array;
  jx: Float64Array;
  jy: Float64Array;
}

export function linearize(f: Frames, w: Window, u: number, v: number, jacobian: Jacobian): System {
  const n = 2 * w.r + 1;
  const s: System = {
    sxx: 0,
    sxy: 0,
    syy: 0,
    bx: 0,
    by: 0,
    E: 0,
    warped: new Float64Array(n * n),
    e: new Float64Array(n * n),
    jx: new Float64Array(n * n),
    jy: new Float64Array(n * n),
  };
  for (let j = -w.r, k = 0; j <= w.r; j++)
    for (let i = -w.r; i <= w.r; i++, k++) {
      const x = w.x + i, y = w.y + j;
      const i1 = bilinear(f.I1, x + u, y + v);
      const e = i1 - f.I0.data[y * f.I0.width + x];
      const [jx, jy] =
        jacobian === 'i1'
          ? [bilinear(f.d1.ix, x + u, y + v), bilinear(f.d1.iy, x + u, y + v)]
          : [f.d0.ix.data[y * f.I0.width + x], f.d0.iy.data[y * f.I0.width + x]];
      s.sxx += jx * jx;
      s.sxy += jx * jy;
      s.syy += jy * jy;
      s.bx -= jx * e;
      s.by -= jy * e;
      s.E += e * e;
      s.warped[k] = i1;
      s.e[k] = e;
      s.jx[k] = jx;
      s.jy[k] = jy;
    }
  return s;
}

/** Δu = (AᵀA)⁻¹ Aᵀb, or null if AᵀA is (numerically) singular. */
export function solveStep({ sxx, sxy, syy, bx, by }: Pick<System, 'sxx' | 'sxy' | 'syy' | 'bx' | 'by'>): [number, number] | null {
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-12 * (sxx + syy) ** 2) || sxx + syy < 1e-12) return null;
  return [(syy * bx - sxy * by) / det, (sxx * by - sxy * bx) / det];
}

export interface Step {
  u: number;
  v: number;
  system: System;
  /** The update Δu computed at (u, v); null if AᵀA is singular. */
  du: [number, number] | null;
}

export type Outcome = 'converged' | 'singular' | 'diverged' | 'max-iterations';

export interface Options {
  alpha: number;
  maxIterations: number;
  /** Stop when the step |α Δu| is smaller than this, in pixels. */
  epsilon: number;
  jacobian: Jacobian;
  /** Give up once |u| exceeds this many pixels. */
  limit: number;
}

/** All estimates u₀, u₁, … from the initial guess u₀ until the iteration stops. */
export function lucasKanade(f: Frames, w: Window, u0: readonly [number, number], o: Options): { steps: Step[]; outcome: Outcome } {
  const steps: Step[] = [];
  let [u, v] = u0;
  for (let k = 0; ; k++) {
    const system = linearize(f, w, u, v, o.jacobian);
    const du = solveStep(system);
    steps.push({ u, v, system, du });
    if (Math.hypot(u, v) > o.limit) return { steps, outcome: 'diverged' };
    if (!du) return { steps, outcome: 'singular' };
    if (o.alpha * Math.hypot(...du) < o.epsilon) return { steps, outcome: 'converged' };
    if (k === o.maxIterations) return { steps, outcome: 'max-iterations' };
    u += o.alpha * du[0];
    v += o.alpha * du[1];
  }
}

/** E(u) = Σ [I₁(xᵢ + u) − I₀(xᵢ)]² on the grid u, v = −R, −R + h, …, R, row by row. */
export function errorSurface(f: Frames, w: Window, R: number, h: number): { n: number; E: Float64Array } {
  const n = Math.round((2 * R) / h) + 1;
  const E = new Float64Array(n * n);
  for (let b = 0; b < n; b++)
    for (let a = 0; a < n; a++) {
      const u = -R + a * h, v = -R + b * h;
      let sum = 0;
      for (let y = w.y - w.r; y <= w.y + w.r; y++)
        for (let x = w.x - w.r; x <= w.x + w.r; x++) sum += (bilinear(f.I1, x + u, y + v) - f.I0.data[y * f.I0.width + x]) ** 2;
      E[b * n + a] = sum;
    }
  return { n, E };
}
