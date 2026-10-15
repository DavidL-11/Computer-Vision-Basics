import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { random } from '../../src/shared/noise';
import { Regularized, eigen2, energy, flowColor, linearize, patchAt, patchFlow, prepare, solve } from './flow';

/** Random cosine waves with periods of 6 to 16 pixels, moved by (tx, ty): exact for subpixel motion. */
function texture(seed: number, w = 40, h = 32, tx = 0, ty = 0): Plane {
  const rand = random(seed);
  const waves = Array.from({ length: 12 }, () => {
    const f = (2 * Math.PI) / (6 + 10 * rand());
    const a = 2 * Math.PI * rand();
    return [f * Math.cos(a), f * Math.sin(a), 2 * Math.PI * rand()];
  });
  const I = createPlane(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) I.data[y * w + x] = 0.5 + 0.06 * waves.reduce((s, [kx, ky, p]) => s + Math.cos(kx * (x - tx) + ky * (y - ty) + p), 0);
  return I;
}

const I0 = texture(7);
const shifted = (tx: number, ty: number, seed = 7, w = 40, h = 32) => texture(seed, w, h, tx, ty);
const options = { r: 5, tau: 1e-7, iterations: 30, epsilon: 1e-4 };

describe('patch-based flow', () => {
  it('finds the translation of a textured window', () => {
    const f = prepare(I0, shifted(0.7, -0.4), 1);
    const p = patchAt(f, 20, 16, options);
    expect(p.kind).toBe('corner');
    expect(p.u).toBeCloseTo(0.7, 1);
    expect(p.v).toBeCloseTo(-0.4, 1);
  });

  it('has no estimate in a flat window', () => {
    const flat: Plane = { ...I0, data: I0.data.map(() => 0.4) };
    const p = patchAt(prepare(flat, flat, 1), 20, 16, options);
    expect(p.kind).toBe('flat');
    expect(p.u).toBeNaN();
  });

  it('only finds the normal flow on straight stripes (aperture problem)', () => {
    const stripes = (t: number): Plane => {
      const p = createPlane(40, 32);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 40; x++) p.data[y * 40 + x] = 0.5 + 0.3 * Math.sin((2 * Math.PI * (x - t)) / 10);
      return p;
    };
    // The stripes are vertical, so a motion (0.8, 0.5) only shows up as (0.8, 0).
    const p = patchAt(prepare(stripes(0), stripes(0.8), 1), 20, 16, { ...options, tau: 1e-6 });
    expect(p.kind).toBe('edge');
    expect(p.u).toBeCloseTo(0.8, 1);
    expect(p.v).toBeCloseTo(0, 6);
  });

  it('solves the full system for a corner and projects onto the gradient for an edge', () => {
    const s = { sxx: 2, sxy: 1, syy: 3, bx: 4, by: 7, E: 0 };
    const [u, v] = solve(s, 0).du!;
    expect(2 * u + v).toBeCloseTo(4, 12);
    expect(u + 3 * v).toBeCloseTo(7, 12);
    const edge = solve({ sxx: 4, sxy: 0, syy: 1e-9, bx: 2, by: 1, E: 0 }, 1e-6);
    expect(edge.kind).toBe('edge');
    expect(edge.du).toEqual([0.5, 0]);
  });

  it('has eigenvalues that sum to the trace', () => {
    const { l1, l2, ex, ey } = eigen2(3, 1, 2);
    expect(l1 + l2).toBeCloseTo(5, 12);
    expect(l1 * l2).toBeCloseTo(5, 12);
    expect(3 * ex + ey).toBeCloseTo(l1 * ex, 12);
  });

  it('divides the normal equations by the window size', () => {
    const f = prepare(I0, I0, 1);
    const a = linearize(f, 20, 16, 2, 0, 0);
    const b = linearize(f, 20, 16, 6, 0, 0);
    expect(b.sxx / a.sxx).toBeGreaterThan(0.2);
    expect(b.sxx / a.sxx).toBeLessThan(5);
  });

  it('gives one vector per pixel', () => {
    const { flow, kind } = patchFlow(prepare(I0, shifted(0.5, 0.5), 1), { ...options, r: 3 });
    expect(flow.u.length).toBe(40 * 32);
    expect(kind.length).toBe(40 * 32);
    expect(flow.u[16 * 40 + 20]).toBeCloseTo(0.5, 1);
  });
});

