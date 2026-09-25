import { describe, expect, it } from 'vitest';
import { type Plane, createPlane } from '../../src/shared/image';
import { PRESETS, displayValue, filterRepeated, kernelFromCells, parseWeight, resizeCells } from './kernels';

const at = (p: Plane, x: number, y: number) => p.data[y * p.width + x];

function image(width: number, height: number, f: (x: number, y: number) => number): Plane {
  const p = createPlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data[y * width + x] = f(x, y);
  return p;
}

describe('weights', () => {
  it('parses numbers and fractions', () => {
    expect(parseWeight('1/9')).toBeCloseTo(1 / 9, 9);
    expect(parseWeight(' -2 ')).toBe(-2);
    expect(parseWeight('-.5')).toBe(-0.5);
    expect(parseWeight('36/256')).toBeCloseTo(0.140625, 9);
    expect(parseWeight('abc')).toBeNull();
    expect(parseWeight('1/0')).toBeNull();
  });

  it('presets that average sum to 1', () => {
    for (const name of ['box3', 'box5', 'gauss5', 'sharpen', 'emboss'] as const) {
      expect(kernelFromCells(PRESETS[name].rows).data.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });

  it('resizes around the center', () => {
    expect(resizeCells(PRESETS.identity.rows, 5)[2][2]).toBe('1');
    expect(resizeCells(PRESETS.sobelX.rows, 5)[0][0]).toBe('0');
    expect(resizeCells(resizeCells(PRESETS.sobelX.rows, 5), 3)).toEqual(PRESETS.sobelX.rows);
  });
});

describe('shift kernel', () => {
  const img = image(20, 16, (x, y) => (x * 16 + y) / 400);
  const shift = kernelFromCells(PRESETS.shift.rows);

  it('correlation moves the content left and up', () => {
    const { result } = filterRepeated(img, shift, 'correlation', 'zero', 1);
    expect(at(result, 8, 8)).toBe(at(img, 10, 9));
  });

  it('convolution moves it right and down', () => {
    const { result } = filterRepeated(img, shift, 'convolution', 'zero', 1);
    expect(at(result, 8, 8)).toBe(at(img, 6, 7));
  });

  it('applied n times shifts n times as far', () => {
    const { input, result } = filterRepeated(img, shift, 'correlation', 'zero', 3);
    expect(at(result, 2, 2)).toBeCloseTo(at(img, 8, 5), 6);
    expect(at(input, 2, 2)).toBeCloseTo(at(img, 6, 4), 6);
  });
});

describe('Sobel', () => {
  const slope = 0.01;
  const rampX = image(12, 10, (x) => slope * x);

  it('of a horizontal ramp is constant 8 × slope inside the image', () => {
    const { result } = filterRepeated(rampX, kernelFromCells(PRESETS.sobelX.rows), 'correlation', 'clamp', 1);
    for (let y = 0; y < 10; y++) for (let x = 1; x < 11; x++) expect(at(result, x, y)).toBeCloseTo(8 * slope, 6);
  });

  it('changes sign under convolution', () => {
    const { result } = filterRepeated(rampX, kernelFromCells(PRESETS.sobelX.rows), 'convolution', 'clamp', 1);
    expect(at(result, 5, 5)).toBeCloseTo(-8 * slope, 6);
  });

  it('in y does not respond to a horizontal ramp', () => {
    const { result } = filterRepeated(rampX, kernelFromCells(PRESETS.sobelY.rows), 'correlation', 'clamp', 1);
    expect(Math.max(...result.data.map(Math.abs))).toBeCloseTo(0, 6);
  });
});

describe('display', () => {
  it('maps signed values with 0 as mid-gray', () => {
    expect(displayValue(0, 'signed')).toBe(0.5);
    expect(displayValue(-0.4, 'abs')).toBeCloseTo(0.4, 9);
    expect(displayValue(1.3, 'clip')).toBe(1);
  });
});
