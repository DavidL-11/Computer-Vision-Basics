/**
 * Dense optical flow, one vector uᵢ per pixel, estimated in two ways:
 *  - patch-based: Lucas–Kanade on the window around every pixel, which assumes one translation per window;
 *  - regularized: the energy E = Σᵢ [I₁(xᵢ + uᵢ) − I₀(xᵢ)]² + α² Σᵢ ‖∇uᵢ‖², which couples neighboring vectors.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates; uᵢ is the displacement with I₁(xᵢ + uᵢ) ≈ I₀(xᵢ).
 *  - Both frames are smoothed with a Gaussian of σ first. I₁ and its central-difference gradient are sampled
 *    bilinearly at real-valued positions; outside the image the edge pixels continue.
 *  - A flow vector is NaN where the method gives no estimate.
 *  - Patch-based: the window has radius r and is clipped to the image. AᵀA and Aᵀb are divided by the number N of
 *    window pixels, so the eigenvalues of AᵀA / N are mean squared gradients and the threshold τ does not depend
 *    on r. Eigen-directions with λ < τ are left out of the solution (a pseudo-inverse): with one left, the update
 *    only has the component along the gradient (normal flow); with both, there is no estimate.
 *  - Regularized: ‖∇uᵢ‖² is the sum of the squared forward differences of u and v, so every pair of horizontally or
 *    vertically adjacent pixels adds α² ‖uᵢ − uⱼ‖². The data term is linearized at the current flow u⁰,
 *    I₁(xᵢ + uᵢ) ≈ I₁(xᵢ + u⁰ᵢ) + ∇I₁ · (uᵢ − u⁰ᵢ), and minimized with Gauss–Seidel sweeps with over-relaxation
 *    (SOR); every RELINEARIZE sweeps the linearization is renewed at the current flow (warping).
 */

import { correlateSeparable, gaussianKernel } from '../../src/shared/filter';
import { derivatives } from '../../src/shared/harris';
import { type Plane, type RGBImage, createImage } from '../../src/shared/image';

export interface Flow {
  width: number;
  height: number;
  u: Float32Array;
  v: Float32Array;
}

export interface Frames {
  I0: Plane;
  I1: Plane;
  ix: Plane;
  iy: Plane;
}

export function prepare(I0: Plane, I1: Plane, sigma: number): Frames {
  const g = gaussianKernel(sigma);
  const smooth = (I: Plane) => (sigma > 0 ? correlateSeparable(I, g, g, 'clamp') : I);
  const s1 = smooth(I1);
  return { I0: smooth(I0), I1: s1, ...derivatives(s1, 0) };
}

/** I₁, ∂I₁/∂x and ∂I₁/∂y at (x, y), bilinear with the same weights. */
function sample(f: Frames, x: number, y: number, out: Float64Array): void {
  const w = f.I1.width, h = f.I1.height;
  const cx = Math.min(w - 1, Math.max(0, x)), cy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.min(w - 2, Math.floor(cx)), y0 = Math.min(h - 2, Math.floor(cy));
  const fx = cx - x0, fy = cy - y0;
  const i = y0 * w + x0;
  const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
  const p = f.I1.data, px = f.ix.data, py = f.iy.data;
  out[0] = a * p[i] + b * p[i + 1] + c * p[i + w] + d * p[i + w + 1];
  out[1] = a * px[i] + b * px[i + 1] + c * px[i + w] + d * px[i + w + 1];
  out[2] = a * py[i] + b * py[i + 1] + c * py[i + w] + d * py[i + w + 1];
}

/** AᵀA / N = [sxx sxy; sxy syy], Aᵀb / N = (bx, by) and the mean squared error, for one window. */
export interface System {
  sxx: number;
  sxy: number;
  syy: number;
  bx: number;
  by: number;
  E: number;
}

/** The normal equations of the window of radius r around (cx, cy) at the displacement (u, v). */
export function linearize(f: Frames, cx: number, cy: number, r: number, u: number, v: number): System {
  const s: System = { sxx: 0, sxy: 0, syy: 0, bx: 0, by: 0, E: 0 };
  const w = f.I0.width, h = f.I0.height;
  const out = new Float64Array(3);
  let n = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      sample(f, x + u, y + v, out);
      const e = out[0] - f.I0.data[y * w + x];
      const jx = out[1], jy = out[2];
      s.sxx += jx * jx;
      s.sxy += jx * jy;
      s.syy += jy * jy;
      s.bx -= jx * e;
      s.by -= jy * e;
      s.E += e * e;
      n++;
    }
  for (const k of ['sxx', 'sxy', 'syy', 'bx', 'by', 'E'] as const) s[k] /= n;
  return s;
}

/** How much of the motion a window determines: both components, only the one along the gradient, or none. */
export type Kind = 'corner' | 'edge' | 'flat';

