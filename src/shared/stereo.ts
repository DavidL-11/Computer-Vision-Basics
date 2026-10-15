/**
 * Correspondence search on a rectified stereo pair: window matching costs along the scanline, winner-take-all and
 * scanline stereo as a shortest path.
 *
 * Conventions:
 *  - x to the right, y down, pixel (x, y) at index y · width + x. Rectified: a left pixel (x, y) with disparity d
 *    corresponds to the right pixel (x − d, y), d = x_L − x_R ≥ 0.
 *  - Costs are dissimilarities, smaller is better: 'ssd' is the mean squared difference over the window, 'ncc'
 *    is 1 − NCC, between 0 (identical up to gain and bias) and 2. The window of radius r is clipped to the image,
 *    and right pixels left of the image take the value of the first column.
 *  - Disparities without a valid match (x − d < 0) have the cost Infinity; disparity maps use NaN for "no estimate".
 */

import { correlateSeparable, gaussianKernel } from './filter';
import { type Plane, createPlane } from './image';

export type Metric = 'ssd' | 'ncc';

/** NCC of two windows with (almost) no contrast is undefined; this keeps it finite. */
const VAR_EPS = 1e-6;

/** Means over the (2r + 1)² window around every pixel, clipped to the image, from an integral image. */
export function boxMean(data: ArrayLike<number>, width: number, height: number, r: number): Float64Array {
  const W1 = width + 1;
  const S = new Float64Array(W1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += data[y * width + x];
      S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + row;
    }
  }
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width, x + r + 1);
      out[y * width + x] = (S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** The right image moved by d to the right: R_d(x, y) = R(x − d, y). */
function shifted(R: Plane, d: number): Float64Array {
  const { width: w, height: h } = R;
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = R.data[y * w + Math.max(0, x - d)];
  return out;
}

/** cost[(d · height + y) · width + x] for d = 0 … dMax. */
export interface CostVolume {
  width: number;
  height: number;
  dMax: number;
  cost: Float32Array;
}

export function costVolume(L: Plane, R: Plane, dMax: number, r: number, metric: Metric): CostVolume {
  const { width: w, height: h } = L;
  const n = w * h;
  const cost = new Float32Array((dMax + 1) * n);
  const meanL = metric === 'ncc' ? boxMean(L.data, w, h, r) : null;
  const varL = metric === 'ncc' ? boxMean(L.data.map((v) => v * v), w, h, r).map((v, i) => v - meanL![i] ** 2) : null;
  const tmp = new Float64Array(n);
  for (let d = 0; d <= dMax; d++) {
    const Rd = shifted(R, d);
    const slice = cost.subarray(d * n, (d + 1) * n);
    if (metric === 'ssd') {
      for (let i = 0; i < n; i++) tmp[i] = (L.data[i] - Rd[i]) ** 2;
      slice.set(boxMean(tmp, w, h, r));
    } else {
      const meanR = boxMean(Rd, w, h, r);
      for (let i = 0; i < n; i++) tmp[i] = Rd[i] * Rd[i];
      const sqR = boxMean(tmp, w, h, r);
      for (let i = 0; i < n; i++) tmp[i] = L.data[i] * Rd[i];
      const LR = boxMean(tmp, w, h, r);
      for (let i = 0; i < n; i++) {
        const cov = LR[i] - meanL![i] * meanR[i];
        const vR = sqR[i] - meanR[i] ** 2;
        slice[i] = 1 - cov / Math.sqrt((varL![i] + VAR_EPS) * (vR + VAR_EPS));
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < Math.min(d, w); x++) slice[y * w + x] = Infinity;
  }
  return { width: w, height: h, dMax, cost };
}

/** The costs of pixel (x, y) for d = 0 … dMax. */
export function costsAt(cv: CostVolume, x: number, y: number): Float32Array {
  const n = cv.width * cv.height;
  return Float32Array.from({ length: cv.dMax + 1 }, (_, d) => cv.cost[d * n + y * cv.width + x]);
}

/** Per pixel the disparity with the smallest cost. */
export function winnerTakeAll(cv: CostVolume): Float32Array {
  const n = cv.width * cv.height;
  const out = new Float32Array(n).fill(NaN);
  const best = new Float32Array(n).fill(Infinity);
  for (let d = 0; d <= cv.dMax; d++)
    for (let i = 0; i < n; i++) {
      const c = cv.cost[d * n + i];
      if (c < best[i]) (best[i] = c), (out[i] = d);
    }
  return out;
}

/** The cost of one window directly, for single pixels (e.g. on a pyramid level). Infinity if x − d < 0. */
export function windowCost(L: Plane, R: Plane, x: number, y: number, d: number, r: number, metric: Metric): number {
  const { width: w, height: h } = L;
  if (x - d < 0) return Infinity;
  let n = 0, sl = 0, sr = 0, sll = 0, srr = 0, slr = 0, ssd = 0;
  for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++)
    for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) {
      const a = L.data[j * w + i], b = R.data[j * w + Math.max(0, i - d)];
      n++;
      sl += a;
      sr += b;
      sll += a * a;
      srr += b * b;
      slr += a * b;
      ssd += (a - b) ** 2;
    }
  if (metric === 'ssd') return ssd / n;
  const ml = sl / n, mr = sr / n;
  return 1 - (slr / n - ml * mr) / Math.sqrt((sll / n - ml * ml + VAR_EPS) * (srr / n - mr * mr + VAR_EPS));
}

