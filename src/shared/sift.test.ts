import { describe, expect, it } from 'vitest';
import { blur } from './dog';
import { type Plane, createPlane } from './image';
import { random } from './noise';
import { BINS, LENGTH, describe as describeKeypoint, distance, dominantOrientations, normalizeDescriptor, orientationHistogram } from './sift';
import { IDENTITY, mapPoint, warp } from './warp';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

const DEG = Math.PI / 180;
/** Smooth random texture, so that every orientation occurs, plus a blob next to the center for a clear orientation. */
function texture(size: number, seed: number): Plane {
  const rand = random(seed);
  const c = size / 2;
  const blob = (x: number, y: number) => 0.4 * Math.exp(-((x - c - 5) ** 2 + (y - c - 2) ** 2) / 32);
  return blur(image(size, size, (x, y) => 0.2 + 0.3 * rand() + blob(x, y)), 2);
}
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

describe('orientation', () => {
  it('finds the direction of a ramp, up to half a bin', () => {
    for (const deg of [0, 30, 135, 250]) {
      const a = deg * DEG;
      const ramp = image(41, 41, (x, y) => 0.01 * (x * Math.cos(a) + y * Math.sin(a)));
      const [theta] = dominantOrientations(orientationHistogram(ramp, 20, 20, 2));
      // All gradients fall into one bin: the peak is its center.
      expect(angleDiff(theta, a)).toBeLessThanOrEqual(5 * DEG + 1e-9);
    }
  });

  it('returns every peak of at least 80% of the highest, strongest first', () => {
    const hist = new Float32Array(36);
    hist[4] = 1;
    hist[20] = 0.85;
    hist[30] = 0.7;
    const peaks = dominantOrientations(hist);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeCloseTo(40 * DEG, 9);
    expect(peaks[1]).toBeCloseTo(200 * DEG, 9);
  });

  it('refines a peak with a parabola', () => {
    const hist = new Float32Array(36);
    hist[9] = 0.5;
    hist[10] = 1;
    hist[11] = 1;
    hist[12] = 0.5;
    // Two equal bins: the first one is the peak, halfway towards the second.
    expect(dominantOrientations(hist)[0]).toBeCloseTo(105 * DEG, 9);
  });
});

describe('descriptor', () => {
  it('puts all of a ramp into bin 0 of every cell when θ is the ramp direction', () => {
    const a = 60 * DEG;
    const ramp = image(61, 61, (x, y) => 0.01 * (x * Math.cos(a) + y * Math.sin(a)));
    const { raw } = describeKeypoint(ramp, 30, 30, 2, a);
    for (let i = 0; i < LENGTH; i++) if (i % BINS !== 0) expect(raw[i]).toBeLessThan(1e-4 * raw[0]);
    expect(raw[0]).toBeGreaterThan(0);
  });

  it('has unit length, with no element above the clamp limit before renormalizing', () => {
    const d = describeKeypoint(texture(64, 3), 32, 32, 2, 0.3, 0.2);
    expect(Math.hypot(...d.normalized)).toBeCloseTo(1, 5);
    expect(Math.max(...d.clamped)).toBeLessThanOrEqual(0.2 + 1e-7);
    expect(Math.hypot(...d.descriptor)).toBeCloseTo(1, 5);
  });

  it('only renormalizes with a clamp limit of 1', () => {
    const raw = Float32Array.from({ length: LENGTH }, (_, i) => (i === 0 ? 10 : 1));
    const { normalized, descriptor } = normalizeDescriptor(raw, 1);
    descriptor.forEach((v, i) => expect(v).toBeCloseTo(normalized[i], 6));
  });

  it('is invariant to brightness and contrast changes', () => {
    const L = texture(64, 5);
    const changed = { ...L, data: L.data.map((v) => 0.5 * v + 0.2) };
    const a = describeKeypoint(L, 32, 32, 2, 1).descriptor;
    const b = describeKeypoint(changed, 32, 32, 2, 1).descriptor;
    expect(distance(a, b)).toBeLessThan(1e-5);
  });

  it('is invariant to rotation once θ is assigned', () => {
    const I = texture(80, 11);
    for (const deg of [90, 30]) {
      const T = { ...IDENTITY, angle: deg * DEG };
      const J = warp(I, T);
      const [u, v] = mapPoint(T, 80, 80, 40, 40);
      const theta = dominantOrientations(orientationHistogram(I, 40, 40, 2.5))[0];
      const thetaJ = dominantOrientations(orientationHistogram(J, u, v, 2.5))[0];
      expect(angleDiff(thetaJ, theta + T.angle)).toBeLessThan(5 * DEG);
      const a = describeKeypoint(I, 40, 40, 2.5, theta).descriptor;
      const b = describeKeypoint(J, u, v, 2.5, thetaJ).descriptor;
      // Without orientation assignment the descriptors differ a lot.
      const unrotated = describeKeypoint(J, u, v, 2.5, theta).descriptor;
      expect(distance(a, b)).toBeLessThan(deg === 90 ? 0.05 : 0.2);
      expect(distance(a, unrotated)).toBeGreaterThan(Math.max(0.3, 3 * distance(a, b)));
    }
  });
});
