import { describe, expect, it } from 'vitest';
import { type Wave, coefficient, energyFraction, harmonics, partialSum, peak, rmsError, target } from './series';

const WAVES: Wave[] = ['square', 'sawtooth', 'triangle'];

/** b_k = 2 ∫₀¹ f(t) sin(2πkt) dt, by the midpoint rule. */
function projection(wave: Wave, k: number): number {
  const n = 20000;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    s += target(wave, t) * Math.sin(2 * Math.PI * k * t);
  }
  return (2 * s) / n;
}

describe('coefficients', () => {
  it('of the square wave are 4/(πk) for odd k and 0 for even k', () => {
    expect(coefficient('square', 1)).toBeCloseTo(4 / Math.PI, 12);
    expect(coefficient('square', 3)).toBeCloseTo(4 / (3 * Math.PI), 12);
    expect(coefficient('square', 2)).toBe(0);
  });

  it('are the projections of the wave onto sin(2πkt)', () => {
    for (const wave of WAVES) for (let k = 1; k <= 6; k++) expect(coefficient(wave, k)).toBeCloseTo(projection(wave, k), 4);
  });

  it('skip the even harmonics for square and triangle', () => {
    expect(harmonics('square', 4).map((t) => t.k)).toEqual([1, 3, 5, 7]);
    expect(harmonics('sawtooth', 4).map((t) => t.k)).toEqual([1, 2, 3, 4]);
  });
});

describe('partial sums', () => {
  it('converge at a point of continuity', () => {
    for (const wave of WAVES) {
      const t = 0.15;
      expect(Math.abs(partialSum(harmonics(wave, 400), t) - target(wave, t))).toBeLessThan(0.01);
    }
  });

  it('converge faster for the triangle (1/k²) than for the square (1/k)', () => {
    expect(rmsError('triangle', 5)).toBeLessThan(rmsError('square', 5) / 10);
  });

  it('overshoot the square wave by about 9 % of the jump, however many terms', () => {
    // The jump is 2, the Gibbs peak about 1 + 0.0895 · 2 = 1.179.
    expect(peak('square', 50)).toBeCloseTo(1.179, 2);
    expect(peak('square', 100)).toBeCloseTo(1.179, 2);
  });

  it('capture all the energy in the limit (Parseval)', () => {
    for (const wave of WAVES) {
      expect(energyFraction(wave, 1)).toBeLessThan(1);
      expect(energyFraction(wave, 2000)).toBeCloseTo(1, 3);
    }
    expect(energyFraction('square', 1)).toBeCloseTo(8 / Math.PI ** 2, 12);
  });
});
