import { describe, expect, it } from 'vitest';
import { CAMERA_SIGMA, buildScaleSpace, detectKeypoints, dogSignature, edgeLimit, locate, normalizedLoG } from './dog';
import { type Plane, createPlane } from './image';

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

const disk = (size: number, cx: number, cy: number, r: number, inside = 0.9, outside = 0.2) =>
  image(size, size, (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? inside : outside));

const space = { sigma0: 1.6, intervals: 3, octaves: 4 };
const detect = { ...space, threshold: 0.01, edgeRatio: 10, interpolate: true };

describe('scale space', () => {
  it('blurs an impulse to the variance σ_i² − 0.5² within the first octave', () => {
    const impulse = image(41, 41, (x, y) => (x === 20 && y === 20 ? 1 : 0));
    const [oct] = buildScaleSpace(impulse, space);
    oct.gaussians.forEach((L, i) => {
      let variance = 0;
      for (let y = 0; y < 41; y++) for (let x = 0; x < 41; x++) variance += L.data[y * 41 + x] * (x - 20) ** 2;
      // Sampling and truncating the kernel at 3σ lose a little.
      expect(variance / (oct.sigmas[i] ** 2 - CAMERA_SIGMA ** 2)).toBeCloseTo(1, 1);
    });
  });

  it('has s + 3 Gaussian and s + 2 DoG images per octave, D_i = L_i − L_{i+1}, halving the size each octave', () => {
    const octaves = buildScaleSpace(disk(64, 32, 32, 6), space);
    expect(octaves.map((o) => o.gaussians[0].width)).toEqual([64, 32, 16, 8]);
    for (const o of octaves) {
      expect(o.gaussians).toHaveLength(6);
      expect(o.dogs).toHaveLength(5);
      expect(o.dogs[1].data[10]).toBeCloseTo(o.gaussians[1].data[10] - o.gaussians[2].data[10], 6);
    }
    expect(octaves[0].sigmas[3]).toBeCloseTo(2 * 1.6, 9);
  });
});

describe('keypoints', () => {
  it('finds a bright disk as a maximum at its center with σ ≈ r / √2', () => {
    const r = 6;
    const kept = detectKeypoints(buildScaleSpace(disk(64, 31.5, 32, r), space), detect).filter((k) => k.status === 'kept');
    const best = kept.reduce((a, b) => (Math.abs(b.contrast) > Math.abs(a.contrast) ? b : a));
    expect(best.value).toBeGreaterThan(0);
    expect(best.x).toBeCloseTo(31.5, 0);
    expect(best.y).toBeCloseTo(32, 0);
    expect(best.sigma / (r / Math.SQRT2)).toBeGreaterThan(0.8);
    expect(best.sigma / (r / Math.SQRT2)).toBeLessThan(1.25);
  });

  it('finds a dark disk as a minimum', () => {
    const kept = detectKeypoints(buildScaleSpace(disk(64, 32, 32, 5, 0.1, 0.8), space), detect).filter((k) => k.status === 'kept');
    const best = kept.reduce((a, b) => (Math.abs(b.contrast) > Math.abs(a.contrast) ? b : a));
    expect(best.value).toBeLessThan(0);
  });

  it('interpolates the position between pixels', () => {
    const kps = detectKeypoints(buildScaleSpace(disk(64, 30.5, 32.5, 4), space), detect);
    const best = kps.reduce((a, b) => (Math.abs(b.contrast) > Math.abs(a.contrast) ? b : a));
    expect(Math.abs(best.x - 30.5)).toBeLessThan(0.25);
    expect(Math.abs(best.y - 32.5)).toBeLessThan(0.25);
    expect(Math.abs(best.contrast)).toBeGreaterThanOrEqual(Math.abs(best.value));
  });

  it('rejects the extremum of a long thin bar as an edge', () => {
    // Slightly brighter towards the middle, so that the ridge of D has a single maximum there.
    const bar = image(96, 64, (x, y) => (x >= 8 && x < 88 && y >= 28 && y < 36 ? 0.9 - 0.002 * Math.abs(x - 48) : 0.2));
    const kps = detectKeypoints(buildScaleSpace(bar, space), detect);
    const middle = kps.filter((k) => Math.abs(k.x - 48) < 10 && Math.abs(k.y - 31.5) < 3);
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.every((k) => k.status === 'edge' && k.edge >= edgeLimit(10))).toBe(true);
  });

  it('rejects low-contrast blobs', () => {
    const kps = detectKeypoints(buildScaleSpace(disk(64, 32, 32, 5, 0.26, 0.2), space), { ...detect, threshold: 0.03 });
    expect(kps.filter((k) => k.status === 'kept')).toHaveLength(0);
  });

  it('has the edge limit (r + 1)² / r', () => {
    expect(edgeLimit(10)).toBeCloseTo(12.1, 9);
  });
});

describe('scale selection', () => {
  const r = 8;
  const I = disk(96, 48, 48, r);
  const sigmas = Array.from({ length: 60 }, (_, i) => 1 + i * 0.25);
  const peak = (values: number[]) => sigmas[values.indexOf(Math.max(...values))];

  it('has the extremum of the normalized LoG of a disk at σ ≈ r / √2', () => {
    const log = sigmas.map((s) => -normalizedLoG(I, 48, 48, s));
    expect(peak(log)).toBeGreaterThan(0.85 * (r / Math.SQRT2));
    expect(peak(log)).toBeLessThan(1.15 * (r / Math.SQRT2));
  });

  it('approximates −(k − 1) σ² ∇²L with the DoG', () => {
    const octaves = buildScaleSpace(I, space);
    const k = 2 ** (1 / 3);
    const samples = dogSignature(octaves, 48, 48);
    expect(samples.map((s) => s.sigma)).toEqual([...samples.map((s) => s.sigma)].sort((a, b) => a - b));
    for (const s of samples.filter((s) => s.sigma > 2 && s.sigma < 12)) {
      const log = -(k - 1) * normalizedLoG(I, 48, 48, s.sigma * Math.sqrt(k));
      expect(Math.abs(s.value - log)).toBeLessThan(0.15 * Math.abs(log) + 0.01);
    }
  });
});

describe('locate', () => {
  it('finds the octave and the Gaussian image closest in scale', () => {
    const octaves = buildScaleSpace(disk(64, 32, 32, 6), space);
    expect(locate(octaves, 10, 20, 1.6)).toMatchObject({ octave: 0, level: 0, u: 10, v: 20 });
    expect(locate(octaves, 10, 20, 1.6 * 2 ** (4 / 3))).toMatchObject({ octave: 1, level: 1, u: 5, v: 10 });
    expect(locate(octaves, 10, 20, 1.6 * 2 ** (4 / 3)).sigmaOctave).toBeCloseTo(0.8 * 2 ** (4 / 3), 9);
    expect(locate(octaves, 0, 0, 1000)).toMatchObject({ octave: 3, level: 5 });
    expect(locate(octaves, 0, 0, 0.5)).toMatchObject({ octave: 0, level: 0 });
  });
});
