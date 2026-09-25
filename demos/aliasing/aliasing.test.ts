import { describe, expect, it } from 'vitest';
import { createPlane } from '../../src/shared/image';
import { alias, enlarge, gaussianResponse, replicas, sampleTimes, signal, subsample } from './aliasing';

describe('alias', () => {
  it('keeps frequencies below Nyquist', () => {
    expect(alias(3, 10, 0.4)).toEqual({ f: 3, phase: 0.4, k: 0, folded: false });
  });

  it('folds frequencies above Nyquist back and flips the phase', () => {
    const a = alias(7, 10, 0.4);
    expect(a.f).toBeCloseTo(3, 12);
    expect(a.phase).toBe(-0.4);
    expect(a.folded).toBe(true);
  });

  it('maps multiples of the sampling rate to 0', () => {
    expect(alias(20, 10, 0).f).toBeCloseTo(0, 12);
  });

  it('agrees with the signal at every sample time', () => {
    for (const [f, fs, phase] of [
      [3, 10, 0.3],
      [7.5, 10, 1.1],
      [13, 5, -0.7],
      [9, 4.5, 2],
    ]) {
      const a = alias(f, fs, phase);
      expect(a.f).toBeLessThanOrEqual(fs / 2 + 1e-12);
      const x = signal(f, phase);
      const xa = signal(a.f, a.phase);
      for (const t of sampleTimes(fs, 2)) expect(xa(t)).toBeCloseTo(x(t), 9);
    }
  });
});

describe('replicas', () => {
  it('contains ±f, their shifts by f_s and the alias', () => {
    const r = replicas(7, 10, 20);
    expect(r).toEqual([-17, -13, -7, -3, 3, 7, 13, 17]);
    expect(r).toContain(alias(7, 10, 0).f);
  });
});

describe('subsampling', () => {
  it('keeps every k-th pixel and enlarges back', () => {
    const p = createPlane(7, 5);
    p.data.forEach((_, i) => (p.data[i] = i));
    const s = subsample(p, 3);
    expect([s.width, s.height]).toEqual([3, 2]);
    expect(Array.from(s.data)).toEqual([0, 3, 6, 21, 24, 27]);
    const e = enlarge(s, 3, 7, 5);
    expect(e.data[4 * 7 + 5]).toBe(24);
  });
});

describe('gaussianResponse', () => {
  it('is 1 at DC and falls off with σ·f', () => {
    expect(gaussianResponse(2, 0)).toBe(1);
    expect(gaussianResponse(2, 0.25)).toBeCloseTo(gaussianResponse(1, 0.5), 12);
    expect(gaussianResponse(2, 0.25)).toBeLessThan(gaussianResponse(1, 0.25));
  });
});
