import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import type { Mat3 } from '../../src/shared/linalg';
import { type Model, PARAMETERS, align, apply, cornerError, homography, linearize, prepare, warpImage, warpJacobian } from './parametric';

const MODELS: Model[] = ['translation', 'euclidean', 'affine', 'projective'];

/** Smooth texture with structure in all directions, larger than the frames so that warps stay inside. */
function source(): Plane {
  const p = createPlane(200, 160);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      p.data[y * p.width + x] =
        0.5 + 0.2 * Math.sin(x / 7) * Math.cos(y / 9) + 0.15 * Math.sin((x + 2 * y) / 11) + 0.1 * Math.cos((3 * x - y) / 13);
  return p;
}

const W = 120;
const H = 90;
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function frames(Hstar: Mat3) {
  const src = source();
  return prepare(warpImage(src, IDENTITY, W, H), warpImage(src, Hstar, W, H), 0);
}

describe('homography / warpJacobian', () => {
  it('p = 0 is the identity for every model', () => {
    for (const m of MODELS) expect(homography(m, new Array(PARAMETERS[m].length).fill(0)).map((v) => v + 0)).toEqual(IDENTITY);
  });

  it('x′ agrees with H(p) and ∂x′/∂p with finite differences', () => {
    const P: Record<Model, number[]> = {
      translation: [2, -3],
      euclidean: [2, -3, 0.1],
      affine: [2, -3, 0.05, -0.02, 0.03, -0.04],
      projective: [0.05, -0.02, 2, 0.03, -0.04, -3, 4e-4, -3e-4],
    };
    for (const m of MODELS) {
      const p = P[m];
      const [x, y] = [23, -17];
      const { xp, yp, dx, dy } = warpJacobian(m, p, x, y);
      const [u, v] = apply(homography(m, p), x, y);
      expect(xp).toBeCloseTo(u, 10);
      expect(yp).toBeCloseTo(v, 10);
      p.forEach((_, j) => {
        const h = 1e-7;
        const at = (d: number) => apply(homography(m, p.map((v, i) => (i === j ? v + d : v))), x, y);
        const [[u1, v1], [u2, v2]] = [at(-h), at(h)];
        expect(dx[j]).toBeCloseTo((u2 - u1) / (2 * h), 4);
        expect(dy[j]).toBeCloseTo((v2 - v1) / (2 * h), 4);
      });
    }
  });
});

describe('linearize', () => {
  it('has zero error and a symmetric A for identical frames', () => {
    const f = frames(IDENTITY);
    const s = linearize(f, 'affine', new Array(6).fill(0), true);
    expect(s.E).toBeCloseTo(0, 12);
    expect(s.count).toBe(W * H);
    for (let j = 0; j < 6; j++) for (let k = 0; k < 6; k++) expect(s.A[j][k]).toBe(s.A[k][j]);
    expect(s.J).toHaveLength(6);
  });

  it('only counts pixels whose x′ lies inside I₁', () => {
    const f = frames(IDENTITY);
    const s = linearize(f, 'translation', [10, 0], true);
    expect(s.count).toBe((W - 10) * H);
    expect(Number.isNaN(s.e[W - 1])).toBe(true);
  });
});

describe('align', () => {
  const opts = { maxIterations: 50, epsilon: 1e-4 };

  it('recovers a translation, an affine and a projective motion with the matching model', () => {
    const cases: [Model, Mat3][] = [
      ['translation', [1, 0, 2.3, 0, 1, -1.7, 0, 0, 1]],
      ['euclidean', [Math.cos(0.05), -Math.sin(0.05), 1.5, Math.sin(0.05), Math.cos(0.05), -1, 0, 0, 1]],
      ['affine', [1.03, 0.02, 1.5, -0.03, 0.98, -1, 0, 0, 1]],
      ['projective', [1.02, 0.01, 1, -0.01, 0.99, -0.5, 3e-4, -2e-4, 1]],
    ];
    for (const [model, Hstar] of cases) {
      const { steps, outcome } = align(frames(Hstar), model, opts);
      expect(outcome).toBe('converged');
      expect(cornerError(homography(model, steps.at(-1)!.p), Hstar, W, H)).toBeLessThan(0.05);
    }
  });

  it('leaves a residual when the model is too simple for the motion', () => {
    const Hstar: Mat3 = [Math.cos(0.05), -Math.sin(0.05), 1, Math.sin(0.05), Math.cos(0.05), 0, 0, 0, 1];
    const f = frames(Hstar);
    const t = align(f, 'translation', opts).steps.at(-1)!;
    const e = align(f, 'euclidean', opts).steps.at(-1)!;
    expect(cornerError(homography('translation', t.p), Hstar, W, H)).toBeGreaterThan(1);
    expect(t.system.E).toBeGreaterThan(100 * e.system.E);
  });

  it('reports a singular system for a flat image', () => {
    const flat: Plane = { width: W, height: H, data: new Float32Array(W * H).fill(0.5) };
    expect(align(prepare(flat, flat, 0), 'affine', opts).outcome).toBe('singular');
  });
});

describe('cornerError', () => {
  it('is zero for the same motion and the shift length for a pure shift', () => {
    expect(cornerError(IDENTITY, IDENTITY, W, H)).toBe(0);
    expect(cornerError(IDENTITY, [1, 0, 3, 0, 1, 4, 0, 0, 1], W, H)).toBeCloseTo(5, 12);
  });
});
