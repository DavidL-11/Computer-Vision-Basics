import { describe, expect, it } from 'vitest';
import { correlateSeparable, gaussianKernel } from '../../src/shared/filter';
import { type Plane, createPlane } from '../../src/shared/image';
import { random } from '../../src/shared/noise';
import { IDENTITY, warp } from '../../src/shared/warp';
import { type Options, errorSurface, linearize, lucasKanade, prepare, solveStep } from './lucasKanade';

/** Random values blurred into blobs a few pixels wide, so the image is smooth enough to linearize. */
function texture(seed: number): Plane {
  const rand = random(seed);
  const I = createPlane(48, 40);
  for (let i = 0; i < I.data.length; i++) I.data[i] = rand();
  const g = gaussianKernel(2);
  const S = correlateSeparable(I, g, g, 'reflect');
  return { ...S, data: S.data.map((v) => 0.5 + 2 * (v - 0.5)) };
}

const I0 = texture(3);
const shifted = (tx: number, ty: number) => warp(I0, { ...IDENTITY, tx, ty });
const win = { x: 24, y: 20, r: 6 };
const options: Options = { alpha: 1, maxIterations: 50, epsilon: 1e-4, jacobian: 'i1', limit: 20 };

describe('one Lucas–Kanade step', () => {
  it('has no error and no update at the true integer shift', () => {
    const s = linearize(prepare(I0, shifted(2, -1), 0), win, 2, -1, 'i1');
    expect(s.E).toBeCloseTo(0, 10);
    expect(Math.hypot(s.bx, s.by)).toBeCloseTo(0, 10);
  });

  it('solves the 2 × 2 normal equations', () => {
    const du = solveStep({ sxx: 2, sxy: 1, syy: 3, bx: 4, by: 7 })!;
    expect(2 * du[0] + du[1]).toBeCloseTo(4, 12);
    expect(du[0] + 3 * du[1]).toBeCloseTo(7, 12);
  });

  it('builds AᵀA and Aᵀb from the rows of A and b = −e', () => {
    const s = linearize(prepare(I0, shifted(0.6, 0.3), 1), win, 0, 0, 'i1');
    let sxy = 0, by = 0;
    s.jx.forEach((jx, k) => {
      sxy += jx * s.jy[k];
      by -= s.jy[k] * s.e[k];
    });
    expect(s.sxy).toBeCloseTo(sxy, 10);
    expect(s.by).toBeCloseTo(by, 10);
  });

  it('is singular on a straight edge: the aperture problem', () => {
    const edge = createPlane(48, 40);
    edge.data.forEach((_, i) => (edge.data[i] = i % 48 < 24 ? 0.2 : 0.8));
    const s = linearize(prepare(edge, edge, 1), win, 0.5, 0, 'i1');
    expect(s.syy).toBeCloseTo(0, 12);
    expect(solveStep(s)).toBeNull();
  });
});

describe('iteration', () => {
  const f = prepare(I0, shifted(2.4, -1.3), 1);

  it('converges to a subpixel shift from u₀ = 0', () => {
    const { steps, outcome } = lucasKanade(f, win, [0, 0], options);
    const last = steps[steps.length - 1];
    expect(outcome).toBe('converged');
    expect(Math.hypot(last.u - 2.4, last.v + 1.3)).toBeLessThan(0.05);
    expect(last.system.E).toBeLessThan(steps[0].system.E / 100);
  });

  it('needs more steps with a smaller step size, and also converges with ∇I₀', () => {
    const full = lucasKanade(f, win, [0, 0], options).steps.length;
    const half = lucasKanade(f, win, [0, 0], { ...options, alpha: 0.5 });
    expect(half.outcome).toBe('converged');
    expect(half.steps.length).toBeGreaterThan(full);
    const fixed = lucasKanade(f, win, [0, 0], { ...options, jacobian: 'i0' });
    const last = fixed.steps[fixed.steps.length - 1];
    expect(Math.hypot(last.u - 2.4, last.v + 1.3)).toBeLessThan(0.05);
  });

  it('stops after the maximum number of iterations', () => {
    const { steps, outcome } = lucasKanade(f, win, [0, 0], { ...options, alpha: 0.05, maxIterations: 3 });
    expect(outcome).toBe('max-iterations');
    expect(steps).toHaveLength(4);
  });
});

describe('error surface', () => {
  it('is smallest at the true shift', () => {
    const f = prepare(I0, shifted(2, -1), 0);
    const { n, E } = errorSurface(f, win, 3, 0.5);
    expect(n).toBe(13);
    const k = E.indexOf(Math.min(...E));
    expect([-3 + (k % n) * 0.5, -3 + Math.floor(k / n) * 0.5]).toEqual([2, -1]);
  });
});
