// The calibration target: two perpendicular checkerboards in the planes Y = 0 and X = 0 (world Z up), meeting
// along the Z axis, so the world origin is the bottom of the inner corner. Units are meters.

import type { Vec3 } from '../../src/shared/linalg';

export const IMAGE_WIDTH = 640;
export const IMAGE_HEIGHT = 480;
export const SQUARE = 0.05;
/** Squares per board side. */
export const SQUARES = 7;
export const RIG_SIZE = SQUARE * SQUARES;
/** Default look-at point for the camera, the middle of the inner corner. */
export const RIG_CENTER: Vec3 = [RIG_SIZE / 3, RIG_SIZE / 3, RIG_SIZE / 2];

export interface Square {
  corners: [Vec3, Vec3, Vec3, Vec3];
  dark: boolean;
}

/** (a, b) along the board → world point; the XZ board runs along X, the YZ board along Y. */
const onXZ = (a: number, b: number): Vec3 => [a, 0, b];
const onYZ = (a: number, b: number): Vec3 => [0, a, b];

function board(place: (a: number, b: number) => Vec3, offset: number): Square[] {
  const squares: Square[] = [];
  for (let i = 0; i < SQUARES; i++)
    for (let j = 0; j < SQUARES; j++) {
      const [a0, a1, b0, b1] = [i * SQUARE, (i + 1) * SQUARE, j * SQUARE, (j + 1) * SQUARE];
      squares.push({ corners: [place(a0, b0), place(a1, b0), place(a1, b1), place(a0, b1)], dark: (i + j + offset) % 2 === 0 });
    }
  return squares;
}

export const squares = [...board(onXZ, 0), ...board(onYZ, 1)];

/** Inner corners of each board (where four squares meet), the points a corner detector would find. */
function corners(place: (a: number, b: number) => Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 1; i < SQUARES; i++) for (let j = 1; j < SQUARES; j++) out.push(place(i * SQUARE, j * SQUARE));
  return out;
}
export const xzPoints = corners(onXZ);
export const yzPoints = corners(onYZ);

/**
 * The first n points of a seeded shuffle of each board, alternating between the boards so that small subsets use
 * both planes. With `onePlane`, only the XZ board.
 */
export function selectPoints(n: number, onePlane: boolean, rand: () => number): Vec3[] {
  const shuffle = (pts: Vec3[]) => {
    const a = [...pts];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const a = shuffle(xzPoints);
  const b = shuffle(yzPoints);
  const mixed = onePlane ? a : a.flatMap((p, i) => [p, b[i]]);
  return mixed.slice(0, n);
}
