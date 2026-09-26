import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/shared/linalg';
import { afov, applyP, dollyFocal, focalForAfov, orthographicP, perspectiveP, weakPerspectiveP } from './projection';

describe('angular field of view', () => {
  it('is 90° for f = H / 2', () => {
    expect(afov(24, 12)).toBeCloseTo(90, 12);
  });

  it('matches known lenses on a 24 mm high sensor', () => {
    expect(afov(24, 50)).toBeCloseTo(26.99, 2);
    expect(afov(24, 24)).toBeCloseTo(53.13, 2);
  });

  it('shrinks as f grows, and focalForAfov inverts it', () => {
    expect(afov(24, 100)).toBeLessThan(afov(24, 50));
    for (const f of [10, 35, 200]) expect(focalForAfov(24, afov(24, f))).toBeCloseTo(f, 9);
  });
});

describe('projection models', () => {
  const f = 800;

  it('perspective divides by the depth, so w = Z_c', () => {
    const p = applyP(perspectiveP(f), [1, -0.5, 4]);
    expect(p.w).toBe(4);
    expect(p.uv).toEqual([200, -100]);
  });

  it('weak perspective uses w = Z₀ for every point', () => {
    const P = weakPerspectiveP(f, 5);
    for (const Z of [2, 5, 50]) {
      const p = applyP(P, [1, -0.5, Z]);
      expect(p.w).toBe(5);
      expect(p.uv).toEqual([160, -80]);
    }
  });

  it('weak perspective approximates perspective for small depth differences around Z₀', () => {
    const Z0 = 20;
    const weak = weakPerspectiveP(f, Z0);
    const persp = perspectiveP(f);
    for (const dz of [-0.1, 0.05, 0.2]) {
      const X: Vec3 = [1.5, 0.8, Z0 + dz];
      const a = applyP(persp, X).uv;
      const b = applyP(weak, X).uv;
      // The relative error is about |ΔZ| / Z₀.
      expect(Math.abs(a[0] - b[0]) / Math.abs(b[0])).toBeLessThan((1.1 * Math.abs(dz)) / Z0);
    }
  });

  it('orthographic projection ignores the depth', () => {
    const P = orthographicP();
    expect(applyP(P, [1, 2, 3]).uv).toEqual([1, 2]);
    expect(applyP(P, [1, 2, 300]).uv).toEqual([1, 2]);
    expect(applyP(P, [1, 2, 300]).w).toBe(1);
  });

  it('weak perspective is orthographic projection scaled by f / Z₀', () => {
    const X: Vec3 = [0.3, -1.2, 7];
    const [u, v] = applyP(orthographicP(), X).uv;
    const weak = applyP(weakPerspectiveP(f, 4), X).uv;
    expect(weak[0]).toBeCloseTo((f / 4) * u, 12);
    expect(weak[1]).toBeCloseTo((f / 4) * v, 12);
  });
});

describe('dolly zoom', () => {
  it('keeps the image size of the subject constant', () => {
    const size = (f: number, D: number) => applyP(perspectiveP(f), [0, 1, D]).uv[1];
    const f0 = 50;
    const D0 = 6;
    for (const D of [3, 12, 40]) expect(size(dollyFocal(f0, D0, D), D)).toBeCloseTo(size(f0, D0), 12);
  });

  it('makes perspective converge to weak perspective as the camera moves away', () => {
    // A point 10 m behind the subject, in the dolly zoom that keeps the subject at 100 px per m.
    const error = (D: number) => {
      const f = 100 * D;
      const X: Vec3 = [1, 0, D + 10];
      return Math.abs(applyP(perspectiveP(f), X).uv[0] - applyP(weakPerspectiveP(f, D), X).uv[0]);
    };
    expect(error(40)).toBeLessThan(error(10));
    expect(error(1000)).toBeLessThan(1);
  });
});
