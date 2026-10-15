import { describe, expect, it } from 'vitest';
import { correlateSeparable, gaussianKernel } from '../../src/shared/filter';
import { type Plane, clamp01, createPlane } from '../../src/shared/image';
import { random } from '../../src/shared/noise';
import { IDENTITY, warp } from '../../src/shared/warp';
import { coarseToFine, errorSurface, levels, linearize, pyramid, windowAt, windowSamples } from './coarseToFine';

/** Random values blurred a little: detail at the scale of one or two pixels. */
function texture(seed: number, w = 96, h = 72): Plane {
  const rand = random(seed);
  const I = createPlane(w, h);
  for (let i = 0; i < I.data.length; i++) I.data[i] = rand();
  const g = gaussianKernel(1.2);
  const S = correlateSeparable(I, g, g, 'reflect');
  return { ...S, data: S.data.map((v) => clamp01(0.5 + 3 * (v - 0.5))) };
}

const I0 = texture(5);
const shifted = (tx: number, ty: number) => warp(I0, { ...IDENTITY, tx, ty });
const options = { iterations: 20, epsilon: 0.001 };
const win = { x: 48, y: 36, r: 7 };

describe('pyramid', () => {
  it('halves the size and keeps every other pixel', () => {
    const p = pyramid(I0, 3, false);
    expect(p.map((l) => [l.width, l.height])).toEqual([[96, 72], [48, 36], [24, 18], [12, 9]]);
    expect(p[2].data[3 * 24 + 5]).toBe(I0.data[12 * 96 + 20]);
  });

  it('low-pass filters before subsampling', () => {
    const p = pyramid(I0, 1, true);
    const g = gaussianKernel(1);
    const blurred = correlateSeparable(I0, g, g, 'clamp');
    expect(p[1].data[4 * 48 + 7]).toBeCloseTo(blurred.data[8 * 96 + 14], 6);
  });
});

describe('alignment', () => {
  it('has no error at the true integer shift and only counts the overlap', () => {
    const [L] = levels(I0, shifted(5, -3), 0, true, 0);
    const s = linearize(L, win, 5, -3);
    expect(s.E).toBeCloseTo(0, 10);
    expect(s.count).toBe(15 * 15);
    // The window covers x = 81 … 95, so with u = 5 its last 5 columns land outside I₁.
    const edge = { x: 88, y: 36, r: 7 };
    expect(linearize(L, edge, 5, -3).count).toBe(10 * 15);
    expect(windowSamples(L, edge, 5, -3).e.filter(Number.isNaN).length).toBe(5 * 15);
  });

  it('keeps the window radius and halves its position on every level, inside the image', () => {
    const pyr = levels(I0, I0, 3, true, 0);
    expect(windowAt(win, 2, pyr[2])).toEqual({ x: 12, y: 9, r: 7 });
    expect(windowAt({ x: 2, y: 70, r: 7 }, 1, pyr[1])).toEqual({ x: 7, y: 28, r: 7 });
    expect(windowAt(win, 3, pyr[3]).r).toBe(4);
  });

  it('fails on a large motion at a single scale, but succeeds coarse to fine', () => {
    const pyr = levels(I0, shifted(9.3, -6.4), 3, true, 1);
    const single = coarseToFine(pyr, win, 0, { ...options, iterations: 60 }).at(-1)!;
    expect(Math.hypot(single.u - 9.3, single.v + 6.4)).toBeGreaterThan(2);
    const steps = coarseToFine(pyr, win, 3, options);
    const last = steps.at(-1)!;
    expect(last.level).toBe(0);
    expect(Math.hypot(last.u - 9.3, last.v + 6.4)).toBeLessThan(0.05);
    expect(steps.map((s) => s.level)).toEqual([...steps.map((s) => s.level)].sort((a, b) => b - a));
  });

  it('starts each level at twice the result of the coarser one', () => {
    const steps = coarseToFine(levels(I0, shifted(6, 4), 2, true, 1), win, 2, options);
    const first1 = steps.findIndex((s) => s.level === 1);
    expect(steps[first1].u).toBe(steps[first1 - 1].u);
    expect(steps[first1].v).toBe(steps[first1 - 1].v);
  });
});

describe('error surface', () => {
  it('is smallest at the true shift on every level', () => {
    const pyr = levels(I0, shifted(4, -2), 2, true, 0);
    for (const l of [0, 2]) {
      const E = errorSurface(pyr[l], windowAt(win, l, pyr[l]), l, 6);
      const k = E.indexOf(Math.min(...E));
      expect([(k % 13) - 6, Math.floor(k / 13) - 6]).toEqual([4, -2]);
    }
  });
});
