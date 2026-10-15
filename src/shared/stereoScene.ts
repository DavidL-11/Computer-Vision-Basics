/**
 * A synthetic rectified stereo pair with a known disparity map: flat layers at different depths, each with a
 * constant disparity, in front of a textured background. The layers show the classic difficulties: a textured box,
 * a uniform (textureless) panel, a stripe pattern that repeats along the scanline, and a finely textured disk.
 *
 * Conventions:
 *  - Layers are defined in left image coordinates (x right, y down, pixel centers at integers). A layer with
 *    disparity d shows at (x, y) in the left image what it shows at (x − d, y) in the right image.
 *  - Larger disparity means nearer: where layers overlap, the one with the larger disparity is in front, in each image
 *    separately, so occlusions come out right.
 *  - Every pixel is the mean of 4 × 4 samples, so layer edges are anti-aliased.
 */

import { type Plane, createPlane } from './image';
import { random } from './noise';

export const SCENE_WIDTH = 192;
export const SCENE_HEIGHT = 144;
/** The largest disparity in the scene is below this. */
export const SCENE_D_MAX = 28;

export type LayerKind = 'background' | 'textured' | 'flat' | 'stripes' | 'disk';

interface Layer {
  kind: LayerKind;
  d: number;
  inside: (x: number, y: number) => boolean;
  value: (x: number, y: number) => number;
}

/** A sum of cosine waves with random directions and phases, frequencies in [fMin, fMax] cycles per pixel. */
function waves(seed: number, n: number, fMin: number, fMax: number, mean: number, amplitude: number): (x: number, y: number) => number {
  const rand = random(seed);
  const w = Array.from({ length: n }, () => {
    const f = 2 * Math.PI * (fMin + (fMax - fMin) * rand());
    const a = 2 * Math.PI * rand();
    return { kx: f * Math.cos(a), ky: f * Math.sin(a), phase: 2 * Math.PI * rand() };
  });
  const scale = amplitude / Math.sqrt(n / 2);
  return (x, y) => {
    let s = 0;
    for (const { kx, ky, phase } of w) s += Math.cos(kx * x + ky * y + phase);
    return mean + scale * s;
  };
}

const rect = (x0: number, x1: number, y0: number, y1: number) => (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1;

/** Back to front. */
export const LAYERS: Layer[] = [
  { kind: 'background', d: 3, inside: () => true, value: waves(21, 32, 0.06, 0.2, 0.56, 0.12) },
  { kind: 'flat', d: 8, inside: rect(104, 176, 92, 136), value: () => 0.72 },
  { kind: 'stripes', d: 11, inside: rect(18, 84, 104, 136), value: (x) => 0.5 + 0.3 * Math.sin((2 * Math.PI * x) / 6) },
  { kind: 'textured', d: 16, inside: rect(24, 84, 16, 84), value: waves(4, 32, 0.04, 0.14, 0.3, 0.2) },
  { kind: 'disk', d: 24, inside: (x, y) => (x - 136) ** 2 + (y - 46) ** 2 <= 26 ** 2, value: waves(9, 32, 0.08, 0.3, 0.62, 0.17) },
];

/** The front layer at a position of the left image, or of the right image (where layer content is shifted by d). */
function frontLayer(x: number, y: number, right: boolean): Layer {
  for (let k = LAYERS.length - 1; k >= 0; k--) {
    const l = LAYERS[k];
    if (l.inside(right ? x + l.d : x, y)) return l;
  }
  return LAYERS[0];
}

function render(right: boolean): Plane {
  const p = createPlane(SCENE_WIDTH, SCENE_HEIGHT);
  for (let y = 0; y < SCENE_HEIGHT; y++)
    for (let x = 0; x < SCENE_WIDTH; x++) {
      let sum = 0;
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) {
          const sx = x - 0.375 + 0.25 * i, sy = y - 0.375 + 0.25 * j;
          const l = frontLayer(sx, sy, right);
          sum += right ? l.value(sx + l.d, sy) : l.value(sx, sy);
        }
      p.data[y * SCENE_WIDTH + x] = sum / 16;
    }
  return p;
}

export interface StereoScene {
  left: Plane;
  right: Plane;
  /** True disparity per left pixel. */
  disparity: Float32Array;
  /** Left pixels whose point is hidden in the right image or lies outside it. */
  occluded: Uint8Array;
  /** The layer kind per left pixel. */
  kind: LayerKind[];
}

let cache: StereoScene | null = null;

export function stereoScene(): StereoScene {
  if (cache) return cache;
  const n = SCENE_WIDTH * SCENE_HEIGHT;
  const disparity = new Float32Array(n), occluded = new Uint8Array(n);
  const kind: LayerKind[] = new Array(n);
  for (let y = 0; y < SCENE_HEIGHT; y++)
    for (let x = 0; x < SCENE_WIDTH; x++) {
      const l = frontLayer(x, y, false);
      const i = y * SCENE_WIDTH + x;
      disparity[i] = l.d;
      kind[i] = l.kind;
      occluded[i] = x - l.d < 0 || frontLayer(x - l.d, y, true) !== l ? 1 : 0;
    }
  cache = { left: render(false), right: render(true), disparity, occluded, kind };
  return cache;
}
