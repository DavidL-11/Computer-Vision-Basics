import { describe, expect, it } from 'vitest';
import { fft2, ifft2 } from '../../src/shared/fft';
import { boxKernel1D, correlateSeparable } from '../../src/shared/filter';
import { createPlane, psnr } from '../../src/shared/image';
import {
  alongU,
  degrade,
  gaussianNoise,
  gaussianTransfer,
  motionTransfer,
  multiply,
  quantize8,
  restorationFilter,
  restore,
} from './deconvolution';

const N = 32;

function testImage() {
  const p = createPlane(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) p.data[y * N + x] = (x > 8 && x < 20 && y > 5 && y < 25 ? 0.8 : 0.2) + ((x * 7 + y * 3) % 5) / 20;
  return p;
}

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

describe('blur transfer functions', () => {
  it('keep the mean: H(0, 0) = 1', () => {
    expect(gaussianTransfer(N, 2).data[0]).toBe(1);
    expect(motionTransfer(N, 7).data[0]).toBeCloseTo(1, 12);
  });

  it('motion blur in the frequency domain equals sliding a box along the rows (periodic border)', () => {
    const p = testImage();
    const viaFrequency = ifft2(multiply(fft2(p), motionTransfer(N, 5)));
    const direct = correlateSeparable(p, boxKernel1D(5), Float32Array.of(1), 'wrap');
    expect(maxDiff(viaFrequency.data, direct.data)).toBeLessThan(1e-6);
  });

  it('the Gaussian transfer function belongs to a normalized Gaussian kernel', () => {
    const sigma = 2;
    const impulse = createPlane(N, N);
    impulse.data[0] = 1;
    const kernel = ifft2(multiply(fft2(impulse), gaussianTransfer(N, sigma)));
    expect(kernel.data[0]).toBeCloseTo(1 / (2 * Math.PI * sigma ** 2), 5);
    expect(kernel.data[1] / kernel.data[0]).toBeCloseTo(Math.exp(-1 / (2 * sigma ** 2)), 5);
  });

  it('alongU returns H(0, 0) … H(N/2, 0)', () => {
    expect(alongU(motionTransfer(N, 3))).toHaveLength(N / 2 + 1);
  });
});

describe('restoration', () => {
  const f = testImage();
  const F = fft2(f);

  it('the inverse filter undoes the blur exactly without noise', () => {
    const H = gaussianTransfer(N, 1.5);
    const { G } = degrade(F, H, 0, 1, false);
    const restored = restore(G, restorationFilter(H, 'inverse', 0));
    expect(maxDiff(restored.data, f.data)).toBeLessThan(1e-5);
  });

  it('a tiny amount of noise makes the inverse filter explode, regularization tames it', () => {
    const H = gaussianTransfer(N, 1.5);
    const { g, G } = degrade(F, H, 1e-3, 1, false);
    const inverse = restore(G, restorationFilter(H, 'inverse', 0));
    const wiener = restore(G, restorationFilter(H, 'wiener', 1e-3));
    expect(psnr(f, inverse)).toBeLessThan(psnr(f, g));
    expect(psnr(f, wiener)).toBeGreaterThan(psnr(f, g));
  });

  it('Wiener approaches the inverse filter for K → 0 and blocks everything for large K', () => {
    const H = gaussianTransfer(N, 1);
    const inverse = restorationFilter(H, 'inverse', 0);
    const small = restorationFilter(H, 'wiener', 1e-12);
    const large = restorationFilter(H, 'wiener', 1e6);
    expect(small.data[1] / inverse.data[1]).toBeCloseTo(1, 6);
    expect(Math.max(...large.data)).toBeLessThan(1e-5);
  });

  it('the truncated inverse drops frequencies where |H| < ε', () => {
    const H = gaussianTransfer(N, 2);
    const eps = 0.1;
    const R = restorationFilter(H, 'truncated', eps);
    H.data.forEach((h, i) => expect(R.data[i]).toBe(h >= eps ? 1 / h : 0));
  });
});

describe('noise', () => {
  it('Gaussian noise has the requested standard deviation and is repeatable', () => {
    const n = gaussianNoise(64, 64, 0.1, 3);
    const mean = n.data.reduce((s, v) => s + v, 0) / n.data.length;
    const sd = Math.sqrt(n.data.reduce((s, v) => s + (v - mean) ** 2, 0) / n.data.length);
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(sd).toBeCloseTo(0.1, 2);
    expect(gaussianNoise(64, 64, 0.1, 3).data).toEqual(n.data);
  });

  it('8-bit rounding snaps to multiples of 1/255', () => {
    const p = { width: 3, height: 1, data: Float32Array.from([0.1, -0.2, 1.3]) };
    expect(Array.from(quantize8(p).data)).toEqual([26 / 255, 0, 1].map(Math.fround));
  });
});
