import { describe, expect, it } from 'vitest';
import { createPlane } from '../../src/shared/image';
import { DEG, det3, mulMat3 } from '../../src/shared/linalg';
import {
  IDENTITY,
  type Params,
  type Vec2,
  applyH,
  bend,
  classify,
  compose,
  frameFor,
  mapPoint,
  mapSegment,
  meetingPoint,
  mirror,
  orientation,
  originFixed,
  parallelAngle,
  ratioAlong,
  rotation,
  scaling,
  shear,
  toPixel,
  toPlane,
  toPoint,
  translation,
  warpPlane,
} from './transform';

function expectVecClose(a: readonly number[], b: readonly number[], digits = 9) {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
}

const H = (p: Partial<Params>) => compose({ ...IDENTITY, ...p }).H;
const AFFINE: Partial<Params> = { tx: 0.3, ty: -0.2, theta: 25 * DEG, sx: 1.3, sy: 0.7, ax: 0.4 };
const PROJECTIVE: Partial<Params> = { ...AFFINE, g: 0.3, h: -0.2 };
const AFFINE_H = H(AFFINE);

describe('elementary transformations', () => {
  it('rotation keeps lengths and has det = 1', () => {
    const R = rotation(40 * DEG);
    const p: Vec2 = [0.6, -0.8];
    expect(Math.hypot(...mapPoint(R, p))).toBeCloseTo(1, 12);
    expect(det3(R)).toBeCloseTo(1, 12);
  });

  it('turns x towards y, i.e. clockwise with y down', () => {
    expectVecClose(mapPoint(rotation(90 * DEG), [1, 0]), [0, 1]);
  });

  it('mirror at the y-axis has det = −1, mirror over the origin det = 1', () => {
    expect(det3(mirror('y-axis'))).toBe(-1);
    expect(det3(mirror('origin'))).toBe(1);
    expectVecClose(mapPoint(mirror('y-axis'), [0.5, 0.2]), [-0.5, 0.2]);
    expectVecClose(mapPoint(mirror('origin'), [0.5, 0.2]), [-0.5, -0.2]);
  });

  it('shear has det = 1 − aₓ a_y', () => {
    expect(det3(shear(0.5, 0))).toBe(1);
    expect(det3(shear(0.5, 0.4))).toBeCloseTo(0.8, 12);
  });

  it('translation moves the origin', () => {
    expectVecClose(mapPoint(translation(0.3, -0.4), [0, 0]), [0.3, -0.4]);
    expect(originFixed(translation(0.3, -0.4))).toBe(false);
    expect(originFixed(rotation(1))).toBe(true);
  });

  it('the order of composition matters: T·R ≠ R·T', () => {
    const T = translation(1, 0);
    const R = rotation(90 * DEG);
    expectVecClose(mapPoint(mulMat3(T, R), [0, 0]), [1, 0]);
    expectVecClose(mapPoint(mulMat3(R, T), [0, 0]), [0, 1]);
  });
});

describe('compose', () => {
  it('applies mirror and scaling first, then shear, rotation and translation', () => {
    const p: Vec2 = [0.2, 0.5];
    const params: Params = { ...IDENTITY, ...AFFINE, mirror: 'y-axis' };
    const steps = [mirror('y-axis'), scaling(1.3, 0.7), shear(0.4, 0), rotation(25 * DEG), translation(0.3, -0.2)];
    const expected = steps.reduce((q, M) => mapPoint(M, q), p);
    expectVecClose(mapPoint(compose(params).H, p), expected);
  });

  it('puts g and h into the last row', () => {
    const { H: M, affine } = compose({ ...IDENTITY, ...PROJECTIVE });
    expectVecClose(M.slice(6), [0.3, -0.2, 1]);
    expectVecClose(affine.slice(6), [0, 0, 1]);
  });
});

describe('classify', () => {
  it('finds the smallest family and its DOF', () => {
    expect(classify(H({}))).toEqual({ family: 'identity', dof: 0 });
    expect(classify(H({ tx: 0.2 }))).toEqual({ family: 'translation', dof: 2 });
    expect(classify(H({ theta: 0.3 }))).toEqual({ family: 'linear', dof: 4 });
    expect(classify(H({ mirror: 'y-axis' }))).toEqual({ family: 'linear', dof: 4 });
    expect(classify(H({ ax: 0.3, ty: 0.1 }))).toEqual({ family: 'affine', dof: 6 });
    expect(classify(H({ h: 0.1 }))).toEqual({ family: 'projective', dof: 8 });
  });

  it('ignores the overall scale of H', () => {
    const M = H({ ax: 0.3, ty: 0.1 }).map((v) => 3 * v) as typeof AFFINE_H;
    expect(classify(M).family).toBe('affine');
  });
});

