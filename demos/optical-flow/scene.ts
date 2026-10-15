/**
 * A synthetic two-frame scene with a known flow: four cards move by one translation in front of a textured
 * background that moves by another. Each card has a textured frame around an interior that is textured, flat,
 * striped or repetitive.
 *
 * Conventions:
 *  - x to the right, y down, pixel centers at integer coordinates.
 *  - Every layer is a continuous function, so subpixel motion is exact. A layer that moves by t shows at x in I₁
 *    what it showed at x − t in I₀, so the true flow at x is t and I₁(x + t) = I₀(x) wherever the layer stays
 *    visible.
 *  - Card edges and interiors are anti-aliased by 4 × 4 supersampling of their shapes; textures are sampled at pixel
 *    centers and contain no frequencies above about 0.17 cycles per pixel.
 */

import { type Plane, createPlane } from '../../src/shared/image';
import { gaussianNoise, random } from '../../src/shared/noise';
import type { Flow } from './flow';

export const WIDTH = 160;
export const HEIGHT = 120;

/**
 * Region labels: 0 is the background; 1 the textured parts of the cards (the first card and the frames of the
 * others); 2 … 4 the interiors of the other cards.
 */
export const REGIONS = ['background', 'textured', 'flat', 'stripes', 'repetitive'] as const;
export type Region = (typeof REGIONS)[number];

/** Pixels within this many pixels of a motion boundary (Chebyshev distance) count as boundary pixels. */
export const BOUNDARY = 3;
/** Pixels this close to the image border are left out of the statistics: the background moves in and out there. */
export const MARGIN = 4;

/** Period of the repetitive pattern: it repeats after (c, c), (c, −c) and (2c, 0). */
export const CELL = 3;
/** Stripe period in pixels and the angle of the stripes' normal against +x. */
export const STRIPE_PERIOD = 10;
export const STRIPE_NORMAL = (100 * Math.PI) / 180;

/** Half the side of a card, and of its interior (the radius for the flat disk). */
export const CARD = 24;
export const INTERIOR = 16;
export const CARD_CENTERS = [
  [40, 32],
  [120, 32],
  [40, 88],
  [120, 88],
] as const;

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

const background = waves(11, 32, 0.06, 0.16, 0.5, 0.17);
const textured = waves(5, 32, 0.06, 0.16, 0.3, 0.15);
const nx = Math.cos(STRIPE_NORMAL), ny = Math.sin(STRIPE_NORMAL);

/** The interior of each card, at a position relative to the card's center. */
const INTERIORS: ((x: number, y: number) => number)[] = [
  textured,
  () => 0.86,
  (x, y) => 0.5 + 0.35 * Math.sin((2 * Math.PI * (nx * x + ny * y)) / STRIPE_PERIOD),
  (x, y) => 0.5 + 0.42 * Math.sin((Math.PI * x) / CELL) * Math.sin((Math.PI * y) / CELL),
];

const inCard = (x: number, y: number) => Math.max(Math.abs(x), Math.abs(y)) <= CARD;
const inInterior = (k: number, x: number, y: number) => (k === 1 ? x * x + y * y <= INTERIOR * INTERIOR : Math.max(Math.abs(x), Math.abs(y)) <= INTERIOR);

/** Fraction of the pixel around (x, y), relative to a card's center, inside the region, from 4 × 4 samples. */
function coverage(inside: (x: number, y: number) => boolean, x: number, y: number, half: number): number {
  const d = Math.max(Math.abs(x), Math.abs(y));
  if (d > half * Math.SQRT2 + 1) return 0;
  let n = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (inside(x - 0.375 + 0.25 * i, y - 0.375 + 0.25 * j)) n++;
  return n / 16;
}

/** The card k at a position relative to its center: its coverage of the pixel and its mean value there. */
function card(k: number, x: number, y: number): [number, number] {
  const c = coverage(inCard, x, y, CARD);
  if (c === 0) return [0, 0];
  const ci = k === 0 ? 1 : coverage((a, b) => inInterior(k, a, b), x, y, INTERIOR);
  return [c, ci * INTERIORS[k](x, y) + (1 - ci) * textured(x, y)];
}

