/**
 * Random-dot stereograms: two images of random dots in which a shape exists only as a difference in disparity.
 *
 * Conventions:
 *  - x to the right, y down, rectified pair: a point with disparity d at x in the left image is at x − d in the right
 *    image.
 *  - The background and the shape are two layers covered with independent random dots, each dot pattern fixed to its
 *    layer. The shape, with the larger disparity, is in front. So the background next to the shape that one camera
 *    sees and the other does not is filled with new dots, as in Julesz's construction.
 *  - Dots are squares of `dot` × `dot` pixels on a grid; a dot is black (0) with probability `density`, otherwise white.
 */

import { type Plane, createPlane } from '../../src/shared/image';

export type Shape = 'square' | 'disk' | 'ring' | 'steps';

export interface RdsOptions {
  width: number;
  height: number;
  shape: Shape;
  /** Disparity of the background and of the shape (the inner step for 'steps' has twice the extra disparity). */
  dBackground: number;
  dShape: number;
  density: number;
  dot: number;
  seed: number;
}

/** The shape's extra disparity at (x, y), relative to its center, as a multiple of dShape − dBackground; 0 = background. */
export function shapeLevel(shape: Shape, x: number, y: number, size: number): number {
  const r = Math.hypot(x, y), m = Math.max(Math.abs(x), Math.abs(y));
  switch (shape) {
    case 'square':
      return m <= size ? 1 : 0;
    case 'disk':
      return r <= size ? 1 : 0;
    case 'ring':
      return r <= size && r >= size / 2 ? 1 : 0;
    case 'steps':
      return m <= size / 2 ? 2 : m <= size ? 1 : 0;
  }
}

/** Random dots fixed to a layer: the value at the layer position (u, v), from a hash of the dot's grid cell. */
function dots(seed: number, density: number, dot: number): (u: number, v: number) => number {
  return (u, v) => {
    const cu = Math.floor(u / dot), cv = Math.floor(v / dot);
    let h = (Math.imul(cu, 374761393) + Math.imul(cv, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296 < density ? 0 : 1;
  };
}

export interface Stereogram {
  left: Plane;
  right: Plane;
  /** True disparity per left pixel, and whether that pixel is hidden in the right image. */
  disparity: Float32Array;
  occluded: Uint8Array;
}

export function stereogram(o: RdsOptions): Stereogram {
  const { width: w, height: h } = o;
  const size = Math.round(Math.min(w, h) * 0.3);
  const cx = Math.round(w / 2), cy = Math.round(h / 2);
  const bg = dots(o.seed, o.density, o.dot);
  const fg = dots(o.seed + 7919, o.density, o.dot);
  const extra = o.dShape - o.dBackground;
  /** Disparity of the front layer at left-image position (x, y). */
  const dLeft = (x: number, y: number) => o.dBackground + extra * shapeLevel(o.shape, x - cx, y - cy, size);
  /** The layer seen at right-image position (x, y): the nearest layer whose left position x + d holds it. */
  const dRight = (x: number, y: number) => {
    for (const level of [2, 1, 0]) {
      const d = o.dBackground + extra * level;
      if (level === 0 || shapeLevel(o.shape, x + d - cx, y - cy, size) === level) return d;
    }
    return o.dBackground;
  };
  // A layer's dots are fixed to its left-image coordinates; each step of 'steps' gets its own pattern via an offset.
  const layerValue = (d: number, xl: number, y: number) => (d === o.dBackground ? bg(xl, y) : fg(xl + 1000 * (d - o.dShape), y));
  const left = createPlane(w, h), right = createPlane(w, h);
  const disparity = new Float32Array(w * h), occluded = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = dLeft(x, y);
      left.data[i] = layerValue(d, x, y);
      const dr = dRight(x, y);
      right.data[i] = layerValue(dr, x + dr, y);
      disparity[i] = d;
      occluded[i] = x - d < 0 || dRight(x - d, y) !== d ? 1 : 0;
    }
  return { left, right, disparity, occluded };
}
