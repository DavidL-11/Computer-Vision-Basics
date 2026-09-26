import type { Vec3 } from '../../src/shared/linalg';

export const IMAGE_WIDTH = 640;
export const IMAGE_HEIGHT = 480;

export type FamilyKey = 'x' | 'y' | 'z' | 'ramp';

export interface Family {
  key: FamilyKey;
  /** Subscript of v, as plain text and as TeX. */
  sub: string;
  tex: string;
  name: string;
  d: Vec3;
  /** CSS color token. */
  color: string;
}

/** Directions of the parallel line families in the scene. The ramp rises 1 m per 2 m along Y. */
export const FAMILIES: Family[] = [
  { key: 'x', sub: 'X', tex: 'X', name: 'X (left–right)', d: [1, 0, 0], color: '--axis-x' },
  { key: 'y', sub: 'Y', tex: 'Y', name: 'Y (depth)', d: [0, 1, 0], color: '--axis-y' },
  { key: 'z', sub: 'Z', tex: 'Z', name: 'Z (vertical)', d: [0, 0, 1], color: '--axis-z' },
  { key: 'ramp', sub: 'ramp', tex: '\\text{ramp}', name: 'ramp', d: [0, 2, 1], color: '--viz-object' },
];

export interface Edge {
  a: Vec3;
  b: Vec3;
  family: FamilyKey;
}

function box(x0: number, x1: number, y0: number, y1: number, h: number): Edge[] {
  const edges: Edge[] = [];
  for (const z of [0, h]) {
    edges.push({ a: [x0, y0, z], b: [x1, y0, z], family: 'x' }, { a: [x0, y1, z], b: [x1, y1, z], family: 'x' });
    edges.push({ a: [x0, y0, z], b: [x0, y1, z], family: 'y' }, { a: [x1, y0, z], b: [x1, y1, z], family: 'y' });
  }
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ])
    edges.push({ a: [x, y, 0], b: [x, y, h], family: 'z' });
  return edges;
}

/** A wedge whose top surface rises from (y0, z = 0) to (y0 + 2h, z = h). */
function ramp(x0: number, x1: number, y0: number, h: number): Edge[] {
  const y1 = y0 + 2 * h;
  return [
    { a: [x0, y0, 0], b: [x1, y0, 0], family: 'x' },
    { a: [x0, y1, 0], b: [x1, y1, 0], family: 'x' },
    { a: [x0, y1, h], b: [x1, y1, h], family: 'x' },
    { a: [x0, y0, 0], b: [x0, y1, 0], family: 'y' },
    { a: [x1, y0, 0], b: [x1, y1, 0], family: 'y' },
    { a: [x0, y1, 0], b: [x0, y1, h], family: 'z' },
    { a: [x1, y1, 0], b: [x1, y1, h], family: 'z' },
    { a: [x0, y0, 0], b: [x0, y1, h], family: 'ramp' },
    { a: [x1, y0, 0], b: [x1, y1, h], family: 'ramp' },
  ];
}

/** Boxes of heights 3, 2 and 6 m and a ramp; the camera starts at the origin, looking along +Y. */
export const EDGES: Edge[] = [
  ...box(-5, -2, 8, 12, 3),
  ...box(2, 5, 6, 9, 2),
  ...box(-1, 1, 18, 21, 6),
  ...ramp(1.5, 4.5, 12, 2),
];

/** Ground grid lines, 2 m apart. */
export const GRID: [Vec3, Vec3][] = [
  ...Array.from({ length: 9 }, (_, i): [Vec3, Vec3] => [
    [-8 + 2 * i, 2, 0],
    [-8 + 2 * i, 26, 0],
  ]),
  ...Array.from({ length: 13 }, (_, j): [Vec3, Vec3] => [
    [-8, 2 + 2 * j, 0],
    [8, 2 + 2 * j, 0],
  ]),
];
