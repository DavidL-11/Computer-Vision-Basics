/**
 * Kernel presets and repeated filtering for the convolution playground.
 *
 * Filter weights are kept as strings, so that fractions like "1/9" stay readable in the editor.
 * Cells are row-major, row l = −r … r from top to bottom, column k = −r … r from left to right.
 */

import { type Border, correlate, flipKernel } from '../../src/shared/filter';
import { type Plane, clamp01, createPlane } from '../../src/shared/image';

export type Operation = 'correlation' | 'convolution';
export type Display = 'clip' | 'signed' | 'abs';

export interface Preset {
  label: string;
  rows: string[][];
  /** The result is centered around 0 (derivative filters), so show it signed. */
  signed?: boolean;
}

const fill = (size: number, value: string) => Array.from({ length: size }, () => Array<string>(size).fill(value));
const binomial = [1, 4, 6, 4, 1];

export const PRESETS = {
  identity: {
    label: 'identity',
    rows: [
      ['0', '0', '0'],
      ['0', '1', '0'],
      ['0', '0', '0'],
    ],
  },
  shift: {
    label: 'shift by [2, 1]',
    rows: fill(5, '0').map((row, v) => row.map((c, u) => (u === 4 && v === 3 ? '1' : c))),
  },
  box3: { label: 'box 3 × 3', rows: fill(3, '1/9') },
  box5: { label: 'box 5 × 5', rows: fill(5, '1/25') },
  gauss5: { label: 'Gaussian 5 × 5', rows: binomial.map((a) => binomial.map((b) => `${a * b}/256`)) },
  sharpen: {
    label: 'sharpen',
    rows: [
      ['0', '-1', '0'],
      ['-1', '5', '-1'],
      ['0', '-1', '0'],
    ],
  },
  sobelX: {
    label: 'Sobel Sx',
    signed: true,
    rows: [
      ['-1', '0', '1'],
      ['-2', '0', '2'],
      ['-1', '0', '1'],
    ],
  },
  sobelY: {
    label: 'Sobel Sy',
    signed: true,
    rows: [
      ['-1', '-2', '-1'],
      ['0', '0', '0'],
      ['1', '2', '1'],
    ],
  },
  emboss: {
    label: 'emboss',
    rows: [
      ['-2', '-1', '0'],
      ['-1', '1', '1'],
      ['0', '1', '2'],
    ],
  },
  custom3: { label: 'custom 3 × 3', rows: fill(3, '0') },
  custom5: { label: 'custom 5 × 5', rows: fill(5, '0') },
} satisfies Record<string, Preset>;

export type PresetName = keyof typeof PRESETS;

export const isCustom = (name: PresetName) => name === 'custom3' || name === 'custom5';

/** A number such as "-0.5" or a fraction such as "-1/9"; null if the text is neither. */
export function parseWeight(text: string): number | null {
  const m = text.trim().replace('−', '-').match(/^(-?\d*\.?\d+)(?:\s*\/\s*(\d*\.?\d+))?$/);
  if (!m) return null;
  const value = m[2] === undefined ? Number(m[1]) : Number(m[1]) / Number(m[2]);
  return Number.isFinite(value) ? value : null;
}

/** Invalid cells count as 0. */
export function kernelFromCells(rows: string[][]): Plane {
  const k = createPlane(rows[0].length, rows.length);
  k.data.set(rows.flat().map((c) => parseWeight(c) ?? 0));
  return k;
}

/** Crops or zero-pads around the center to a size × size kernel. */
export function resizeCells(rows: string[][], size: number): string[][] {
  const offset = (rows.length - size) / 2;
  return Array.from({ length: size }, (_, v) => Array.from({ length: size }, (_, u) => rows[v + offset]?.[u + offset] ?? '0'));
}

/** The filter that is actually slid over the image: for convolution, the flipped one. */
export const effectiveKernel = (k: Plane, op: Operation) => (op === 'convolution' ? flipKernel(k) : k);

/** Applies the filter `times` times. Also returns the input of the last pass, for inspecting one output pixel. */
export function filterRepeated(p: Plane, k: Plane, op: Operation, border: Border, times: number): { input: Plane; result: Plane } {
  const kernel = effectiveKernel(k, op);
  let input = p;
  let result = correlate(p, kernel, border);
  for (let n = 1; n < times; n++) {
    input = result;
    result = correlate(result, kernel, border);
  }
  return { input, result };
}

/** Maps a filter response to a gray value: clipped to [0, 1], signed with 0 as mid-gray, or its magnitude. */
export function displayValue(v: number, mode: Display): number {
  if (mode === 'signed') return clamp01(0.5 + v / 2);
  return clamp01(mode === 'abs' ? Math.abs(v) : v);
}
