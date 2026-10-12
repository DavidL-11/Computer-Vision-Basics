// A few boxes standing on the ground plane Z = 0 (world Z up), seen by two cameras. Units are meters.

import type { Vec3 } from '../../src/shared/linalg';

export const IMAGE_WIDTH = 640;
export const IMAGE_HEIGHT = 480;
export const SCENE_CENTER: Vec3 = [0, 0, 0.5];
/** Camera 0 stays in place; camera 1 is placed relative to it. */
export const C0: Vec3 = [-0.9, -4.2, 1.7];

export type Segment = [Vec3, Vec3];

/** Axis-aligned box with its footprint [x0, x1] × [y0, y1] on the ground and height h. */
function box(x0: number, x1: number, y0: number, y1: number, h: number): { edges: Segment[]; corners: Vec3[] } {
  const corners: Vec3[] = [];
  for (const z of [0, h])
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ])
      corners.push([x, y, z]);
  const edges: Segment[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    edges.push([corners[i], corners[j]], [corners[4 + i], corners[4 + j]], [corners[i], corners[4 + i]]);
  }
  return { edges, corners };
}

const boxes = [box(-1.1, -0.4, -0.3, 0.4, 0.8), box(0.3, 0.8, -0.9, -0.1, 0.5), box(0.1, 0.5, 0.6, 1.0, 1.3)];

export const EDGES: Segment[] = boxes.flatMap((b) => b.edges);
export const CORNERS: Vec3[] = boxes.flatMap((b) => b.corners);
/** The top front corner of the tall box, where the selected point starts. */
export const START_CORNER: Vec3 = [0.1, 0.6, 1.3];

/** Ground grid lines, 0.5 m apart. */
export const GRID: Segment[] = [];
for (let s = -2; s <= 2 + 1e-9; s += 0.5) GRID.push([[s, -2, 0], [s, 2, 0]], [[-2, s, 0], [2, s, 0]]);
