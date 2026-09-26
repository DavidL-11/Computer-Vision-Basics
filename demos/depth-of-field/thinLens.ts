/**
 * Thin lens, circle of confusion and depth of field.
 *
 * Conventions:
 *  - All lengths in mm. Object distances (z_o, S, D) are measured from the lens into the scene, image distances
 *    (z_i) from the lens to the sensor side. Both are positive for a real image.
 *  - f: focal length, A: aperture diameter, N = f / A: f-number, S: focus distance (the object distance imaged
 *    sharply on the sensor), c: the largest circle of confusion that still counts as sharp.
 *  - Images are linear light in [0, 1].
 */

import { correlateDisk } from '../../src/shared/filter';
import { type Plane, createPlane } from '../../src/shared/image';

/** The thin lens equation 1/f = 1/z_o + 1/z_i, solved for z_i. Infinity for an object at the focal distance. */
export function imageDistance(f: number, zo: number): number {
  if (zo === Infinity) return f;
  return zo <= f ? Infinity : (f * zo) / (zo - f);
}

/**
 * Diameter of the blur disk on the sensor for a point at distance D when the lens is focused at S. The sensor sits at
 * z_S = imageDistance(f, S), the point comes into focus at z_D = imageDistance(f, D), and the cone of light with base
 * A converges to z_D. By similar triangles its cross-section at the sensor is A · |z_S − z_D| / z_D, which simplifies
 * to A · f · |D − S| / (D · (S − f)).
 */
export function circleOfConfusion(A: number, f: number, S: number, D: number): number {
  if (D === Infinity) return (A * f) / (S - f);
  return (A * f * Math.abs(D - S)) / (D * (S - f));
}

export interface DofLimits {
  near: number;
  /** Infinity when everything behind the focus distance is sharp enough. */
  far: number;
}

/** The distances where the circle of confusion equals c: solve circleOfConfusion(A, f, S, D) = c for D < S and D > S. */
export function dofLimits(A: number, f: number, S: number, c: number): DofLimits {
  const near = (A * f * S) / (A * f + c * (S - f));
  const denominator = A * f - c * (S - f);
  return { near, far: denominator <= 0 ? Infinity : (A * f * S) / denominator };
}

/** Focusing at the hyperfocal distance H makes the far limit infinite; the near limit is then H / 2. */
export function hyperfocal(A: number, f: number, c: number): number {
  return f + (A * f) / c;
}

export const fNumber = (f: number, A: number) => f / A;

/** One depth layer of the scene: a color image (three linear planes) with coverage α, all at one distance. */
export interface Layer {
  rgb: readonly [Plane, Plane, Plane];
  alpha: Plane;
  distance: number;
}

/**
 * Renders the layers as a photo: every layer is blurred with the disk of its own circle of confusion (in pixels),
 * then the layers are composited back to front. Color is blurred premultiplied by α, so a blurred edge fades out
 * instead of darkening. Each layer is flat and at one distance, which approximates a real scene, whose depth changes
 * continuously; blur that should spill from a hidden part of a farther layer around a nearer edge is missing.
 */
export function renderLayers(layers: readonly Layer[], blurPx: (distance: number) => number): [Plane, Plane, Plane] {
  const { width, height } = layers[0].alpha;
  const out = [0, 1, 2].map(() => createPlane(width, height)) as [Plane, Plane, Plane];
  const backToFront = [...layers].sort((a, b) => b.distance - a.distance);
  for (const layer of backToFront) {
    const d = blurPx(layer.distance);
    const alpha = correlateDisk(layer.alpha, d, 'clamp');
    layer.rgb.forEach((channel, c) => {
      const premultiplied = { ...channel, data: channel.data.map((v, i) => v * layer.alpha.data[i]) };
      const color = correlateDisk(premultiplied, d, 'clamp');
      const o = out[c].data;
      for (let i = 0; i < o.length; i++) o[i] = color.data[i] + (1 - alpha.data[i]) * o[i];
    });
  }
  return out;
}
