import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { type Layer, circleOfConfusion, dofLimits, hyperfocal, imageDistance, renderLayers } from './thinLens';

const f = 50;
const A = f / 2;

describe('thin lens', () => {
  it('satisfies 1/f = 1/z_o + 1/z_i', () => {
    for (const zo of [60, 100, 2000]) {
      const zi = imageDistance(f, zo);
      expect(1 / zo + 1 / zi).toBeCloseTo(1 / f, 12);
    }
  });

  it('images distant points at f and a point at 2f at 2f', () => {
    expect(imageDistance(f, Infinity)).toBe(f);
    expect(imageDistance(f, 2 * f)).toBeCloseTo(2 * f, 12);
  });
});

describe('circle of confusion', () => {
  it('is zero at the focus distance', () => {
    expect(circleOfConfusion(A, f, 2000, 2000)).toBe(0);
  });

  it('matches the cone of light converging behind or in front of the sensor', () => {
    const S = 2000;
    const zS = imageDistance(f, S);
    for (const D of [800, 5000]) {
      const zD = imageDistance(f, D);
      expect(circleOfConfusion(A, f, S, D)).toBeCloseTo((A * Math.abs(zS - zD)) / zD, 12);
    }
  });

  it('approaches A · f / (S − f) for a distant point', () => {
    expect(circleOfConfusion(A, f, 2000, 1e12)).toBeCloseTo(circleOfConfusion(A, f, 2000, Infinity), 6);
  });

  it('grows with the aperture', () => {
    expect(circleOfConfusion(2 * A, f, 2000, 5000)).toBeCloseTo(2 * circleOfConfusion(A, f, 2000, 5000), 12);
  });
});

describe('depth of field', () => {
  const c = 0.03;

  it('the limits are where the circle of confusion equals c', () => {
    const S = 3000;
    const { near, far } = dofLimits(A, f, S, c);
    expect(near).toBeLessThan(S);
    expect(far).toBeGreaterThan(S);
    expect(circleOfConfusion(A, f, S, near)).toBeCloseTo(c, 12);
    expect(circleOfConfusion(A, f, S, far)).toBeCloseTo(c, 12);
  });

  it('focusing at the hyperfocal distance makes everything from H / 2 to infinity sharp', () => {
    const H = hyperfocal(A, f, c);
    const { near, far } = dofLimits(A, f, H, c);
    expect(far).toBe(Infinity);
    expect(near).toBeCloseTo(H / 2, 9);
    expect(circleOfConfusion(A, f, H, Infinity)).toBeCloseTo(c, 12);
  });

  it('a smaller aperture gives a larger depth of field', () => {
    const wide = dofLimits(A, f, 3000, c);
    const narrow = dofLimits(A / 4, f, 3000, c);
    expect(narrow.near).toBeLessThan(wide.near);
    expect(narrow.far).toBeGreaterThan(wide.far);
  });

  it('a short focal length at the same f-number gives a larger depth of field', () => {
    const phone = dofLimits(4.3 / 1.8, 4.3, 2000, c);
    const portrait = dofLimits(85 / 1.8, 85, 2000, c);
    expect(phone.far - phone.near).toBeGreaterThan(portrait.far - portrait.near);
  });
});

describe('layers', () => {
  const constant = (v: number): Plane => {
    const p = createPlane(9, 7);
    p.data.fill(v);
    return p;
  };
  const layer = (v: number, alpha: Plane, distance: number): Layer => ({
    rgb: [constant(v), constant(v), constant(v)],
    alpha,
    distance,
  });

  it('an opaque layer in front hides the layers behind it', () => {
    const [r] = renderLayers([layer(0.2, constant(1), 1000), layer(0.9, constant(1), 5000)], () => 3);
    r.data.forEach((v) => expect(v).toBeCloseTo(0.2, 6));
  });

  it('a half transparent layer mixes with the one behind, independent of the input order', () => {
    const layers = [layer(0.2, constant(0.5), 1000), layer(1, constant(1), 5000)];
    const [a] = renderLayers(layers, () => 0);
    const [b] = renderLayers([...layers].reverse(), () => 0);
    a.data.forEach((v, i) => {
      expect(v).toBeCloseTo(0.6, 6);
      expect(b.data[i]).toBeCloseTo(v, 12);
    });
  });

  it('blurs the edge of a foreground object into the background', () => {
    const mask = createPlane(9, 7);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) mask.data[y * 9 + x] = 1;
    const [sharp] = renderLayers([layer(0, mask, 1000), layer(1, constant(1), 5000)], () => 0);
    const [blurred] = renderLayers([layer(0, mask, 1000), layer(1, constant(1), 5000)], (d) => (d === 1000 ? 4 : 0));
    expect(sharp.data[3 * 9 + 4]).toBe(1);
    expect(blurred.data[3 * 9 + 4]).toBeGreaterThan(0.1);
    expect(blurred.data[3 * 9 + 4]).toBeLessThan(0.9);
  });
});
