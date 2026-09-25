/**
 * The SIFT descriptor of one image point at a given scale, in an image and in a transformed copy of it.
 * The descriptor itself and its conventions are in src/shared/sift.ts, the transformation in src/shared/warp.ts.
 */

import { type Octave, type ScaleLocation, locate } from '../../src/shared/dog';
import type { Plane } from '../../src/shared/image';
import { type Descriptor, describe, dominantOrientations, orientationHistogram } from '../../src/shared/sift';

/** A non-linear intensity change I^γ, which changes the relative gradient magnitudes. */
export const applyGamma = (I: Plane, gamma: number): Plane => (gamma === 1 ? I : { ...I, data: I.data.map((v) => v ** gamma) });

export interface DescribeOptions {
  /** false: skip the orientation assignment and use θ = 0. */
  orient: boolean;
  /** Of several orientation peaks, take the one closest to this angle instead of the strongest. */
  near?: number;
  clamp: number;
}

export interface PointDescription extends Descriptor {
  location: ScaleLocation;
  histogram: Float32Array;
  /** All dominant orientations, strongest first. */
  peaks: number[];
  theta: number;
}

const angleDiff = (a: number, b: number) => Math.abs(((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

export function describePoint(octaves: Octave[], x: number, y: number, sigma: number, o: DescribeOptions): PointDescription {
  const location = locate(octaves, x, y, sigma);
  const L = octaves[location.octave].gaussians[location.level];
  const histogram = orientationHistogram(L, location.u, location.v, location.sigmaOctave);
  const peaks = dominantOrientations(histogram);
  let theta = 0;
  if (o.orient && peaks.length > 0)
    theta = o.near === undefined ? peaks[0] : peaks.reduce((a, b) => (angleDiff(b, o.near!) < angleDiff(a, o.near!) ? b : a));
  return { location, histogram, peaks, theta, ...describe(L, location.u, location.v, location.sigmaOctave, theta, o.clamp) };
}