export type Move = 'match' | 'left-occlusion' | 'right-occlusion';

export interface ScanlineResult {
  /** Disparity per left pixel of the row; NaN where the left pixel is occluded (no match). */
  disparity: Float32Array;
  /** The path through the grid of (left pixel i, right pixel j), from (0, 0) to (width, width). */
  path: [number, number][];
  /** Sum of the match costs and κ per occluded pixel along the path. */
  energy: number;
  matches: number;
  occlusions: number;
}

/**
 * Scanline stereo as a shortest path: node (i, j) means that the first i left and j right pixels of row y have been
 * assigned. A diagonal step matches left pixel i with right pixel j at the cost of the window at disparity i − j; a
 * step in i alone leaves left pixel i unmatched (left occlusion), a step in j alone right pixel j (right occlusion),
 * each at the cost κ. Only 0 ≤ i − j ≤ dMax is searched. Dynamic programming finds the cheapest path.
 */
export function scanlineStereo(cv: CostVolume, y: number, kappa: number): ScanlineResult {
  const { width: w, height: h, dMax } = cv;
  const n = w * h;
  const W1 = w + 1;
  const total = new Float64Array(W1 * W1).fill(Infinity);
  const from = new Uint8Array(W1 * W1);
  total[0] = 0;
  const inBand = (i: number, j: number) => i - j >= 0 && i - j <= dMax;
  for (let i = 0; i <= w; i++)
    for (let j = 0; j <= i; j++) {
      if (!inBand(i, j) || (i === 0 && j === 0)) continue;
      const k = i * W1 + j;
      let best = Infinity, move = 0;
      if (i > 0 && j > 0 && inBand(i - 1, j - 1)) {
        const c = total[(i - 1) * W1 + j - 1] + cv.cost[(i - 1 - (j - 1)) * n + y * w + i - 1];
        if (c < best) (best = c), (move = 1);
      }
      if (i > 0 && inBand(i - 1, j)) {
        const c = total[(i - 1) * W1 + j] + kappa;
        if (c < best) (best = c), (move = 2);
      }
      if (j > 0 && inBand(i, j - 1)) {
        const c = total[i * W1 + j - 1] + kappa;
        if (c < best) (best = c), (move = 3);
      }
      total[k] = best;
      from[k] = move;
    }
  const disparity = new Float32Array(w).fill(NaN);
  const path: [number, number][] = [[w, w]];
  let i = w, j = w, matches = 0, occlusions = 0;
  while (i > 0 || j > 0) {
    const move = from[i * W1 + j];
    if (move === 1) {
      disparity[i - 1] = i - j;
      i--, j--, matches++;
    } else if (move === 2) i--, occlusions++;
    else j--, occlusions++;
    path.push([i, j]);
  }
  path.reverse();
  return { disparity, path, energy: total[w * W1 + w], matches, occlusions };
}

/** Gaussian low-pass (σ = 1) and every other pixel in x and y. */
export function downsample(p: Plane): Plane {
  const g = gaussianKernel(1);
  const s = correlateSeparable(p, g, g, 'clamp');
  const out = createPlane(Math.ceil(p.width / 2), Math.ceil(p.height / 2));
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.data[y * out.width + x] = s.data[2 * y * p.width + 2 * x];
  return out;
}

/** Levels 0 … top, each half the size of the one before. */
export function pyramid(p: Plane, top: number): Plane[] {
  const levels = [p];
  for (let l = 1; l <= top; l++) levels.push(downsample(levels[l - 1]));
  return levels;
}

export interface LevelSearch {
  level: number;
  /** The pixel at this level. */
  x: number;
  y: number;
  /** Disparities searched at this level, in its own pixels, with their costs. */
  ds: number[];
  costs: number[];
  best: number;
}

/**
 * Hierarchical correspondence for one left pixel (x, y) of level 0: a full search over 0 … dMax / 2^top on the
 * coarsest level, then on each finer level only 2 d̂ ± radius around the doubled estimate.
 */
export function hierarchicalSearch(Ls: Plane[], Rs: Plane[], x: number, y: number, dMax: number, r: number, metric: Metric, radius = 1): LevelSearch[] {
  const out: LevelSearch[] = [];
  let best = 0;
  for (let l = Ls.length - 1; l >= 0; l--) {
    const s = 2 ** l;
    const lx = Math.min(Ls[l].width - 1, Math.round(x / s)), ly = Math.min(Ls[l].height - 1, Math.round(y / s));
    const top = l === Ls.length - 1;
    const hi = Math.ceil(dMax / s);
    const from = top ? 0 : Math.max(0, 2 * best - radius), to = top ? hi : Math.min(hi, 2 * best + radius);
    const ds: number[] = [], costs: number[] = [];
    for (let d = from; d <= to; d++) {
      ds.push(d);
      costs.push(windowCost(Ls[l], Rs[l], lx, ly, d, r, metric));
    }
    best = ds[costs.indexOf(Math.min(...costs))];
    out.push({ level: l, x: lx, y: ly, ds, costs, best });
  }
  return out;
}
