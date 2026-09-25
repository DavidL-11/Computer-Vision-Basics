import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { gaussianNoise } from '../../src/shared/noise';
import {
  derivativeX,
  edgeMap,
  edgePeaks,
  filterWithGaussianDerivative,
  gaussianDerivative,
  gaussianDerivativeAt,
  row,
  smooth,
  zeroCrossings,
} from './derivatives';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

describe('central difference', () => {
  it('gives the slope of a ramp, and half of it at the borders', () => {
    const d = row(derivativeX(image(10, 1, (x) => 0.1 * x)), 0);
    for (let m = 1; m < 9; m++) expect(d[m]).toBeCloseTo(0.1, 6);
    expect(d[0]).toBeCloseTo(0.05, 6);
    expect(d[9]).toBeCloseTo(0.05, 6);
  });
});

describe('derivative of Gaussian', () => {
  it('follows G′σ(x) = −x/σ² Gσ(x) and is odd', () => {
    const sigma = 3;
    const dg = gaussianDerivative(sigma);
    const r = (dg.length - 1) / 2;
    const peak = Math.max(...dg);
    for (let m = 0; m < dg.length; m++) {
      // Central difference and truncation at 3σ cost a few percent of the peak value.
      expect(Math.abs(dg[m] - gaussianDerivativeAt(m - r, sigma))).toBeLessThan(0.05 * peak);
      expect(dg[m]).toBeCloseTo(-dg[dg.length - 1 - m], 7);
    }
  });

  it('as a convolution kernel, turns a ramp into its slope', () => {
    const dg = gaussianDerivative(2);
    const r = (dg.length - 1) / 2;
    // (f ∗ dg)[m] = Σ_k dg[k] (m − k) for f[m] = m.
    const slope = dg.reduce((sum, v, i) => sum - v * (i - r), 0);
    expect(slope).toBeCloseTo(1, 6);
  });

  it('d/dx (f ∗ g) = f ∗ dg/dx away from the left and right border', () => {
    const f = gaussianNoise(image(40, 12, (x, y) => (x > 20 ? 0.8 : 0.2) + 0.01 * y), 0.1, 3);
    for (const smoothing of ['row', 'xy'] as const) {
      const a = derivativeX(smooth(f, 1.5, smoothing));
      const b = filterWithGaussianDerivative(f, 1.5, smoothing);
      for (let y = 0; y < 12; y++) for (let x = 1; x < 39; x++) expect(a.data[y * 40 + x]).toBeCloseTo(b.data[y * 40 + x], 5);
    }
  });
});

describe('edges along a row', () => {
  const step = image(30, 1, (x) => (x < 15 ? 0.2 : 0.8));

  it('the first derivative peaks at a step, the second crosses zero between its two pixels', () => {
    const d = row(derivativeX(smooth(step, 2, 'row')), 0);
    const s = row(derivativeX({ width: 30, height: 1, data: d }), 0);
    // d[14] and d[15] are equal up to rounding, only one of them counts.
    const peaks = edgePeaks(d, 0.01);
    expect(peaks).toHaveLength(1);
    expect([14, 15]).toContain(peaks[0]);
    const crossings = zeroCrossings(s, d, 0.01);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toBeCloseTo(14.5, 3);
  });

  it('marks the peaks of every row', () => {
    const d = derivativeX(smooth(image(30, 4, (x, y) => (x < 10 + y ? 0.2 : 0.8)), 1, 'row'));
    const map = edgeMap(d, 0.01);
    for (let y = 0; y < 4; y++) expect([9 + y, 10 + y]).toContain(Array.from(map.subarray(y * 30, (y + 1) * 30)).indexOf(1));
    expect(map.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('noise gives many peaks in the raw derivative, few after smoothing', () => {
    const noisy = gaussianNoise(image(200, 1, (x) => (x < 100 ? 0.3 : 0.7)), 0.05, 1);
    const raw = edgePeaks(row(derivativeX(noisy), 0), 0.04).length;
    const smoothed = edgePeaks(row(derivativeX(smooth(noisy, 3, 'row')), 0), 0.04);
    expect(raw).toBeGreaterThan(10);
    expect(smoothed).toHaveLength(1);
    expect(Math.abs(smoothed[0] - 99.5)).toBeLessThanOrEqual(2);
  });
});