/** Eigenvalues λ₁ ≥ λ₂ of [a b; b c] and the unit eigenvector (ex, ey) of λ₁. */
export function eigen2(a: number, b: number, c: number): { l1: number; l2: number; ex: number; ey: number } {
  const m = (a + c) / 2, d = Math.hypot((a - c) / 2, b);
  const angle = 0.5 * Math.atan2(2 * b, a - c);
  return { l1: m + d, l2: m - d, ex: Math.cos(angle), ey: Math.sin(angle) };
}

/** Δu = (AᵀA)⁺ Aᵀb, leaving out the eigen-directions with λ < τ. */
export function solve(s: System, tau: number): { du: [number, number] | null; kind: Kind } {
  const { l1, l2, ex, ey } = eigen2(s.sxx, s.sxy, s.syy);
  if (l1 < tau) return { du: null, kind: 'flat' };
  const p1 = (ex * s.bx + ey * s.by) / l1;
  if (l2 < tau) return { du: [p1 * ex, p1 * ey], kind: 'edge' };
  const p2 = (-ey * s.bx + ex * s.by) / l2;
  return { du: [p1 * ex - p2 * ey, p1 * ey + p2 * ex], kind: 'corner' };
}

export interface PatchOptions {
  r: number;
  tau: number;
  /** Lucas–Kanade updates per window at most. */
  iterations: number;
  /** Stop once an update is shorter than this, in pixels. */
  epsilon: number;
}

/** The translation of the window around (cx, cy), from u = 0. */
export function patchAt(f: Frames, cx: number, cy: number, o: PatchOptions): { u: number; v: number; kind: Kind; system: System } {
  let u = 0, v = 0;
  let kind: Kind = 'flat';
  let system = linearize(f, cx, cy, o.r, 0, 0);
  for (let k = 0; k < o.iterations; k++) {
    const step = solve(system, o.tau);
    kind = step.kind;
    if (!step.du) return { u: NaN, v: NaN, kind, system };
    u += step.du[0];
    v += step.du[1];
    if (Math.hypot(...step.du) < o.epsilon) break;
    system = linearize(f, cx, cy, o.r, u, v);
  }
  return { u, v, kind, system };
}

export function patchFlow(f: Frames, o: PatchOptions): { flow: Flow; kind: Kind[] } {
  const { width, height } = f.I0;
  const flow: Flow = { width, height, u: new Float32Array(width * height), v: new Float32Array(width * height) };
  const kind: Kind[] = new Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = patchAt(f, x, y, o);
      const i = y * width + x;
      flow.u[i] = p.u;
      flow.v[i] = p.v;
      kind[i] = p.kind;
    }
  return { flow, kind };
}

/** Sweeps between two linearizations of the data term. */
export const RELINEARIZE = 20;
const OMEGA = 1.8;

/**
 * Per pixel the linearized data term Ix·u + Iy·v + c with c = I₁(x + u⁰) − I₀(x) − ∇I₁ · u⁰, at the flow u⁰.
 */
function linearizeAll(f: Frames, flow: Flow): { ix: Float64Array; iy: Float64Array; c: Float64Array } {
  const { width, height } = f.I0;
  const n = width * height;
  const out = { ix: new Float64Array(n), iy: new Float64Array(n), c: new Float64Array(n) };
  const s = new Float64Array(3);
  for (let y = 0, i = 0; y < height; y++)
    for (let x = 0; x < width; x++, i++) {
      sample(f, x + flow.u[i], y + flow.v[i], s);
      out.ix[i] = s[1];
      out.iy[i] = s[2];
      out.c[i] = s[0] - f.I0.data[i] - s[1] * flow.u[i] - s[2] * flow.v[i];
    }
  return out;
}

/**
 * One Gauss–Seidel sweep: each pixel in turn gets the minimizer of E with its neighbors fixed. With n neighbors and
 * their means ū, v̄, setting ∂E/∂u = ∂E/∂v = 0 gives
 *   u = ū − Ix (Ix ū + Iy v̄ + c) / (α² n + Ix² + Iy²),  v = v̄ − Iy (Ix ū + Iy v̄ + c) / (α² n + Ix² + Iy²).
 */
function sweep(flow: Flow, lin: ReturnType<typeof linearizeAll>, alpha2: number): void {
  const { width: w, height: h, u, v } = flow;
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      let su = 0, sv = 0, n = 0;
      if (x > 0) (su += u[i - 1]), (sv += v[i - 1]), n++;
      if (x < w - 1) (su += u[i + 1]), (sv += v[i + 1]), n++;
      if (y > 0) (su += u[i - w]), (sv += v[i - w]), n++;
      if (y < h - 1) (su += u[i + w]), (sv += v[i + w]), n++;
      const mu = su / n, mv = sv / n;
      const ix = lin.ix[i], iy = lin.iy[i];
      const k = (ix * mu + iy * mv + lin.c[i]) / (alpha2 * n + ix * ix + iy * iy);
      u[i] += OMEGA * (mu - ix * k - u[i]);
      v[i] += OMEGA * (mv - iy * k - v[i]);
    }
}

