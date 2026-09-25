/**
 * Discrete Fourier transform of images via the fast Fourier transform.
 *
 * Conventions:
 *  - F(u, v) = Σ_x Σ_y f(x, y) · e^{−i2π(ux/M + vy/N)} for an M × N image (M columns, N rows),
 *    f(x, y) = 1/(MN) · Σ_u Σ_v F(u, v) · e^{+i2π(ux/M + vy/N)}; the 1/(MN) sits on the inverse.
 *  - Spectra use the standard DFT layout: the DC term F(0, 0) is at index 0 and negative frequencies wrap around to
 *    the end, so frequency u is stored at index u mod M. fftShift() moves the DC term to the center for display.
 *  - Width and height must be powers of 2.
 */

import { type Plane, createPlane } from './image';

export interface Spectrum {
  width: number;
  height: number;
  re: Float64Array;
  im: Float64Array;
}

export const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

/**
 * In-place radix-2 Cooley–Tukey FFT of one signal of length n = 2^k: reorder the samples by bit-reversed index, then
 * combine pairs of half-length DFTs with butterflies, doubling the length each stage. Unscaled in both directions.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (!isPowerOfTwo(n)) throw new Error(`FFT length ${n} is not a power of 2`);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (sign * 2 * Math.PI) / len;
    for (let start = 0; start < n; start += len)
      for (let k = 0; k < half; k++) {
        // Twiddle factor w = e^{∓i2πk/len}; the butterfly gives X[k] = E[k] + w·O[k], X[k + len/2] = E[k] − w·O[k].
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = start + k;
        const b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
}

/** The 2D DFT is separable: 1D transforms of all rows, then of all columns. */
function fft2InPlace(s: Spectrum, inverse: boolean): void {
  const { width: M, height: N } = s;
  const rowRe = new Float64Array(M);
  const rowIm = new Float64Array(M);
  for (let y = 0; y < N; y++) {
    rowRe.set(s.re.subarray(y * M, (y + 1) * M));
    rowIm.set(s.im.subarray(y * M, (y + 1) * M));
    fft(rowRe, rowIm, inverse);
    s.re.set(rowRe, y * M);
    s.im.set(rowIm, y * M);
  }
  const colRe = new Float64Array(N);
  const colIm = new Float64Array(N);
  for (let x = 0; x < M; x++) {
    for (let y = 0; y < N; y++) {
      colRe[y] = s.re[y * M + x];
      colIm[y] = s.im[y * M + x];
    }
    fft(colRe, colIm, inverse);
    for (let y = 0; y < N; y++) {
      s.re[y * M + x] = colRe[y];
      s.im[y * M + x] = colIm[y];
    }
  }
}

export function fft2(p: Plane): Spectrum {
  const s: Spectrum = { width: p.width, height: p.height, re: Float64Array.from(p.data), im: new Float64Array(p.data.length) };
  fft2InPlace(s, false);
  return s;
}

/** Real part of the inverse transform; the imaginary part vanishes for conjugate-symmetric spectra. */
export function ifft2(s: Spectrum): Plane {
  const t: Spectrum = { width: s.width, height: s.height, re: s.re.slice(), im: s.im.slice() };
  fft2InPlace(t, true);
  const out = createPlane(s.width, s.height);
  const scale = 1 / (s.width * s.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = t.re[i] * scale;
  return out;
}

/** Array index of the signed frequency u for length n. */
export const freqIndex = (u: number, n: number) => ((u % n) + n) % n;

/** Signed frequency in [−n/2, n/2) stored at array index k. */
export const centeredFreq = (k: number, n: number) => (k < n / 2 ? k : k - n);

/** Moves the DC term from index 0 to the center (n/2, n/2), with negative frequencies left and up. */
export function fftShift(p: Plane): Plane {
  const { width: M, height: N } = p;
  const out = createPlane(M, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < M; x++) out.data[((y + N / 2) % N) * M + ((x + M / 2) % M)] = p.data[y * M + x];
  return out;
}
