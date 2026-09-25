import { describe, expect, it } from 'vitest';
import { centeredFreq, fft, fft2, fftShift, freqIndex, ifft2 } from './fft';
import { createPlane } from './image';

function testPlane(width: number, height: number) {
  const p = createPlane(width, height);
  p.data.forEach((_, i) => (p.data[i] = ((i * 7919) % 101) / 101));
  return p;
}

/** The DFT straight from its definition, O(M²N²). */
function naiveDft2(p: ReturnType<typeof createPlane>) {
  const { width: M, height: N } = p;
  const re = new Float64Array(M * N);
  const im = new Float64Array(M * N);
  for (let v = 0; v < N; v++)
    for (let u = 0; u < M; u++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < M; x++) {
          const a = -2 * Math.PI * ((u * x) / M + (v * y) / N);
          re[v * M + u] += p.data[y * M + x] * Math.cos(a);
          im[v * M + u] += p.data[y * M + x] * Math.sin(a);
        }
  return { re, im };
}

describe('fft', () => {
  it('matches the DFT definition in 1D', () => {
    const re = Float64Array.of(1, 2, 0, -1, 3, 0.5, 0, 2);
    const im = new Float64Array(8);
    const expected = naiveDft2({ width: 8, height: 1, data: Float32Array.from(re) });
    fft(re, im);
    re.forEach((v, i) => expect(v).toBeCloseTo(expected.re[i], 9));
    im.forEach((v, i) => expect(v).toBeCloseTo(expected.im[i], 9));
  });

  it('rejects lengths that are not powers of 2', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow();
  });
});

describe('fft2', () => {
  it('matches the DFT definition for a non-square image', () => {
    const p = testPlane(8, 4);
    const s = fft2(p);
    const expected = naiveDft2(p);
    s.re.forEach((v, i) => expect(v).toBeCloseTo(expected.re[i], 5));
    s.im.forEach((v, i) => expect(v).toBeCloseTo(expected.im[i], 5));
  });

  it('is inverted by ifft2', () => {
    const p = testPlane(16, 8);
    const back = ifft2(fft2(p));
    back.data.forEach((v, i) => expect(v).toBeCloseTo(p.data[i], 6));
  });

  it('turns a delta at the origin into a constant', () => {
    const p = createPlane(8, 8);
    p.data[0] = 1;
    const s = fft2(p);
    s.re.forEach((v) => expect(v).toBeCloseTo(1, 12));
    s.im.forEach((v) => expect(v).toBeCloseTo(0, 12));
  });

  it('turns a cosine into two peaks of MN/2 at ±(u, v)', () => {
    const M = 16;
    const N = 8;
    const [u, v] = [3, -2];
    const p = createPlane(M, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < M; x++) p.data[y * M + x] = Math.cos(2 * Math.PI * ((u * x) / M + (v * y) / N));
    const s = fft2(p);
    const peaks = new Set([freqIndex(v, N) * M + freqIndex(u, M), freqIndex(-v, N) * M + freqIndex(-u, M)]);
    s.re.forEach((value, i) => expect(value).toBeCloseTo(peaks.has(i) ? (M * N) / 2 : 0, 4));
  });

  it('preserves energy (Parseval): Σ f² = 1/(MN) Σ |F|²', () => {
    const p = testPlane(8, 8);
    const s = fft2(p);
    const spatial = p.data.reduce((a, b) => a + b * b, 0);
    let spectral = 0;
    for (let i = 0; i < s.re.length; i++) spectral += s.re[i] ** 2 + s.im[i] ** 2;
    expect(spectral / 64).toBeCloseTo(spatial, 4);
  });
});

describe('frequency layout', () => {
  it('maps signed frequencies to indices and back', () => {
    for (const u of [-4, -1, 0, 1, 3]) expect(centeredFreq(freqIndex(u, 8), 8)).toBe(u);
  });

  it('fftShift moves the DC term to the center', () => {
    const p = createPlane(8, 4);
    p.data[0] = 1;
    const shifted = fftShift(p);
    expect(shifted.data[2 * 8 + 4]).toBe(1);
  });
});
