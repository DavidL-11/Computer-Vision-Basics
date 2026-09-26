import type { Vec3 } from '../../src/shared/linalg';

export const IMAGE_WIDTH = 640;
export const IMAGE_HEIGHT = 480;
/** The camera looks at the subject center from distance D, turned and tilted by these angles (see camera.ts). */
export const VIEW = { yaw: 20, pitch: -10 };
export const SUBJECT_CENTER: Vec3 = [0, 0, 0.5];
export const PILLAR_HEIGHT = 2.2;

export type Segment = [Vec3, Vec3];

function box(x0: number, x1: number, y0: number, y1: number, h: number): Segment[] {
  const c = (x: number, y: number, z: number): Vec3 => [x, y, z];
  const out: Segment[] = [];
  for (const z of [0, h]) {
    out.push([c(x0, y0, z), c(x1, y0, z)], [c(x1, y0, z), c(x1, y1, z)], [c(x1, y1, z), c(x0, y1, z)], [c(x0, y1, z), c(x0, y0, z)]);
  }
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ])
    out.push([c(x, y, 0), c(x, y, h)]);
  return out;
}

/** A 1 m cube centered on the Y axis at Y = 0: the subject at distance D. */
export const SUBJECT = box(-0.5, 0.5, -0.5, 0.5, 1);

/** Two rows of pillars behind the subject, every 3 m. */
const PILLAR_DEPTHS = [3, 6, 9, 12, 15, 18, 21, 24];
export const PILLARS = PILLAR_DEPTHS.flatMap((y) => [
  ...box(-2.7, -2.3, y - 0.2, y + 0.2, PILLAR_HEIGHT),
  ...box(2.3, 2.7, y - 0.2, y + 0.2, PILLAR_HEIGHT),
]);

export const GRID: Segment[] = [
  ...Array.from({ length: 9 }, (_, i): Segment => [
    [-4 + i, -1.5, 0],
    [-4 + i, 25.5, 0],
  ]),
  ...Array.from({ length: 19 }, (_, j): Segment => [
    [-4, -1.5 + 1.5 * j, 0],
    [4, -1.5 + 1.5 * j, 0],
  ]),
];

/** Points whose projections the values panel compares. */
export const PROBES: { name: string; X: Vec3 }[] = [
  { name: 'subject, top front corner', X: [0.5, -0.5, 1] },
  { name: 'nearest pillar, top', X: [2.3, 2.8, PILLAR_HEIGHT] },
  { name: 'farthest pillar, top', X: [2.3, 23.8, PILLAR_HEIGHT] },
];
