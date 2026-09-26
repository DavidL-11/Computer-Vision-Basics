/**
 * Parametric 2D transformations as 3 × 3 matrices in homogeneous coordinates.
 *
 * Conventions:
 *  - Plane coordinates: x right, y down, as in images. Positive angles therefore turn clockwise on screen.
 *  - Matrices are row-major `Mat3` (see linalg.ts). A point p = (x, y) becomes (x, y, 1)ᵀ, is mapped to
 *    (x', y', w')ᵀ = H (x, y, 1)ᵀ and dehomogenized to (x'/w', y'/w').
 *  - H = M_affine · M_perspective with M_affine = T · R · Sh · S · Mi: mirror and scaling act first, then shear,
 *    rotation and translation. M_perspective = [1 0 0; 0 1 0; g h 1] only changes w', so H has the last row [g h 1].
 *  - Images: pixel centers at integer coordinates, the image center on the origin of the plane (see `frameFor`). The
 *    source image spans [−1, 1] in x.
 */

import { type Mat3, type Vec3, det3, identity3, inverse3, mulMat3, mulMat3Vec } from '../../src/shared/linalg';
import { type Plane, createPlane } from '../../src/shared/image';
import { bilinear } from '../../src/shared/warp';

export type Vec2 = [number, number];
export type Mirror = 'none' | 'y-axis' | 'origin';

export interface Params {
  tx: number;
  ty: number;
  /** θ in radians */
  theta: number;
  sx: number;
  sy: number;
  mirror: Mirror;
  ax: number;
  ay: number;
  g: number;
  h: number;
}

export const IDENTITY: Params = { tx: 0, ty: 0, theta: 0, sx: 1, sy: 1, mirror: 'none', ax: 0, ay: 0, g: 0, h: 0 };

export const translation = (tx: number, ty: number): Mat3 => [1, 0, tx, 0, 1, ty, 0, 0, 1];

export function rotation(theta: number): Mat3 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export const scaling = (sx: number, sy: number): Mat3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1];

/** 'y-axis': x' = −x, y' = y. 'origin': x' = −x, y' = −y (a half turn, so it keeps the orientation). */
export function mirror(mode: Mirror): Mat3 {
  if (mode === 'y-axis') return scaling(-1, 1);
  if (mode === 'origin') return scaling(-1, -1);
  return identity3();
}

export const shear = (ax: number, ay: number): Mat3 => [1, ax, 0, ay, 1, 0, 0, 0, 1];

export const perspective = (g: number, h: number): Mat3 => [1, 0, 0, 0, 1, 0, g, h, 1];

export interface Factors {
  T: Mat3;
  R: Mat3;
  Sh: Mat3;
  S: Mat3;
  Mi: Mat3;
  P: Mat3;
}

export function factors(p: Params): Factors {
  return {
    T: translation(p.tx, p.ty),
    R: rotation(p.theta),
    Sh: shear(p.ax, p.ay),
    S: scaling(p.sx, p.sy),
    Mi: mirror(p.mirror),
    P: perspective(p.g, p.h),
  };
}

export function compose(p: Params): { affine: Mat3; H: Mat3 } {
  const f = factors(p);
  const affine = [f.R, f.Sh, f.S, f.Mi].reduce(mulMat3, f.T);
  return { affine, H: mulMat3(affine, f.P) };
}

export const applyH = (H: Mat3, [x, y]: Vec2): Vec3 => mulMat3Vec(H, [x, y, 1]);
export const toPoint = ([x, y, w]: Vec3): Vec2 => [x / w, y / w];
export const mapPoint = (H: Mat3, p: Vec2): Vec2 => toPoint(applyH(H, p));

export type Family = 'identity' | 'translation' | 'linear' | 'affine' | 'projective';

const EPS = 1e-9;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/** The smallest of the families that contains H, with its degrees of freedom. H is normalized so that h₂₂ = 1. */
export function classify(H: Mat3): { family: Family; dof: number } {
  const m = H.map((v) => v / H[8]);
  const block = [m[0], m[1], m[3], m[4]];
  const shift = !near(m[2], 0) || !near(m[5], 0);
  if (!near(m[6], 0) || !near(m[7], 0)) return { family: 'projective', dof: 8 };
  const identityBlock = [1, 0, 0, 1].every((v, i) => near(block[i], v));
  if (identityBlock) return shift ? { family: 'translation', dof: 2 } : { family: 'identity', dof: 0 };
  return shift ? { family: 'affine', dof: 6 } : { family: 'linear', dof: 4 };
}

export function originFixed(H: Mat3): boolean {
  const [x, y] = mapPoint(H, [0, 0]);
  return Math.hypot(x, y) < 1e-9;
}

/**
 * Distance of the image of the midpoint of ab from the straight line a'b', relative to |a'b'|. Zero for every
 * transformation here, since all of them map lines to lines.
 */
