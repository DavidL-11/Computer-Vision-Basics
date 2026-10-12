import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { random } from '../../src/shared/noise';
import { IDENTITY, warp } from '../../src/shared/warp';
import { type CostParams, best, cost, costSurface, fitGainBias, ncc, rho, samples } from './cost';

function texture(seed: number): Plane {
  const rand = random(seed);
  const I = createPlane(40, 30);
  for (let i = 0; i < I.data.length; i++) I.data[i] = 0.2 + 0.6 * rand();
  return I;
}

const I0 = texture(1);
const params: CostParams = { p: 1.5, a: 0.1, border: 'clamp' };
const shifted = (tx: number, ty: number, gain = 1, bias = 0) => warp(I0, { ...IDENTITY, tx, ty, gain, bias });

describe('robust kernels', () => {
  it('Geman–McClure is quadratic near 0 and saturates at a²', () => {
    expect(rho('gm', 0.001, params)).toBeCloseTo(0.001 ** 2, 9);
    expect(rho('gm', 100, params)).toBeCloseTo(params.a ** 2, 5);
    expect(rho('lp', -0.5, params)).toBeCloseTo(0.5 ** 1.5, 12);
  });
});

describe('matching costs', () => {
  const I1 = shifted(3, -2);

  it('SSD is 0 at the true integer shift and finds it', () => {
    const s = samples(I0, I1, 20, 15, 3, 3, -2, params);
    expect(cost('ssd', s, params)).toBeCloseTo(0, 10);
    const E = costSurface(I0, I1, 20, 15, 3, 5, 'ssd', params);
    expect(best(E, 5, 'ssd')).toMatchObject({ u: 3, v: -2 });
  });

  it('Lp with p = 2 is the square root of the SSD', () => {
    const s = samples(I0, I1, 20, 15, 3, 1, 1, params);
    expect(cost('lp', s, { ...params, p: 2 })).toBeCloseTo(Math.sqrt(cost('ssd', s, params)), 10);
  });

  it('NCC and SSD with bias and gain ignore an affine intensity change', () => {
    const I2 = shifted(-2, 1, 0.5, 0.3);
    const s = samples(I0, I2, 20, 15, 3, -2, 1, params);
    expect(cost('ncc', s, params)).toBeCloseTo(1, 6);
    expect(cost('gain-bias', s, params)).toBeCloseTo(0, 8);
    expect(cost('ssd', s, params)).toBeGreaterThan(0.1);
    for (const m of ['ncc', 'gain-bias'] as const) expect(best(costSurface(I0, I2, 20, 15, 3, 4, m, params), 4, m)).toMatchObject({ u: -2, v: 1 });
  });

  it('fits gain and bias by linear regression', () => {
    const i0 = [0.1, 0.4, 0.7, 0.2];
    const { alpha, beta } = fitGainBias(i0, i0.map((v) => 2 * v - 0.1));
    expect(alpha).toBeCloseTo(2, 12);
    expect(beta).toBeCloseTo(-0.1, 12);
    expect(ncc(i0, i0.map((v) => -v))).toBeCloseTo(-1, 12);
  });
});

describe('masks and normalization', () => {
  it('only counts pixels inside both images and outside the mask', () => {
    const I1 = shifted(0, 0);
    // The window around (1, 1) with r = 2 reaches 1 pixel beyond the left and top border.
    const s = samples(I0, I1, 1, 1, 2, 0, 0, { ...params, border: 'wsrd' });
    expect(s.i0.length).toBe(16);
    const m = samples(I0, I1, 10, 10, 2, 0, 0, { ...params, border: 'wsrd', masked1: (x) => x === 10 });
    expect(m.i0.length).toBe(20);
    expect(m.counted.filter(Boolean).length).toBe(20);
  });

  it('NWSRD is the mean of ρ over the counted pixels', () => {
    const I1 = shifted(1, 0);
    const p: CostParams = { ...params, border: 'nwsrd' };
    const s = samples(I0, I1, 2, 3, 3, -3, 0, p);
    const mean = s.i0.reduce((sum, v, k) => sum + Math.abs(s.i1[k] - v), 0) / s.i0.length;
    expect(cost('sad', s, p)).toBeCloseTo(mean, 12);
    expect(cost('sad', s, { ...p, border: 'wsrd' })).toBeCloseTo(mean * s.i0.length, 12);
  });
});
