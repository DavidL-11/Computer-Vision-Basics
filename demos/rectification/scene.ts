// A small scene in front of the rig, in meters, world Z up: a box near the cameras, a post in the middle and a wall
// with a grid far away. Their corners are the points that are matched between the images.

import type { Intrinsics } from '../../src/shared/camera';
import type { Vec3 } from '../../src/shared/linalg';

export const IMAGE_WIDTH = 480;
export const IMAGE_HEIGHT = 320;
export const INTRINSICS: Intrinsics = { fx: 360, fy: 360, u0: IMAGE_WIDTH / 2, v0: IMAGE_HEIGHT / 2, skew: 0 };
export const EYE_HEIGHT = 1.2;

export type Segment = [Vec3, Vec3];

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): { edges: Segment[]; corners: Vec3[] } {
  const corners: Vec3[] = [];
  for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) corners.push([x, y, z]);
  const pairs = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return { edges: pairs.map(([a, b]) => [corners[a], corners[b]]), corners };
}

const near = box(-0.9, -0.3, 1.6, 2.2, 0, 0.9);
const post = box(0.5, 0.6, 3.8, 3.9, 0, 2.2);

const WALL_Y = 8;
const wallEdges: Segment[] = [];
const wallPoints: Vec3[] = [];
for (let x = -3; x <= 3; x += 1) wallEdges.push([[x, WALL_Y, 0], [x, WALL_Y, 3]]);
for (let z = 0; z <= 3; z += 1) wallEdges.push([[-3, WALL_Y, z], [3, WALL_Y, z]]);
for (let x = -3; x <= 3; x += 1) for (let z = 1; z <= 3; z += 1) wallPoints.push([x, WALL_Y, z]);

const ground: Segment[] = [];
for (let x = -4; x <= 4; x += 1) ground.push([[x, 0.5, 0], [x, WALL_Y, 0]]);
for (let y = 1; y <= WALL_Y; y += 1) ground.push([[-4, y, 0], [4, y, 0]]);

export const GROUND = ground;
export const EDGES: Segment[] = [...near.edges, ...post.edges, ...wallEdges];
export const POINTS: Vec3[] = [...near.corners, ...post.corners.slice(4, 6), [0.5, 3.8, 1.1], ...wallPoints];
/** Outlines for the top view: footprints of the box and the post, and the wall. */
export const FOOTPRINTS: [number, number][][] = [
  [[-0.9, 1.6], [-0.3, 1.6], [-0.3, 2.2], [-0.9, 2.2]],
  [[0.5, 3.8], [0.6, 3.8], [0.6, 3.9], [0.5, 3.9]],
  [[-3, WALL_Y], [3, WALL_Y]],
];