describe('regularized flow', () => {
  it('finds a translation of a textured image', () => {
    const big = texture(3, 48, 40);
    const r = new Regularized(prepare(big, shifted(0.6, 0.3, 3, 48, 40), 1), 0.05);
    r.run(400);
    const i = 20 * 48 + 24;
    expect(r.flow.u[i]).toBeCloseTo(0.6, 1);
    expect(r.flow.v[i]).toBeCloseTo(0.3, 1);
  });

  it('fills in a flat region from its textured surroundings', () => {
    const big = texture(3, 48, 40);
    const hole = (p: Plane, tx: number, ty: number): Plane => ({
      ...p,
      data: p.data.map((v, i) => (Math.hypot((i % 48) - 24 - tx, Math.floor(i / 48) - 20 - ty) < 9 ? 0.5 : v)),
    });
    const r = new Regularized(prepare(hole(big, 0, 0), hole(shifted(0.6, 0.3, 3, 48, 40), 0.6, 0.3), 1), 0.05);
    r.run(600);
    const i = 20 * 48 + 24;
    // The edge of the hole is not anti-aliased, which costs some accuracy.
    expect(Math.abs(r.flow.u[i] - 0.6)).toBeLessThan(0.1);
    expect(Math.abs(r.flow.v[i] - 0.3)).toBeLessThan(0.1);
  });

  it('lowers the energy with every sweep and smooths more with a larger α', () => {
    const f = prepare(I0, shifted(0.6, 0.3), 1);
    const total = (r: Regularized) => {
      const e = energy(f, r.flow);
      return e.data + r.alpha ** 2 * e.smooth;
    };
    const r = new Regularized(f, 0.05);
    r.run(5);
    const e5 = total(r);
    r.run(10);
    expect(total(r)).toBeLessThan(e5);
    const strong = new Regularized(f, 1);
    strong.run(200);
    r.run(185);
    expect(energy(f, strong.flow).smooth).toBeLessThan(energy(f, r.flow).smooth);
  });

  it('satisfies the update formula at convergence', () => {
    const f = prepare(I0, shifted(0.4, 0.2), 1);
    const r = new Regularized(f, 0.1);
    r.run(2000);
    const w = 40, i = 16 * w + 20;
    const { u, v } = r.flow;
    const mu = (u[i - 1] + u[i + 1] + u[i - w] + u[i + w]) / 4;
    const mv = (v[i - 1] + v[i + 1] + v[i - w] + v[i + w]) / 4;
    const { ix, iy, c } = r.linearization(i);
    const k = (ix * mu + iy * mv + c) / (0.01 * 4 + ix * ix + iy * iy);
    expect(u[i]).toBeCloseTo(mu - ix * k, 4);
    expect(v[i]).toBeCloseTo(mv - iy * k, 4);
  });
});

describe('flow colors', () => {
  it('is white for no motion, red to the right and gray without an estimate', () => {
    expect(flowColor(0, 0, 1)).toEqual([1, 1, 1]);
    expect(flowColor(2, 0, 2).map((c) => +c.toFixed(6))).toEqual([1, 0, 0]);
    expect(flowColor(NaN, 0, 1)).toEqual([0.5, 0.5, 0.5]);
  });

  it('turns clockwise on screen: down (+y) is green-yellow, left cyan', () => {
    const down = flowColor(0, 1, 1);
    expect(down[1]).toBe(1);
    expect(down[2]).toBeCloseTo(0, 6);
    expect(flowColor(-1, 0, 1).map((c) => +c.toFixed(6))).toEqual([0, 1, 1]);
  });
});
