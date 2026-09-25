/**
 * Fourier series of periodic waves with period T = 1 and amplitude 1.
 *
 * All three waves are odd functions, so their series contain only sine terms:
 *   f(t) = Σ_k b_k sin(2πkt),   b_k = 2 ∫₀¹ f(t) sin(2πkt) dt.
 * "n terms" means the first n non-zero terms; for the square and triangle wave these are the odd harmonics.
 */

export type Wave = 'square' | 'sawtooth' | 'triangle';

export interface Term {
  /** Harmonic number: the term oscillates k times per period. */
  k: number;
  b: number;
}

const frac = (t: number) => t - Math.floor(t);

export function target(wave: Wave, t: number): number {
  const s = frac(t);
  switch (wave) {
    case 'square':
      return s === 0 || s === 0.5 ? 0 : s < 0.5 ? 1 : -1;
    case 'sawtooth':
      return s === 0 ? 0 : s < 0.5 ? 2 * s : 2 * s - 2;
    case 'triangle':
      return s < 0.25 ? 4 * s : s < 0.75 ? 2 - 4 * s : 4 * s - 4;
  }
}

export function coefficient(wave: Wave, k: number): number {
  switch (wave) {
    case 'square':
      return k % 2 ? 4 / (Math.PI * k) : 0;
    case 'sawtooth':
      return ((k % 2 ? 1 : -1) * 2) / (Math.PI * k);
    case 'triangle':
      return k % 2 ? ((k % 4 === 1 ? 1 : -1) * 8) / (Math.PI * k) ** 2 : 0;
  }
}

/** The first n non-zero terms. */
export function harmonics(wave: Wave, n: number): Term[] {
  const step = wave === 'sawtooth' ? 1 : 2;
  return Array.from({ length: n }, (_, i) => {
    const k = 1 + i * step;
    return { k, b: coefficient(wave, k) };
  });
}

export const term = ({ k, b }: Term, t: number) => b * Math.sin(2 * Math.PI * k * t);

export function partialSum(terms: readonly Term[], t: number): number {
  let s = 0;
  for (const tk of terms) s += term(tk, t);
  return s;
}

const SAMPLES = 4000;

/** Largest value of the partial sum over one period; the target's maximum is 1. */
export function peak(wave: Wave, n: number): number {
  const terms = harmonics(wave, n);
  let max = -Infinity;
  for (let i = 0; i < SAMPLES; i++) max = Math.max(max, partialSum(terms, i / SAMPLES));
  return max;
}

/** Root mean square of f − S_n over one period, sampled at the midpoints of SAMPLES intervals. */
export function rmsError(wave: Wave, n: number): number {
  const terms = harmonics(wave, n);
  let sum = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i + 0.5) / SAMPLES;
    sum += (target(wave, t) - partialSum(terms, t)) ** 2;
  }
  return Math.sqrt(sum / SAMPLES);
}

/** Mean of f² over one period: 1 for the square wave, 1/3 for sawtooth and triangle. */
export const meanSquare = (wave: Wave) => (wave === 'square' ? 1 : 1 / 3);

/** Share of the signal's energy in the first n terms (Parseval: mean of f² = Σ b_k² / 2). */
export function energyFraction(wave: Wave, n: number): number {
  return harmonics(wave, n).reduce((s, { b }) => s + (b * b) / 2, 0) / meanSquare(wave);
}
