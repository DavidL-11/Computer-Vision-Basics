import { describe, expect, it } from 'vitest';
import { costVolume, winnerTakeAll } from '../../src/shared/stereo';
import { type RdsOptions, shapeLevel, stereogram } from './rds';

const options: RdsOptions = { width: 80, height: 60, shape: 'square', dBackground: 2, dShape: 8, density: 0.5, dot: 1, seed: 3 };

describe('random-dot stereogram', () => {
  const s = stereogram(options);

  it('shows the shape only as a disparity', () => {
    const at = (x: number, y: number) => s.disparity[y * 80 + x];
    expect(at(40, 30)).toBe(8);
    expect(at(5, 5)).toBe(2);
    // Visible pixels look the same in the right image at x − d.
    for (const [x, y] of [[40, 30], [5, 5], [70, 50]]) {
      const i = y * 80 + x;
      expect(s.occluded[i]).toBe(0);
      expect(s.right.data[i - at(x, y)]).toBe(s.left.data[i]);
    }
  });

  it('has about the requested share of black dots, inside and outside the shape', () => {
    const black = (from: number, to: number) => {
      let n = 0;
      for (let y = 0; y < 60; y++) for (let x = from; x < to; x++) n += s.left.data[y * 80 + x] === 0 ? 1 : 0;
      return n / (60 * (to - from));
    };
    expect(black(0, 20)).toBeGreaterThan(0.4);
    expect(black(0, 20)).toBeLessThan(0.6);
    expect(black(30, 50)).toBeGreaterThan(0.4);
  });

  it('marks the background left of the shape as occluded', () => {
    // The square spans x = 22 … 58; the 6 px of background just left of it are hidden in the right image.
    expect(s.occluded[30 * 80 + 19]).toBe(1);
    expect(s.occluded[30 * 80 + 10]).toBe(0);
  });

  it('can be recovered by window matching', () => {
    const d = winnerTakeAll(costVolume(s.left, s.right, 12, 2, 'ssd'));
    expect(d[30 * 80 + 40]).toBe(8);
    expect(d[10 * 80 + 60]).toBe(2);
  });

  it('describes the shapes', () => {
    expect(shapeLevel('ring', 0, 0, 10)).toBe(0);
    expect(shapeLevel('ring', 7, 0, 10)).toBe(1);
    expect(shapeLevel('steps', 2, 2, 10)).toBe(2);
    expect(shapeLevel('disk', 8, 8, 10)).toBe(0);
  });
});
