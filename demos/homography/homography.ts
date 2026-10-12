/**
 * Estimating a homography from point correspondences and rectifying an image with it.
 *
 * Conventions:
 *  - Pixel coordinates: x right, y down; pixel (i, j) covers [i, i + 1) × [j, j + 1), so its center is
 *    (i + 0.5, j + 0.5) and an image of size W × H spans the rectangle from (0, 0) to (W, H).
 *  - H = [a b c; d e f; g h i] is a row-major Mat3 with p' ~ H p: (x', y', w')ᵀ = H (x, y, 1)ᵀ, then the point is
 *    (x'/w', y'/w'). Estimated matrices are scaled to i = 1, as in the lecture's [a b c; d e f; g h 1].
 *  - Unknowns h = (a, b, c, d, e, f, g, h, i). From x' = (a x + b y + c) / (g x + h y + i) and the same for y',
 *    each correspondence gives two rows of A h = 0, in the same way as the calibration matrix (Method 2):
 *      [x  y  1  0  0  0  −x'x  −x'y  −x']
 *      [0  0  0  x  y  1  −y'x  −y'y  −y']
 */

import { type Plane, createPlane } from '../../src/shared/image';
import { type Mat3, type Vec3, mulMat3Vec } from '../../src/shared/linalg';
import type { Matrix } from '../../src/shared/matrix';
import { type SVD, nullVector } from '../../src/shared/svd';
import { bilinear } from '../../src/shared/warp';

export type Vec2 = [number, number];

export function homographyRows([x, y]: Vec2, [xp, yp]: Vec2): [number[], number[]] {
  return [
    [x, y, 1, 0, 0, 0, -xp * x, -xp * y, -xp],
    [0, 0, 0, x, y, 1, -yp * x, -yp * y, -yp],
  ];
}

export interface Estimate {
  /** 2n × 9. */
  A: Matrix;
  svd: SVD;
  /** The unit vector h that minimizes |A h|: the last column of V. */
  h: number[];
  /** h reshaped to 3 × 3 and scaled so that the last entry is 1. */
  H: Mat3;
}

/** H with dst ~ H src, from at least 4 correspondences. */
export function estimateHomography(src: readonly Vec2[], dst: readonly Vec2[]): Estimate {
  const A = src.flatMap((p, i) => homographyRows(p, dst[i]));
  const { x: h, svd } = nullVector(A);
  return { A, svd, h, H: h.map((v) => v / h[8]) as Mat3 };
}

export const applyH = (H: Mat3, [x, y]: Vec2): Vec3 => mulMat3Vec(H, [x, y, 1]);
export const mapPoint = (H: Mat3, p: Vec2): Vec2 => {
  const [x, y, w] = applyH(H, p);
  return [x / w, y / w];
};

export const rectangle = (width: number, height: number): Vec2[] => [
  [0, 0],
  [width, 0],
  [width, height],
  [0, height],
];

/**
 * Inverse mapping: every output pixel center p goes through M to a position in `src` and takes the bilinear
 * value there. Positions outside `src` get `fill`. M maps output coordinates to source coordinates, so rectifying
 * with H (photo → front view) uses M = H⁻¹.
 */
export function inverseWarp(src: Plane, M: Mat3, width: number, height: number, fill: number): Plane {
  const out = createPlane(width, height);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const [x, y, w] = applyH(M, [i + 0.5, j + 0.5]);
      const u = x / w, v = y / w;
      const inside = w > 0 && u >= 0 && v >= 0 && u <= src.width && v <= src.height;
      // bilinear() puts pixel centers at integer coordinates.
      out.data[j * width + i] = inside ? bilinear(src, u - 0.5, v - 0.5) : fill;
    }
  return out;
}

