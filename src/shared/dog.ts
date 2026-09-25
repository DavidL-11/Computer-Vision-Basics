/**
 * Scale space, the Difference of Gaussians and the keypoints at its extrema, as in SIFT.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates.
 *  - The input image counts as blurred by σ = 0.5 already (by the camera), and every σ is the total blur.
 *  - The scale space is split into octaves; each octave has half the resolution of the one before. Octave o holds the
 *    Gaussian images L_i with σ_i = σ₀ kⁱ in its own pixels, i = 0 … s + 2, for s intervals and k = 2^{1/s}. The
 *    first image of the next octave is L_s (σ = 2σ₀) with every other pixel. A point (u, v) with blur σ in octave o is
 *    (2ᵒu, 2ᵒv) with blur 2ᵒσ in the image.
 *  - D_i = L_i − L_{i+1}: the image blurred with σ minus the image blurred with kσ, as in the lecture. Bright blobs
 *    give maxima, dark blobs minima. (Many texts subtract the other way round, which swaps the two.)
 */

import { correlateSeparable, gaussianKernel, pixelAt } from './filter';
import { type Plane, createPlane } from './image';
import { type Mat3, det3, inverse3 } from './linalg';
import { bilinear } from './warp';

export const CAMERA_SIGMA = 0.5;

export interface ScaleSpaceParams {
  /** Blur of the first image in each octave, in that octave's pixels. */
  sigma0: number;
  /** s: scales per octave at which extrema are searched. */
  intervals: number;
  /** Upper limit; octaves stop before an image gets smaller than 8 pixels. */
  octaves: number;
}

export interface Octave {
  /** 2ᵒ: image pixels per pixel of this octave. */
  step: number;
  /** σ of each Gaussian image in this octave's pixels. */
  sigmas: number[];
  /** s + 3 Gaussian images L_i. */
  gaussians: Plane[];
  /** s + 2 DoG images D_i = L_i − L_{i+1}. */
  dogs: Plane[];
}

export function blur(p: Plane, sigma: number): Plane {
  if (sigma < 0.01) return p;
  const g = gaussianKernel(sigma);
  return correlateSeparable(p, g, g, 'clamp');
}

/** Every other pixel in x and y. */
export function downsample(p: Plane): Plane {
  const out = createPlane(Math.ceil(p.width / 2), Math.ceil(p.height / 2));
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.data[y * out.width + x] = p.data[2 * y * p.width + 2 * x];
  return out;
}

const subtract = (a: Plane, b: Plane): Plane => ({ ...a, data: a.data.map((v, i) => v - b.data[i]) });

export function buildScaleSpace(I: Plane, p: ScaleSpaceParams): Octave[] {
  const s = p.intervals;
  const k = 2 ** (1 / s);
  const sigmas = Array.from({ length: s + 3 }, (_, i) => p.sigma0 * k ** i);
  const octaves: Octave[] = [];
  let base = blur(I, Math.sqrt(Math.max(0, p.sigma0 ** 2 - CAMERA_SIGMA ** 2)));
  for (let o = 0; o < p.octaves && Math.min(base.width, base.height) >= 8; o++) {
    const gaussians = [base];
    // Blurring σ_{i−1} with √(σ_i² − σ_{i−1}²) gives σ_i: a Gaussian convolved with a Gaussian is a Gaussian.
    for (let i = 1; i < s + 3; i++) gaussians.push(blur(gaussians[i - 1], Math.sqrt(sigmas[i] ** 2 - sigmas[i - 1] ** 2)));
    const dogs = gaussians.slice(0, -1).map((L, i) => subtract(L, gaussians[i + 1]));
    octaves.push({ step: 2 ** o, sigmas, gaussians, dogs });
    base = downsample(gaussians[s]);
  }
  return octaves;
}

export interface DetectParams {
  /** Minimum |D| at the (interpolated) extremum. */
  threshold: number;
  /** r: the largest allowed ratio λ₁ / λ₂ of the principal curvatures. */
  edgeRatio: number;
  /** Fit a quadratic to find the extremum between pixels and scales. */
  interpolate: boolean;
}

export type KeypointStatus = 'kept' | 'low contrast' | 'edge' | 'unstable';

export interface Keypoint {
  /** Position and blur σ in image pixels. */
  x: number;
  y: number;
  sigma: number;
  octave: number;
  /** DoG image index i after the interpolation steps. */
  level: number;
  /** Position and σ in the octave's pixels. */
  u: number;
  v: number;
  sigmaOctave: number;
  /** D at the sample point the interpolation ended at, and D(x̂) at the interpolated position. */
  value: number;
  contrast: number;
  /** x̂ = (Δu, Δv, Δi), the offset of the interpolated extremum from the pixel. */
  offset: [number, number, number];
  /** trace(H)² / det(H) of the 2 × 2 Hessian of D; Infinity if det(H) ≤ 0. */
  edge: number;
  status: KeypointStatus;
}

