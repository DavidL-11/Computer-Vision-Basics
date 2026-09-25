import { describe, expect, it } from 'vitest';
import { fft2, freqIndex, ifft2 } from '../../src/shared/fft';
import { boxKernel1D, correlateSeparable, gaussianKernel, outerProduct } from '../../src/shared/filter';
import { centerCrop, createPlane } from '../../src/shared/image';
import {
  addPeriodicNoise,
  allPass,
  applyFilter,
  basisImage,
  component,
  energyFraction,
  kernelTransfer,
  paintDisc,
  radialFilter,
} from './spectrum';

const N = 32;

function testImage() {
  const p = createPlane(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) p.data[y * N + x] = (x > 8 && x < 20 && y > 5 && y < 25 ? 0.8 : 0.2) + ((x * 7 + y * 3) % 5) / 20;
  return p;
}

const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

describe('centerCrop', () => {
  it('keeps the middle', () => {
    const p = createPlane(6, 4);
    p.data.forEach((_, i) => (p.data[i] = i));
    expect(Array.from(centerCrop(p, 2, 2).data)).toEqual([8, 9, 14, 15]);
  });
});

describe('basis images and components', () => {
  it('a basis image has peaks only at DC and ±(u, v)', () => {
    const [u, v] = [5, -3];
    const S = fft2(basisImage(u, v, N));
    const peaks = new Set([0, freqIndex(v, N) * N + freqIndex(u, N), freqIndex(-v, N) * N + freqIndex(-u, N)]);
    for (let i = 0; i < S.re.length; i++) expect(Math.hypot(S.re[i], S.im[i]) > 1).toBe(peaks.has(i));
  });

  it('recovers amplitude and phase of a cosine', () => {
    const p = addPeriodicNoise(createPlane(N, N), 4, 2, 0.3);
    const c = component(fft2(p), 4, 2);
    expect(c.amplitude).toBeCloseTo(0.3, 6);
    expect(c.phase).toBeCloseTo(0, 6);
    expect(component(fft2(p), 0, 0).amplitude).toBeCloseTo(0, 6);
  });
});

describe('transfer functions', () => {
  it('a low-pass with a large radius keeps the image', () => {
    const p = testImage();
    const S = fft2(p);
    const H = radialFilter(N, 'low-pass', 'ideal', N, N);
    expect(maxDiff(ifft2(applyFilter(S, H)).data, p.data)).toBeLessThan(1e-6);
    expect(energyFraction(S, H)).toBeCloseTo(1, 9);
  });

  it('low-pass and high-pass add up to all-pass', () => {
    const low = radialFilter(N, 'low-pass', 'gaussian', 5, 0);
    const high = radialFilter(N, 'high-pass', 'gaussian', 5, 0);
    low.data.forEach((v, i) => expect(v + high.data[i]).toBeCloseTo(1, 6));
  });

  it('a band-pass removes DC', () => {
    expect(radialFilter(N, 'band-pass', 'ideal', 3, 8).data[0]).toBe(0);
    expect(radialFilter(N, 'band-pass', 'gaussian', 3, 8).data[0]).toBeCloseTo(0, 9);
  });

  it('paintDisc paints (u, v) and (−u, −v), so the result stays real', () => {
    const H = allPass(N);
    paintDisc(H, 6, -2, 1.5, 0);
    expect(H.data[freqIndex(-2, N) * N + 6]).toBe(0);
    expect(H.data[2 * N + freqIndex(-6, N)]).toBe(0);
    expect(H.data[0]).toBe(1);
    const S = applyFilter(fft2(testImage()), H);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const j = freqIndex(-y, N) * N + freqIndex(-x, N);
        expect(S.re[y * N + x]).toBeCloseTo(S.re[j], 6);
        expect(S.im[y * N + x]).toBeCloseTo(-S.im[j], 6);
      }
  });

  it('removes periodic noise with a notch', () => {
    const p = testImage();
    const noisy = addPeriodicNoise(p, 7, 3, 0.2);
    const H = allPass(N);
    paintDisc(H, 7, 3, 0, 0);
    const back = ifft2(applyFilter(fft2(noisy), H));
    // The notch also removes the image's own coefficient at ±(7, 3), so only compare loosely.
    expect(maxDiff(back.data, p.data)).toBeLessThan(maxDiff(noisy.data, p.data) / 2);
  });
});

describe('convolution theorem', () => {
  const p = testImage();
  for (const [name, k] of [
    ['Gaussian', gaussianKernel(1.5)],
    ['box', boxKernel1D(5)],
  ] as const) {
    it(`F⁻¹{F · H} equals filtering with the ${name} kernel (periodic border)`, () => {
      const H = kernelTransfer(outerProduct(k, k), N);
      const viaFrequency = ifft2(applyFilter(fft2(p), H));
      const direct = correlateSeparable(p, k, k, 'wrap');
      expect(maxDiff(viaFrequency.data, direct.data)).toBeLessThan(1e-6);
    });
  }

  it('the transfer function of a normalized kernel is 1 at DC', () => {
    const g = gaussianKernel(2);
    expect(kernelTransfer(outerProduct(g, g), N).data[0]).toBeCloseTo(1, 6);
  });
});
