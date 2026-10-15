import { describe, expect, it } from 'vitest';
import { depthResolution, pixelCell, project, triangulate, visibleInBoth } from './triangulation';

describe('rectified stereo', () => {
  it('has the disparity d = f T / Z', () => {
    const { xL, xR } = project(0.1, 700, { X: 0.3, Z: 2 });
    expect(xL - xR).toBeCloseTo(35, 9);
  });

  it('recovers the point from its two projections', () => {
    const p = { X: -0.7, Z: 5.5 };
    const { xL, xR } = project(0.3, 120, p);
    const q = triangulate(0.3, 120, xL, xR)!;
    expect(q.X).toBeCloseTo(p.X, 12);
    expect(q.Z).toBeCloseTo(p.Z, 12);
  });

  it('puts zero disparity at infinity', () => {
    expect(triangulate(0.3, 120, 4, 4)).toBeNull();
    expect(triangulate(0.3, 120, 3, 4)).toBeNull();
  });

  it('loses depth resolution quadratically with distance', () => {
    expect(depthResolution(0.1, 700, 4) / depthResolution(0.1, 700, 2)).toBeCloseTo(4, 12);
    // One pixel of disparity at d = 35 changes Z by about Z² / (f T).
    const Z = triangulate(0.1, 700, 17.5, -16.5)!.Z;
    expect(Z - 2).toBeCloseTo(depthResolution(0.1, 700, 2), 1);
  });

  it('bounds the pixel cell between the depths of d + 1 and d − 1', () => {
    const cell = pixelCell(0.3, 100, 10, 2, 50);
    const zs = cell.map((p) => p.Z);
    expect(Math.min(...zs)).toBeCloseTo((100 * 0.3) / 9, 9);
    expect(Math.max(...zs)).toBeCloseTo((100 * 0.3) / 7, 9);
    // At d = 0 the cell reaches as far as it is drawn.
    expect(Math.max(...pixelCell(0.3, 100, 0, 0, 50).map((p) => p.Z))).toBeCloseTo(50, 9);
  });

  it('needs the point in both images', () => {
    expect(visibleInBoth(0.3, 100, 160, { X: 0.15, Z: 3 })).toBe(true);
    expect(visibleInBoth(2, 100, 160, { X: 1, Z: 0.5 })).toBe(false);
  });
});
