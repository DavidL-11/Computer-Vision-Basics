/**
 * Field of view and three projection models: perspective, weak perspective and orthographic.
 *
 * Conventions:
 *  - The matrices act on camera coordinates (X_c, Y_c, Z_c, 1) with x right, y down, z forward, and map to
 *    w · (u, v, 1) with the principal point at (0, 0), as in the lecture. The demo adds (u₀, v₀) for display.
 *  - AFOV = 2 · arctan(H / 2f) with the sensor size H and the focal length f in the same units.
 */

import { DEG, type Mat34, type Vec3, mulMat34Point } from '../../src/shared/linalg';

/** Angular field of view in degrees. */
export function afov(H: number, f: number): number {
  return (2 * Math.atan(H / (2 * f))) / DEG;
}

export function focalForAfov(H: number, degrees: number): number {
  return H / (2 * Math.tan((degrees * DEG) / 2));
}

/** w · (u, v, 1) = (f X, f Y, Z): division by the depth. */
export function perspectiveP(f: number): Mat34 {
  return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, 1, 0];
}

/**
 * Weak perspective (scaled orthographic): w = Z₀ for every point, so the whole object is scaled by the same f / Z₀,
 * as if it were flat at the reference depth Z₀. Good when the depth range of the object is small compared to Z₀.
 */
export function weakPerspectiveP(f: number, Z0: number): Mat34 {
  return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, Z0];
}

/** Parallel projection along the optical axis: (u, v) = (X, Y), and depth has no effect at all. */
export function orthographicP(): Mat34 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
}

export function applyP(P: Mat34, Xc: Vec3): { wuv: Vec3; uv: [number, number]; w: number } {
  const wuv = mulMat34Point(P, Xc);
  return { wuv, uv: [wuv[0] / wuv[2], wuv[1] / wuv[2]], w: wuv[2] };
}

/**
 * The focal length that keeps an object at distance D the same size in the image as f₀ did at D₀: its image size is
 * f · size / D, so f must grow in proportion to D (the dolly zoom).
 */
export function dollyFocal(f0: number, D0: number, D: number): number {
  return (f0 * D) / D0;
}
