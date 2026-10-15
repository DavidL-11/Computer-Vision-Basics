// A static scene of points at very different distances: a grid of points on the ground, posts standing on it, and
// a mountain ridge far away. World frame: right-handed, Z up, in meters; the camera starts at the origin, looking
// along +Y.

import type { Intrinsics } from '../../src/shared/camera';
import type { Vec3 } from '../../src/shared/linalg';

export const IMAGE_WIDTH = 640;
export const IMAGE_HEIGHT = 400;
export const INTRINSICS: Intrinsics = { fx: 400, fy: 400, u0: IMAGE_WIDTH / 2, v0: IMAGE_HEIGHT / 2, skew: 0 };
export const EYE_HEIGHT = 1.6;

export type Kind = 'ground' | 'post' | 'far';

export interface ScenePoint {
  X: Vec3;
  kind: Kind;
}

/** Base positions of the posts on the ground, and their heights. */
export const POSTS: [number, number, number][] = [
  [-2.5, 5, 2.4],
  [2, 8, 2.8],
  [-5, 12, 3.2],
  [4.5, 15, 3],
  [-1.5, 20, 3.4],
  [7, 26, 3.6],
  [-8, 32, 4],
  [2.5, 40, 4],
];
const POST_STEP = 0.4;

export const GROUND = { x: [-16, 16], y: [2, 50], step: 2 } as const;

export const RIDGE_DISTANCE = 300;
const ridgeHeight = (x: number) => 30 + 14 * Math.sin(x / 37) + 8 * Math.sin(x / 13 + 1);

function points(): ScenePoint[] {
  const out: ScenePoint[] = [];
  for (let y = GROUND.y[0]; y <= GROUND.y[1]; y += GROUND.step)
    for (let x = GROUND.x[0]; x <= GROUND.x[1]; x += GROUND.step) out.push({ X: [x, y, 0], kind: 'ground' });
  for (const [x, y, h] of POSTS)
    for (let z = POST_STEP; z <= h + 1e-9; z += POST_STEP) out.push({ X: [x, y, z], kind: 'post' });
  for (let x = -360; x <= 360; x += 15) out.push({ X: [x, RIDGE_DISTANCE, ridgeHeight(x)], kind: 'far' });
  return out;
}

export const POINTS = points();

/** Drawn for orientation: the posts as vertical segments, and the ridge as a polyline. */
export const POST_SEGMENTS: [Vec3, Vec3][] = POSTS.map(([x, y, h]) => [
  [x, y, 0],
  [x, y, h],
]);
const ridge = POINTS.filter((p) => p.kind === 'far').map((p) => p.X);
export const RIDGE_SEGMENTS: [Vec3, Vec3][] = ridge.slice(1).map((X, i) => [ridge[i], X]);