describe('properties', () => {
  const a: Vec2 = [-1, -1];
  const b: Vec2 = [-1, 0];
  const d: Vec2 = [2, 1];

  it('affine: lines stay straight, parallels stay parallel, the midpoint stays the midpoint', () => {
    expect(bend(AFFINE_H, a, [1, 1])).toBeLessThan(1e-12);
    expect(parallelAngle(AFFINE_H, a, b, d)).toBeCloseTo(0, 12);
    expect(ratioAlong(AFFINE_H, a, [1, 1], 0.5)).toBeCloseTo(0.5, 12);
    expect(meetingPoint(AFFINE_H, d)[2]).toBeCloseTo(0, 12);
  });

  it('projective: lines stay straight, but parallels meet at H (d, 0) and ratios change', () => {
    const P = H(PROJECTIVE);
    expect(bend(P, a, [1, 1])).toBeLessThan(1e-12);
    expect(parallelAngle(P, a, b, d)).toBeGreaterThan(0.01);
    expect(Math.abs(ratioAlong(P, a, [1, 1], 0.5) - 0.5)).toBeGreaterThan(0.01);

    const q = toPoint(meetingPoint(P, d));
    for (const start of [a, b]) {
      // q lies on the image of the line start + s d for every s.
      const [p0, p1] = [0, 1].map((s) => mapPoint(P, [start[0] + s * d[0], start[1] + s * d[1]]));
      const cross = (p1[0] - p0[0]) * (q[1] - p0[1]) - (p1[1] - p0[1]) * (q[0] - p0[0]);
      expect(cross).toBeCloseTo(0, 9);
    }
  });

  it('parallels along a direction with g dx + h dy = 0 stay parallel', () => {
    expect(parallelAngle(H({ g: 0.2, h: -0.4 }), a, b, d)).toBeCloseTo(0, 12);
  });

  it('mirroring at the y-axis flips the orientation, a half turn does not', () => {
    expect(orientation(H({ mirror: 'y-axis' }))).toBe(-1);
    expect(orientation(H({ mirror: 'origin' }))).toBe(1);
    expect(orientation(H(PROJECTIVE))).toBe(1);
  });

  it('scaling all of H by k gives the same points (8 DOF)', () => {
    const P = H(PROJECTIVE);
    const kP = P.map((v) => -2.5 * v) as typeof P;
    const p: Vec2 = [0.4, -0.7];
    expectVecClose(toPoint(applyH(kP, p)), mapPoint(P, p));
  });
});

describe('mapSegment', () => {
  it('maps both ends when w′ > 0', () => {
    const P = H(PROJECTIVE);
    const seg = mapSegment(P, [-1, 0], [1, 0])!;
    expectVecClose(seg[0], mapPoint(P, [-1, 0]));
    expectVecClose(seg[1], mapPoint(P, [1, 0]));
  });

  it('cuts the segment at w′ = ε and drops it behind the horizon', () => {
    const P = H({ g: 1 });
    expect(mapSegment(P, [-3, 0], [-2, 0])).toBeNull();
    const seg = mapSegment(P, [-2, 0], [1, 0], 0.1)!;
    // w' = 1 + x = 0.1 at x = −0.9
    expectVecClose(seg[0], [-9, 0]);
  });
});

describe('warpPlane', () => {
  const W = 16;
  const src = createPlane(W, W);
  src.data.forEach((_, i) => (src.data[i] = ((i % W) * 7 + Math.floor(i / W) * 3) / 200));
  const frame = frameFor(W, W);

  const same = { width: W, height: W, frame };

  it('frame: pixel ↔ plane, center at the origin, half-width 1', () => {
    expectVecClose(toPlane([-0.5, 7.5], frame), [-1, 0]);
    expectVecClose(toPixel(toPlane([3, 11], frame), frame), [3, 11]);
    expectVecClose(toPlane([-0.5, 15.5], frameFor(2 * W, 2 * W, 2)), [-2, 0]);
  });

  it('returns the image for the identity', () => {
    const out = warpPlane(src, H({}), frame, same);
    out.data.forEach((v, i) => expect(v).toBeCloseTo(src.data[i], 12));
  });

  it('shows the image in the middle of a larger output with the same resolution', () => {
    const out = warpPlane(src, H({}), frame, { width: 2 * W, height: 2 * W, frame: frameFor(2 * W, 2 * W, 2) }, -1);
    expect(out.data[0]).toBe(-1);
    for (const [u, v] of [[0, 0], [5, 9], [W - 1, W - 1]])
      expect(out.data[(v + W / 2) * 2 * W + u + W / 2]).toBeCloseTo(src.data[v * W + u], 12);
  });

  it('shifts pixels by an integer translation', () => {
    const shift = 3;
    const out = warpPlane(src, H({ tx: shift / frame.scale }), frame, same, -1);
    for (let v = 0; v < W; v++)
      for (let u = 0; u < W; u++) {
        const expected = u >= shift ? src.data[v * W + u - shift] : -1;
        expect(out.data[v * W + u]).toBeCloseTo(expected, 12);
      }
  });
});
