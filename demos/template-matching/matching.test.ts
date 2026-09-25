import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { extractPatch, findPeaks, prepareTemplate, scoreAt, scoreMap } from './matching';

/** Gray background with a small dark ring at (10, 10) and a white square at (30, 10). */
function scene(): Plane {
  const p = createPlane(44, 24);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const d = Math.hypot(x - 10, y - 10);
      p.data[y * p.width + x] = Math.abs(d - 3) < 1 ? 0.1 : x >= 25 && x < 36 && y >= 5 && y < 16 ? 1 : 0.5;
    }
  return p;
}

describe('template matching', () => {
  const I = scene();
  const t = prepareTemplate(extractPatch(I, 10, 10, 9));

  it('an exact copy gives NCC = 1 and SSD = 0', () => {
    expect(scoreAt(I, t, 10, 10, 'ncc')).toBeCloseTo(1, 6);
    expect(scoreAt(I, t, 10, 10, 'ssd')).toBeCloseTo(0, 9);
  });

  it('NCC is invariant to bias and gain α·I + β', () => {
    const J = { ...I, data: I.data.map((v) => 0.3 * v + 0.2) };
    for (const [m, n] of [
      [10, 10],
      [14, 12],
      [30, 10],
    ]) {
      expect(scoreAt(J, t, m, n, 'ncc')).toBeCloseTo(scoreAt(I, t, m, n, 'ncc'), 5);
    }
  });

  it('raw correlation prefers a bright flat area over the true match', () => {
    const [best] = findPeaks(scoreMap(I, t, 'correlation'), 1, 4, 9);
    expect(best.x).toBeGreaterThanOrEqual(25);
    const [nccBest] = findPeaks(scoreMap(I, t, 'ncc'), 1, 4, 9);
    expect([nccBest.x, nccBest.y]).toEqual([10, 10]);
  });

  it('leaves positions where the template does not fit at 0', () => {
    const map = scoreMap(I, t, 'ncc');
    expect(map.data[3 * I.width + 20]).toBe(0);
    expect(map.data[10 * I.width + 40]).toBe(0);
  });
});

describe('non-maximum suppression', () => {
  it('reports each peak once, best first', () => {
    const map = createPlane(20, 10);
    map.data[5 * 20 + 5] = 1;
    map.data[5 * 20 + 6] = 0.9;
    map.data[5 * 20 + 14] = 0.8;
    const peaks = findPeaks(map, 3, 1, 4);
    expect(peaks.slice(0, 2)).toEqual([
      { x: 5, y: 5, score: 1 },
      { x: 14, y: 5, score: expect.closeTo(0.8, 6) },
    ]);
    expect(peaks[2].score).toBe(0);
  });
});
