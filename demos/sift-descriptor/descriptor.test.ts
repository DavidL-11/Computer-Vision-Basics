import { describe, expect, it } from 'vitest';
import { blur, buildScaleSpace } from '../../src/shared/dog';
import { type Plane, createPlane } from '../../src/shared/image';
import { random } from '../../src/shared/noise';
import { distance } from '../../src/shared/sift';
import { IDENTITY, mapPoint, warp } from '../../src/shared/warp';
import { applyGamma, describePoint } from './descriptor';

function texture(size: number): Plane {
  const rand = random(7);
  const p = createPlane(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) p.data[y * size + x] = 0.2 + 0.3 * rand() + 0.4 * Math.exp(-((x - c - 6) ** 2 + (y - c - 3) ** 2) / 40);
  return blur(p, 1.5);
}

const space = { sigma0: 1.6, intervals: 3, octaves: 3 };
const options = { orient: true, clamp: 0.2 };

describe('describePoint', () => {
  const A = texture(96);
  const octA = buildScaleSpace(A, space);
  const a = describePoint(octA, 48, 48, 3, options);

  it('uses the octave and Gaussian image closest in scale', () => {
    // 3 = 1.6 · k^2.72
    expect(a.location).toMatchObject({ octave: 0, level: 3, u: 48, v: 48 });
  });

  it('gives nearly the same descriptor after a rotation and a scaling, at the mapped point and scale', () => {
    const T = { ...IDENTITY, angle: Math.PI / 6, scale: 1.4 };
    const octB = buildScaleSpace(warp(A, T), space);
    const [x, y] = mapPoint(T, 96, 96, 48, 48);
    const b = describePoint(octB, x, y, 3 * T.scale, { ...options, near: a.theta + T.angle });
    const fixed = describePoint(octB, x, y, 3 * T.scale, { ...options, orient: false });
    const aFixed = describePoint(octA, 48, 48, 3, { ...options, orient: false });
    expect(distance(a.descriptor, b.descriptor)).toBeLessThan(0.3);
    expect(distance(aFixed.descriptor, fixed.descriptor)).toBeGreaterThan(2 * distance(a.descriptor, b.descriptor));
  });

  it('is unchanged by an affine intensity change', () => {
    const octB = buildScaleSpace(warp(A, { ...IDENTITY, gain: 0.6, bias: 0.15 }), space);
    expect(distance(a.descriptor, describePoint(octB, 48, 48, 3, options).descriptor)).toBeLessThan(1e-4);
  });

  it('takes the orientation peak closest to a given angle', () => {
    const hist = describePoint(octA, 48, 48, 3, options);
    for (const p of hist.peaks) expect(describePoint(octA, 48, 48, 3, { ...options, near: p + 0.01 }).theta).toBeCloseTo(p, 9);
  });
});

describe('applyGamma', () => {
  it('raises every value to the power γ', () => {
    const p = { width: 2, height: 1, data: Float32Array.from([0.25, 1]) };
    expect(Array.from(applyGamma(p, 2).data)).toEqual([0.0625, 1]);
    expect(applyGamma(p, 1)).toBe(p);
  });
});