/** Minimizes the regularized energy step by step, from u = 0. */
export class Regularized {
  readonly flow: Flow;
  /** Sweeps done so far. */
  k = 0;
  private lin: ReturnType<typeof linearizeAll>;

  constructor(
    private readonly f: Frames,
    readonly alpha: number,
  ) {
    const { width, height } = f.I0;
    this.flow = { width, height, u: new Float32Array(width * height), v: new Float32Array(width * height) };
    this.lin = linearizeAll(f, this.flow);
  }

  run(sweeps: number): void {
    for (let s = 0; s < sweeps; s++, this.k++) {
      if (this.k > 0 && this.k % RELINEARIZE === 0) this.lin = linearizeAll(this.f, this.flow);
      sweep(this.flow, this.lin, this.alpha * this.alpha);
    }
  }

  /** Ix, Iy and c of the current linearization at pixel i. */
  linearization(i: number): { ix: number; iy: number; c: number } {
    return { ix: this.lin.ix[i], iy: this.lin.iy[i], c: this.lin.c[i] };
  }
}

export function regularizedFlow(f: Frames, alpha: number, iterations: number): Flow {
  const r = new Regularized(f, alpha);
  r.run(iterations);
  return r.flow;
}

/** The two terms of E = Σᵢ eᵢ² + α² Σᵢ ‖∇uᵢ‖², for any flow without NaN. */
export function energy(f: Frames, flow: Flow): { data: number; smooth: number } {
  const { width: w, height: h, u, v } = flow;
  const s = new Float64Array(3);
  let data = 0, smooth = 0;
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      sample(f, x + u[i], y + v[i], s);
      data += (s[0] - f.I0.data[i]) ** 2;
      if (x < w - 1) smooth += (u[i + 1] - u[i]) ** 2 + (v[i + 1] - v[i]) ** 2;
      if (y < h - 1) smooth += (u[i + w] - u[i]) ** 2 + (v[i + w] - v[i]) ** 2;
    }
  return { data, smooth };
}

/** Mean squared error of the window of radius r around (cx, cy) on the grid u, v = −R, −R + h, …, R, row by row. */
export function errorSurface(f: Frames, cx: number, cy: number, r: number, R: number, h: number): { n: number; E: Float64Array } {
  const n = Math.round((2 * R) / h) + 1;
  const E = new Float64Array(n * n);
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) E[b * n + a] = linearize(f, cx, cy, r, -R + a * h, -R + b * h).E;
  return { n, E };
}

/** ‖u − u*‖ per pixel; NaN where u has no estimate. */
export function endpointError(flow: Flow, truth: Flow): Float32Array {
  return flow.u.map((u, i) => Math.hypot(u - truth.u[i], flow.v[i] - truth.v[i]));
}

/**
 * Flow as colors: the hue gives the direction (red to the right, then clockwise on screen through yellow, green,
 * cyan, blue and magenta), the saturation the length up to `max` pixels; zero flow is white. NaN is mid gray.
 */
export function flowColor(u: number, v: number, max: number): [number, number, number] {
  if (Number.isNaN(u) || Number.isNaN(v)) return [0.5, 0.5, 0.5];
  const s = Math.min(1, Math.hypot(u, v) / max);
  const h = ((Math.atan2(v, u) / (2 * Math.PI) + 1) % 1) * 6;
  const rgb = [5, 3, 1].map((n) => {
    const k = (n + h) % 6;
    return Math.max(0, Math.min(k, 4 - k, 1));
  });
  return [1 - s * rgb[0], 1 - s * rgb[1], 1 - s * rgb[2]];
}

export function flowImage(flow: Flow, max: number): RGBImage {
  const img = createImage(flow.width, flow.height);
  flow.u.forEach((u, i) => img.data.set(flowColor(u, flow.v[i], max), 3 * i));
  return img;
}

/** The mean of the 2 to 4 horizontal and vertical neighbors of pixel i, and their number n. */
export function neighborMean(flow: Flow, i: number): { mu: number; mv: number; n: number } {
  const { width: w, height: h, u, v } = flow;
  const x = i % w, y = Math.floor(i / w);
  const js = [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w].filter((j): j is number => j !== false);
  return { mu: js.reduce((s, j) => s + u[j], 0) / js.length, mv: js.reduce((s, j) => s + v[j], 0) / js.length, n: js.length };
}