/** (r + 1)² / r: trace² / det of a Hessian whose eigenvalues differ by the factor r. */
export const edgeLimit = (r: number) => (r + 1) ** 2 / r;

function isExtremum(dogs: Plane[], i: number, x: number, y: number): boolean {
  const w = dogs[i].width;
  const c = dogs[i].data[y * w + x];
  const max = c > 0;
  for (let l = i - 1; l <= i + 1; l++)
    for (let v = y - 1; v <= y + 1; v++)
      for (let u = x - 1; u <= x + 1; u++) {
        if (l === i && u === x && v === y) continue;
        const d = dogs[l].data[v * w + u];
        if (max ? d > c : d < c) return false;
        // Of equal neighbors, only the first in scan order (level, row, column) survives.
        if (d === c && (l < i || (l === i && (v < y || (v === y && u < x))))) return false;
      }
  return true;
}

interface Local {
  value: number;
  /** ∇D = (D_x, D_y, D_σ) and the 3 × 3 Hessian, by central differences in pixels and DoG levels. */
  gradient: [number, number, number];
  hessian: Mat3;
}

function localQuadratic(dogs: Plane[], i: number, x: number, y: number): Local {
  const at = (l: number, u: number, v: number) => pixelAt(dogs[l], u, v, 'clamp');
  const c = at(i, x, y);
  const dx = (at(i, x + 1, y) - at(i, x - 1, y)) / 2;
  const dy = (at(i, x, y + 1) - at(i, x, y - 1)) / 2;
  const ds = (at(i + 1, x, y) - at(i - 1, x, y)) / 2;
  const dxx = at(i, x + 1, y) + at(i, x - 1, y) - 2 * c;
  const dyy = at(i, x, y + 1) + at(i, x, y - 1) - 2 * c;
  const dss = at(i + 1, x, y) + at(i - 1, x, y) - 2 * c;
  const dxy = (at(i, x + 1, y + 1) - at(i, x + 1, y - 1) - at(i, x - 1, y + 1) + at(i, x - 1, y - 1)) / 4;
  const dxs = (at(i + 1, x + 1, y) - at(i + 1, x - 1, y) - at(i - 1, x + 1, y) + at(i - 1, x - 1, y)) / 4;
  const dys = (at(i + 1, x, y + 1) - at(i + 1, x, y - 1) - at(i - 1, x, y + 1) + at(i - 1, x, y - 1)) / 4;
  return { value: c, gradient: [dx, dy, ds], hessian: [dxx, dxy, dxs, dxy, dyy, dys, dxs, dys, dss] };
}

/**
 * All extrema of D over their 26 neighbors in position and scale, with |D| ≥ threshold / 2, then refined and
 * classified: the position is interpolated with the Taylor expansion D(x) ≈ D + ∇Dᵀx + ½ xᵀHx, whose extremum is
 * x̂ = −H⁻¹∇D; points with |D(x̂)| < threshold are rejected for low contrast, and points whose curvature ratio exceeds
 * r for lying on an edge. Rejected points are returned too, with their status.
 */
