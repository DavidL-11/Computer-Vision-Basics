import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from './image';
import { random } from './noise';
import { boxMean, costVolume, costsAt, hierarchicalSearch, pyramid, scanlineStereo, windowCost, winnerTakeAll } from './stereo';
import { SCENE_D_MAX, SCENE_WIDTH, stereoScene } from './stereoScene';

/** A random row texture seen by both cameras: R(x) = L(x + d), a fronto-parallel plane at disparity d. */
function pair(d: number, w = 48, h = 20): { L: Plane; R: Plane } {
  const rand = random(5);
  const base = Array.from({ length: (w + d) * h }, () => rand());
  const L = createPlane(w, h), R = createPlane(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      L.data[y * w + x] = base[y * (w + d) + x];
      R.data[y * w + x] = base[y * (w + d) + x + d];
    }
  return { L, R };
}

describe('window means', () => {
  it('averages over the window clipped to the image', () => {
    const m = boxMean([1, 2, 3, 4, 5, 6], 3, 2, 1);
    expect(m[0]).toBeCloseTo((1 + 2 + 4 + 5) / 4, 12);
    expect(m[1]).toBeCloseTo(21 / 6, 12);
  });
});

describe('matching costs', () => {
  const { L, R } = pair(5);

  it('are smallest at the true disparity, for SSD and NCC', () => {
    for (const metric of ['ssd', 'ncc'] as const) {
      const cv = costVolume(L, R, 10, 2, metric);
      const c = costsAt(cv, 30, 10);
      expect(c.indexOf(Math.min(...c))).toBe(5);
      expect(c[5]).toBeCloseTo(0, 4);
      expect(windowCost(L, R, 30, 10, 7, 2, metric)).toBeCloseTo(c[7], 5);
    }
  });

  it('has no match left of the image', () => {
    const cv = costVolume(L, R, 10, 2, 'ssd');
    expect(costsAt(cv, 3, 10)[4]).toBe(Infinity);
  });

  it('NCC ignores gain and bias, SSD does not', () => {
    const R2: Plane = { ...R, data: R.data.map((v) => 0.5 * v + 0.3) };
    expect(windowCost(L, R2, 30, 10, 5, 2, 'ncc')).toBeCloseTo(0, 4);
    expect(windowCost(L, R2, 30, 10, 5, 2, 'ssd')).toBeGreaterThan(0.01);
  });

  it('winner-take-all recovers a constant disparity', () => {
    const d = winnerTakeAll(costVolume(L, R, 10, 2, 'ssd'));
    expect(d[10 * 48 + 30]).toBe(5);
  });
});

describe('scanline stereo', () => {
  const { L, R } = pair(5);
  const cv = costVolume(L, R, 10, 1, 'ssd');

  it('matches every visible pixel with the right disparity', () => {
    const r = scanlineStereo(cv, 10, 0.05);
    for (let x = 8; x < 40; x++) expect(r.disparity[x]).toBe(5);
    // The first 5 left pixels have no partner in the right image.
    expect(r.disparity[0]).toBeNaN();
    expect(r.path[0]).toEqual([0, 0]);
    expect(r.path.at(-1)).toEqual([48, 48]);
    expect(r.matches + r.occlusions).toBe(r.path.length - 1);
  });

  it('occludes everything when occlusion is free', () => {
    const r = scanlineStereo(cv, 10, 0);
    expect(r.energy).toBe(0);
  });
});

describe('synthetic scene', () => {
  const s = stereoScene();

  it('has a consistent disparity map', () => {
    expect(s.left.width).toBe(SCENE_WIDTH);
    expect(Math.max(...s.disparity)).toBeLessThan(SCENE_D_MAX);
    // A visible pixel looks the same in the right image at x − d.
    for (const [x, y] of [[50, 50], [136, 46], [10, 10], [140, 110]]) {
      const i = y * SCENE_WIDTH + x;
      expect(s.occluded[i]).toBe(0);
      expect(s.right.data[y * SCENE_WIDTH + x - s.disparity[i]]).toBeCloseTo(s.left.data[i], 5);
    }
    expect(s.kind[50 * SCENE_WIDTH + 50]).toBe('textured');
  });

  it('marks the background next to the left of a near object as occluded', () => {
    // Background just left of the textured box (x = 24, d = 16 vs 3) is hidden behind the box in the right image.
    expect(s.occluded[50 * SCENE_WIDTH + 20]).toBe(1);
    expect(s.occluded[10 * SCENE_WIDTH + 100]).toBe(0);
  });
});

describe('hierarchical search', () => {
  it('finds a large disparity with a few evaluations per level', () => {
    const s = stereoScene();
    const Ls = pyramid(s.left, 2), Rs = pyramid(s.right, 2);
    const levels = hierarchicalSearch(Ls, Rs, 136, 46, SCENE_D_MAX, 3, 'ssd');
    expect(levels.map((l) => l.level)).toEqual([2, 1, 0]);
    expect(levels.at(-1)!.best).toBe(24);
    expect(levels[1].ds.length).toBe(3);
    expect(Ls[2].width).toBe(SCENE_WIDTH / 4);
  });
});