/** The frame with the cards moved by `obj` and the background by `bg`. */
export function render(obj: readonly [number, number], bg: readonly [number, number]): Plane {
  const I = createPlane(WIDTH, HEIGHT);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      let value = 0, covered = 0;
      CARD_CENTERS.forEach(([cx, cy], k) => {
        const [c, v] = card(k, x - obj[0] - cx, y - obj[1] - cy);
        value += c * v;
        covered += c;
      });
      I.data[y * WIDTH + x] = value + (1 - covered) * background(x - bg[0], y - bg[1]);
    }
  return I;
}

/** The card covering most of the pixel (x, y) of I₀, or −1. */
function cardAt(x: number, y: number): number {
  return CARD_CENTERS.findIndex(([cx, cy]) => coverage(inCard, x - cx, y - cy, CARD) >= 0.5);
}

/** Per pixel of I₀: its region, whether it lies within BOUNDARY pixels of a motion boundary, and its card. */
export function regions(): { label: Uint8Array; boundary: Uint8Array; layer: Int8Array } {
  const n = WIDTH * HEIGHT;
  const label = new Uint8Array(n), layer = new Int8Array(n);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const k = cardAt(x, y);
      const i = y * WIDTH + x;
      layer[i] = k;
      if (k < 0) continue;
      const [cx, cy] = CARD_CENTERS[k];
      label[i] = k > 0 && coverage((a, b) => inInterior(k, a, b), x - cx, y - cy, INTERIOR) >= 0.5 ? k + 1 : 1;
    }
  const boundary = new Uint8Array(n);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const moving = layer[y * WIDTH + x] >= 0;
      search: for (let j = -BOUNDARY; j <= BOUNDARY; j++)
        for (let i = -BOUNDARY; i <= BOUNDARY; i++) {
          const u = x + i, v = y + j;
          if (u >= 0 && v >= 0 && u < WIDTH && v < HEIGHT && layer[v * WIDTH + u] >= 0 !== moving) {
            boundary[y * WIDTH + x] = 1;
            break search;
          }
        }
    }
  return { label, boundary, layer };
}

export function trueFlow(layer: Int8Array, obj: readonly [number, number], bg: readonly [number, number]): Flow {
  const u = new Float32Array(WIDTH * HEIGHT), v = new Float32Array(WIDTH * HEIGHT);
  layer.forEach((k, i) => {
    u[i] = k >= 0 ? obj[0] : bg[0];
    v[i] = k >= 0 ? obj[1] : bg[1];
  });
  return { width: WIDTH, height: HEIGHT, u, v };
}

/** Background pixels of I₀ that a card covers in I₁: they have no correspondence. */
export function occluded(obj: readonly [number, number], bg: readonly [number, number], layer: Int8Array): Uint8Array {
  const out = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) if (layer[y * WIDTH + x] < 0 && cardAt(x + bg[0] - obj[0], y + bg[1] - obj[1]) >= 0) out[y * WIDTH + x] = 1;
  return out;
}

/** Pixels that count in the statistics: not within MARGIN of the image border. */
export function counted(x: number, y: number): boolean {
  return x >= MARGIN && y >= MARGIN && x < WIDTH - MARGIN && y < HEIGHT - MARGIN;
}

export interface Scene {
  I0: Plane;
  I1: Plane;
  truth: Flow;
  label: Uint8Array;
  boundary: Uint8Array;
  occluded: Uint8Array;
}

export function scene(obj: readonly [number, number], bg: readonly [number, number], noise: number): Scene {
  const { label, boundary, layer } = regions();
  let I0 = render([0, 0], [0, 0]);
  let I1 = render(obj, bg);
  if (noise > 0) {
    I0 = gaussianNoise(I0, noise, 1);
    I1 = gaussianNoise(I1, noise, 2);
  }
  return { I0, I1, truth: trueFlow(layer, obj, bg), label, boundary, occluded: occluded(obj, bg, layer) };
}
