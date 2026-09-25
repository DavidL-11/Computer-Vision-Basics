import type { Vec3 } from '../../src/shared/linalg';

export const IMAGE_WIDTH = 640;
export const IMAGE_HEIGHT = 480;

export interface LabeledPoint {
  label: string;
  X: Vec3;
}

// Like on a calibration target, the world origin is a corner of the checkerboard.
const cx = 2, cy = 1.5;
export const cubePoints: LabeledPoint[] = [
  { label: '1', X: [cx - 0.5, cy - 0.5, 0] },
  { label: '2', X: [cx + 0.5, cy - 0.5, 0] },
  { label: '3', X: [cx + 0.5, cy + 0.5, 0] },
  { label: '4', X: [cx - 0.5, cy + 0.5, 0] },
  { label: '5', X: [cx - 0.5, cy - 0.5, 1] },
  { label: '6', X: [cx + 0.5, cy - 0.5, 1] },
  { label: '7', X: [cx + 0.5, cy + 0.5, 1] },
  { label: '8', X: [cx - 0.5, cy + 0.5, 1] },
];

/** Center of the scene, used as the default look-at target. */
export const sceneCenter: Vec3 = [cx, cy, 0.4];

/** Index pairs into cubePoints. */
export const cubeEdges: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export interface Square {
  corners: [Vec3, Vec3, Vec3, Vec3];
  dark: boolean;
}

export function checkerboard(cols = 8, rows = 6, size = 0.5): Square[] {
  const squares: Square[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * size;
      const y = j * size;
      squares.push({
        corners: [
          [x, y, 0],
          [x + size, y, 0],
          [x + size, y + size, 0],
          [x, y + size, 0],
        ],
        dark: (i + j) % 2 === 0,
      });
    }
  }
  return squares;
}

export const boardSquares = checkerboard();

/** [end point, CSS color token] */
export const worldAxes: [Vec3, string][] = [
  [[1, 0, 0], '--axis-x'],
  [[0, 1, 0], '--axis-y'],
  [[0, 0, 1], '--axis-z'],
];
