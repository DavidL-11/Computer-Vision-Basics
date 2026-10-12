// Two converging cameras looking at random points in a box above the ground (world Z up). Units are meters.

import { type CameraSnapshot, lookAtAngles, project, snapshot } from '../../src/shared/camera';
import type { Vec3 } from '../../src/shared/linalg';
import type { Vec2 } from '../../src/shared/lines';

export const IMAGE_WIDTH = 640;
export const IMAGE_HEIGHT = 480;
const TARGET: Vec3 = [0, 0, 0.6];

function camera(C: Vec3, f: number): CameraSnapshot {
  const { yaw, pitch } = lookAtAngles(C, TARGET);
  return snapshot({ fx: f, fy: f, u0: IMAGE_WIDTH / 2, v0: IMAGE_HEIGHT / 2, skew: 0 }, { C, yaw, pitch, roll: 0 });
}

export const CAMERAS: [CameraSnapshot, CameraSnapshot] = [camera([-1.2, -3.6, 1.6], 700), camera([2.2, -2.4, 1.3], 760)];

const inImage = ([u, v]: Vec2) => u >= 0 && v >= 0 && u <= IMAGE_WIDTH && v <= IMAGE_HEIGHT;

export function pixel(cam: CameraSnapshot, X: Vec3): Vec2 | null {
  const p = project(cam.K, cam.R, cam.t, X);
  return p.inFront && inImage(p.uv) ? p.uv : null;
}

/** n points in the box [−1.2, 1.2] × [−1, 1.2] × [0, 1.4] that both cameras see. */
export function randomPoints(n: number, rand: () => number): Vec3[] {
  const out: Vec3[] = [];
  while (out.length < n) {
    const X: Vec3 = [-1.2 + 2.4 * rand(), -1 + 2.2 * rand(), 1.4 * rand()];
    if (CAMERAS.every((c) => pixel(c, X))) out.push(X);
  }
  return out;
}

/** Standard normal samples from a uniform generator (Box–Muller). */
export const gaussian = (rand: () => number) => () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

export interface Correspondences {
  X: Vec3[];
  x0: Vec2[];
  x1: Vec2[];
}

/** Projections of the points into both images, with Gaussian noise of σ pixels in each coordinate. */
export function observe(X: Vec3[], sigma: number, rand: () => number): Correspondences {
  const g = gaussian(rand);
  const noisy = (cam: CameraSnapshot, p: Vec3): Vec2 => {
    const [u, v] = project(cam.K, cam.R, cam.t, p).uv;
    return [u + sigma * g(), v + sigma * g()];
  };
  return { X, x0: X.map((p) => noisy(CAMERAS[0], p)), x1: X.map((p) => noisy(CAMERAS[1], p)) };
}
