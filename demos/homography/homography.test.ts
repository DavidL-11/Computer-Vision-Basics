import { describe, expect, it } from 'vitest';
import { createPlane } from '../../src/shared/image';
import { type Mat3, det3, inverse3 } from '../../src/shared/linalg';
import { matVec } from '../../src/shared/matrix';
import { type Vec2, estimateHomography, homographyRows, inverseWarp, mapPoint, rectangle } from './homography';

const H_TRUE: Mat3 = [0.9, 0.2, 30, -0.1, 1.1, 20, 0.0008, -0.0005, 1];
const SRC: Vec2[] = rectangle(200, 150);
const photo = SRC.map((p) => mapPoint(H_TRUE, p));

describe('homographyRows', () => {
  it('vanishes for the true h', () => {
    for (const row of homographyRows(SRC[2], photo[2])) expect(row.reduce((s, v, i) => s + v * H_TRUE[i], 0)).toBeCloseTo(0, 9);
  });
});

describe('estimateHomography', () => {
  it('recovers H from 4 exact correspondences', () => {
    const { H, A, h } = estimateHomography(SRC, photo);
    H.forEach((v, i) => expect(v).toBeCloseTo(H_TRUE[i], 9));
    expect(A.length).toBe(8);
    expect(Math.hypot(...matVec(A, h))).toBeLessThan(1e-9);
  });

  it('has a smallest singular value ≈ 0 when more exact points are used', () => {
    const src: Vec2[] = [...SRC, [100, 75], [20, 120]];
    const { svd, H } = estimateHomography(
      src,
      src.map((p) => mapPoint(H_TRUE, p)),
    );
    expect(svd.sigma.length).toBe(9);
    expect(svd.sigma[8] / svd.sigma[0]).toBeLessThan(1e-12);
    H.forEach((v, i) => expect(v).toBeCloseTo(H_TRUE[i], 9));
  });

  it('gives a second tiny singular value when three points are collinear in both images', () => {
    const src: Vec2[] = [
      [0, 0],
      [100, 0],
      [200, 0],
      [60, 150],
    ];
    const { svd } = estimateHomography(
      src,
      src.map((p) => mapPoint(H_TRUE, p)),
    );
    expect(svd.sigma[7] / svd.sigma[0]).toBeLessThan(1e-12);
  });

  it('gives a singular H when three points are collinear in only one image', () => {
    const quad: Vec2[] = [
      [70, 40],
      [262, 62],
      [290, 205],
      [166, 51],
    ];
    const { H } = estimateHomography(quad, rectangle(256, 192));
    const n = Math.hypot(...H);
    expect(Math.abs(det3(H)) / n ** 3).toBeLessThan(1e-3);
  });
});

describe('inverseWarp', () => {
  it('undoes a homography inside the image', () => {
    const src = createPlane(64, 48);
    src.data.forEach((_, k) => (src.data[k] = ((k % 64) + Math.floor(k / 64)) / 112));
    const H: Mat3 = [1.1, 0.05, 4, 0.02, 0.95, 3, 0.001, 0.0005, 1];
    // The photo shows src mapped by H (its pixels look up H⁻¹ p); looking up H p in the photo brings src back.
    const photo = inverseWarp(src, inverse3(H), 80, 64, 0);
    const back = inverseWarp(photo, H, 64, 48, 0);
    // The function is linear in x and y, so bilinear interpolation reproduces it exactly away from the border.
    for (const [i, j] of [
      [20, 20],
      [40, 30],
      [10, 35],
    ])
      expect(back.data[j * 64 + i]).toBeCloseTo(src.data[j * 64 + i], 4);
  });

  it('fills positions outside the source', () => {
    const src = createPlane(4, 4);
    src.data.fill(1);
    const out = inverseWarp(src, [1, 0, 10, 0, 1, 0, 0, 0, 1], 4, 4, 0.5);
    expect(Array.from(out.data)).toEqual(new Array(16).fill(0.5));
  });
});