export function detectKeypoints(octaves: Octave[], p: ScaleSpaceParams & DetectParams): Keypoint[] {
  const s = p.intervals;
  const out: Keypoint[] = [];
  octaves.forEach((oct, o) => {
    const { width: w, height: h } = oct.dogs[0];
    for (let i = 1; i <= s; i++)
      for (let y0 = 1; y0 < h - 1; y0++)
        for (let x0 = 1; x0 < w - 1; x0++) {
          const value = oct.dogs[i].data[y0 * w + x0];
          if (Math.abs(value) < 0.5 * p.threshold || !isExtremum(oct.dogs, i, x0, y0)) continue;

          let [x, y, l] = [x0, y0, i];
          let offset: [number, number, number] = [0, 0, 0];
          let local = localQuadratic(oct.dogs, l, x, y);
          let status: KeypointStatus = 'unstable';
          let previous: number[] | null = null;
          for (let iter = 0; iter < 5; iter++) {
            if (!p.interpolate) {
              status = 'kept';
              break;
            }
            if (Math.abs(det3(local.hessian)) < 1e-12) break;
            const Hi = inverse3(local.hessian);
            const g = local.gradient;
            offset = [0, 1, 2].map((r) => -(Hi[3 * r] * g[0] + Hi[3 * r + 1] * g[1] + Hi[3 * r + 2] * g[2])) as [number, number, number];
            const next = [x + Math.round(offset[0]), y + Math.round(offset[1]), l + Math.round(offset[2])];
            // Done if the extremum is closest to this sample point, or halfway to the one we just came from: the fit
            // from either side then points to the other, and stepping on would only go back and forth.
            if (offset.every((d) => Math.abs(d) <= 0.5) || (previous && next.every((c, j) => c === previous![j]))) {
              status = 'kept';
              break;
            }
            previous = [x, y, l];
            [x, y, l] = next;
            if (x < 1 || x >= w - 1 || y < 1 || y >= h - 1 || l < 1 || l > s) break;
            local = localQuadratic(oct.dogs, l, x, y);
          }
          if (status !== 'kept') {
            [x, y, l] = [x0, y0, i];
            offset = [0, 0, 0];
            local = localQuadratic(oct.dogs, l, x, y);
          }
          const g = local.gradient;
          const contrast = local.value + 0.5 * (g[0] * offset[0] + g[1] * offset[1] + g[2] * offset[2]);
          const [dxx, dxy, , , dyy] = local.hessian;
          const det = dxx * dyy - dxy * dxy;
          const edge = det > 0 ? (dxx + dyy) ** 2 / det : Infinity;
          if (status === 'kept' && Math.abs(contrast) < p.threshold) status = 'low contrast';
          else if (status === 'kept' && edge >= edgeLimit(p.edgeRatio)) status = 'edge';

          const u = x + offset[0];
          const v = y + offset[1];
          const sigmaOctave = p.sigma0 * 2 ** ((l + offset[2]) / s);
          out.push({
            x: u * oct.step,
            y: v * oct.step,
            sigma: sigmaOctave * oct.step,
            octave: o,
            level: l,
            u,
            v,
            sigmaOctave,
            value: local.value,
            contrast,
            offset,
            edge,
            status,
          });
        }
  });
  return out;
}

export interface ScaleSample {
  /** σ in image pixels. */
  sigma: number;
  value: number;
  octave: number;
  level: number;
}

/**
 * D at the image point (x, y) in every DoG image, ordered by σ. Octaves overlap in σ, so only the levels below s are
 * taken from all but the last octave.
 */
export function dogSignature(octaves: Octave[], x: number, y: number): ScaleSample[] {
  const out: ScaleSample[] = [];
  octaves.forEach((oct, o) => {
    const s = oct.dogs.length - 2;
    const last = o === octaves.length - 1 ? oct.dogs.length : s;
    for (let i = 0; i < last; i++)
      out.push({ sigma: oct.sigmas[i] * oct.step, value: bilinear(oct.dogs[i], x / oct.step, y / oct.step), octave: o, level: i });
  });
  return out;
}

/**
 * The scale-normalized Laplacian of Gaussian σ² ∇²(G_σ ∗ I) at pixel (x, y), with ∇²G_σ(u, v) =
 * (u² + v² − 2σ²) / σ⁴ · G_σ(u, v). The image counts as blurred by 0.5 already, so the kernel adds the rest.
 */
export function normalizedLoG(I: Plane, x: number, y: number, sigma: number): number {
  const sk = Math.sqrt(Math.max(sigma ** 2 - CAMERA_SIGMA ** 2, 0.01));
  const r = Math.ceil(4 * sk);
  let sum = 0;
  let weights = 0;
  let total = 0;
  // Sampled and truncated, the kernel doesn't sum to 0 exactly; subtracting its mean keeps flat regions at 0.
  for (let v = -r; v <= r; v++)
    for (let u = -r; u <= r; u++) {
      const q = (u * u + v * v) / (sk * sk);
      const k = ((q - 2) / (sk * sk)) * Math.exp(-q / 2) / (2 * Math.PI * sk * sk);
      const value = pixelAt(I, x + u, y + v, 'clamp');
      sum += k * value;
      weights += k;
      total += value;
    }
  const n = (2 * r + 1) ** 2;
  return sigma ** 2 * (sum - (weights / n) * total);
}

export interface ScaleLocation {
  octave: number;
  /** Index of the Gaussian image closest in scale. */
  level: number;
  /** Position and σ in the octave's pixels. */
  u: number;
  v: number;
  sigmaOctave: number;
}

/** Where the image point (x, y) with blur σ lies in the scale space: the octave and Gaussian image closest in scale. */
export function locate(octaves: Octave[], x: number, y: number, sigma: number): ScaleLocation {
  const { sigmas } = octaves[0];
  const s = sigmas.length - 3;
  const position = s * Math.log2(sigma / sigmas[0]);
  const octave = Math.min(octaves.length - 1, Math.max(0, Math.floor(position / s)));
  const level = Math.min(s + 2, Math.max(0, Math.round(position - octave * s)));
  const { step } = octaves[octave];
  return { octave, level, u: x / step, v: y / step, sigmaOctave: sigma / step };
}