export function bend(H: Mat3, a: Vec2, b: Vec2): number {
  const [a2, b2, m2] = [a, b, lerp2(a, b, 0.5)].map((p) => mapPoint(H, p));
  const d: Vec2 = [b2[0] - a2[0], b2[1] - a2[1]];
  const len = Math.hypot(...d);
  return Math.abs(d[0] * (m2[1] - a2[1]) - d[1] * (m2[0] - a2[0])) / (len * len);
}

/** Angle in [0, π/2] between the images of the parallel segments a → a + d and b → b + d. */
export function parallelAngle(H: Mat3, a: Vec2, b: Vec2, d: Vec2): number {
  const dir = (p: Vec2) => {
    const [p0, p1] = [p, [p[0] + d[0], p[1] + d[1]] as Vec2].map((q) => mapPoint(H, q));
    return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  };
  const diff = Math.abs(dir(a) - dir(b)) % Math.PI;
  return Math.min(diff, Math.PI - diff);
}

/** Where a + t (b − a) lands on a'b', as a fraction of |a'b'|. Equals t for affine transformations. */
export function ratioAlong(H: Mat3, a: Vec2, b: Vec2, t: number): number {
  const [a2, b2, m2] = [a, b, lerp2(a, b, t)].map((p) => mapPoint(H, p));
  const d: Vec2 = [b2[0] - a2[0], b2[1] - a2[1]];
  return (d[0] * (m2[0] - a2[0]) + d[1] * (m2[1] - a2[1])) / (d[0] * d[0] + d[1] * d[1]);
}

/**
 * The image of the point at infinity (dx, dy, 0): all lines with direction d meet there after the transformation.
 * Its w' = g dx + h dy is 0 for affine transformations, so parallel lines stay parallel; otherwise they meet at a
 * finite point, the vanishing point of that direction.
 */
export const meetingPoint = (H: Mat3, [dx, dy]: Vec2): Vec3 => mulMat3Vec(H, [dx, dy, 0]);

/** Sign of det H: −1 if the transformation flips the plane over (as a mirror does), where w' > 0. */
export const orientation = (H: Mat3): number => Math.sign(det3(H));

const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];

/**
 * The image of the segment ab, or null if all of it maps to w' ≤ ε. w' changes linearly along the segment, so the
 * part with w' > ε is found by cutting at w' = ε. Points with w' < 0 lie behind the horizon of the transformation.
 */
export function mapSegment(H: Mat3, a: Vec2, b: Vec2, eps = 1e-3): [Vec2, Vec2] | null {
  const wa = applyH(H, a)[2];
  const wb = applyH(H, b)[2];
  if (wa <= eps && wb <= eps) return null;
  let [p, q] = [a, b];
  if (wa < eps) p = lerp2(a, b, (eps - wa) / (wb - wa));
  if (wb < eps) q = lerp2(a, b, (eps - wa) / (wb - wa));
  return [mapPoint(H, p), mapPoint(H, q)];
}

/** Pixel ↔ plane coordinates: `scale` pixels per unit, the origin at pixel (cx, cy). */
export interface Frame {
  scale: number;
  cx: number;
  cy: number;
}

/** The frame of an image that spans x ∈ [−halfWidth, halfWidth], centered on the origin. */
export const frameFor = (width: number, height: number, halfWidth = 1): Frame => ({
  scale: width / (2 * halfWidth),
  cx: (width - 1) / 2,
  cy: (height - 1) / 2,
});

export const toPixel = ([x, y]: Vec2, f: Frame): Vec2 => [f.cx + f.scale * x, f.cy + f.scale * y];
export const toPlane = ([u, v]: Vec2, f: Frame): Vec2 => [(u - f.cx) / f.scale, (v - f.cy) / f.scale];

/**
 * Warps an image by inverse mapping: each output pixel p' looks up p = H⁻¹ p' in the source and interpolates there.
 * The source and the output have their own frames, so the output can show more of the plane than the source covers.
 * Output pixels whose p lies outside the source, or behind the horizon (w < 0), get the value `fill`.
 */
export function warpPlane(
  src: Plane,
  H: Mat3,
  srcFrame: Frame,
  out: { width: number; height: number; frame: Frame },
  fill = 0,
): Plane {
  const { width, height } = src;
  const inv = inverse3(H);
  const result = createPlane(out.width, out.height);
  for (let v = 0; v < out.height; v++)
    for (let u = 0; u < out.width; u++) {
      const [x, y, w] = mulMat3Vec(inv, [...toPlane([u, v], out.frame), 1]);
      const [su, sv] = toPixel([x / w, y / w], srcFrame);
      const inside = w > 0 && su >= -0.5 && su <= width - 0.5 && sv >= -0.5 && sv <= height - 0.5;
      result.data[v * out.width + u] = inside ? bilinear(src, su, sv) : fill;
    }
  return result;
}
