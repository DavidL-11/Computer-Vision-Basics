import { describe, expect, it } from 'vitest';
import { fft2, freqIndex, ifft2 } from '../../src/shared/fft';
import { createPlane } from '../../src/shared/image';
import { correlation, fromPolar, magnitude, phase, radialAverage, randomPhase, stretch } from './swap';

const N = 16;

function image(seed: number) {
  const p = createPlane(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) p.data[y * N + x] = (((x + 3) * (y + seed) * 7919) % 101) / 100;
  return p;
}

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

/** F(−u, −v) is the complex conjugate of F(u, v). */
function isConjugateSymmetric(re: Float64Array, im: Float64Array): boolean {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const j = freqIndex(-y, N) * N + freqIndex(-x, N);
      if (Math.abs(re[y * N + x] - re[j]) > 1e-9 || Math.abs(im[y * N + x] + im[j]) > 1e-9) return false;
    }
  return true;
}

describe('magnitude and phase', () => {
  it('recombining the magnitude and phase of an image gives it back', () => {
    const a = image(1);
    const A = fft2(a);
    expect(maxDiff(ifft2(fromPolar(N, N, magnitude(A), phase(A))).data, a.data)).toBeLessThan(1e-6);
  });

  it('a hybrid has the magnitude of one image and the phase of the other', () => {
    const A = fft2(image(1));
    const B = fft2(image(2));
    const H = fromPolar(N, N, magnitude(A), phase(B));
    expect(isConjugateSymmetric(H.re, H.im)).toBe(true);
    expect(maxDiff(magnitude(H), magnitude(A))).toBeLessThan(1e-9);
    const back = fft2(ifft2(H));
    expect(maxDiff(back.re, H.re)).toBeLessThan(1e-3);
    expect(maxDiff(back.im, H.im)).toBeLessThan(1e-3);
  });

  it('shifting an image changes only the phase', () => {
    const a = image(3);
    const shifted = createPlane(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) shifted.data[((y + 5) % N) * N + ((x + 2) % N)] = a.data[y * N + x];
    expect(maxDiff(magnitude(fft2(shifted)), magnitude(fft2(a)))).toBeLessThan(1e-4);
    expect(maxDiff(phase(fft2(shifted)), phase(fft2(a)))).toBeGreaterThan(0.1);
  });

  it('zero phase gives an image that is symmetric about the origin', () => {
    const z = ifft2(fromPolar(N, N, magnitude(fft2(image(1))), new Float64Array(N * N)));
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) expect(z.data[y * N + x]).toBeCloseTo(z.data[freqIndex(-y, N) * N + freqIndex(-x, N)], 5);
  });

  it('random phases are odd, so the image stays real', () => {
    const phi = randomPhase(N, N, 4);
    const S = fromPolar(N, N, new Float64Array(N * N).fill(1), phi);
    expect(isConjugateSymmetric(S.re, S.im)).toBe(true);
    expect(randomPhase(N, N, 4)).toEqual(phi);
  });
});

describe('radialAverage', () => {
  it('averages over rings and keeps radially symmetric magnitudes', () => {
    const mag = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) mag[y * N + x] = x === 1 && y === 0 ? 8 : 0;
    const avg = radialAverage(mag, N, N);
    // Ring 1 holds (±1, 0), (0, ±1) and, since round(√2) = 1, (±1, ±1).
    expect(avg[1]).toBeCloseTo(1, 9);
    expect(avg[N + 1]).toBeCloseTo(1, 9);
    expect(avg[2]).toBe(0);
    const flat = new Float64Array(N * N).fill(3);
    expect(maxDiff(radialAverage(flat, N, N), flat)).toBe(0);
  });
});

describe('helpers', () => {
  it('correlation is 1 for the same image and invariant to brightness and contrast', () => {
    const a = image(1);
    expect(correlation(a, a)).toBeCloseTo(1, 9);
    expect(correlation(a, { ...a, data: a.data.map((v) => 0.5 - 2 * v) })).toBeCloseTo(-1, 6);
  });

  it('stretch maps the range to [0, 1]', () => {
    const p = { width: 4, height: 1, data: Float32Array.from([-2, 0, 1, 2]) };
    expect(Array.from(stretch(p, 0).data)).toEqual([0, 0.5, 0.75, 1]);
  });
});
