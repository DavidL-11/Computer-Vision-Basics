import { describe, expect, it } from 'vitest';
import { decimalsForStep, formatNumber, parseNumber, prefersSegments, sameValue, snap } from './controls';

describe('decimalsForStep', () => {
  it('counts the digits of the step', () => {
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(0.05)).toBe(2);
    expect(decimalsForStep(0.0001)).toBe(4);
    expect(decimalsForStep(1e-7)).toBe(7);
    expect(decimalsForStep(undefined)).toBe(2);
  });
});

describe('snap', () => {
  it('clamps to the range', () => {
    expect(snap(12, 0, 10, 1)).toBe(10);
    expect(snap(-3, 0, 10, 1)).toBe(0);
  });
  it('rounds to the step grid starting at min, without residue', () => {
    expect(snap(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
    expect(snap(4.4, 1, 10, 2)).toBe(5);
    expect(snap(-7.63, -16, 16, 0.1)).toBe(-7.6);
  });
  it('keeps the value without a step', () => {
    expect(snap(0.123456, 0, 1)).toBe(0.123456);
  });
});

describe('formatNumber / parseNumber', () => {
  it('formats with the decimals of the step and a real minus sign', () => {
    expect(formatNumber(-7.6, 0.1)).toBe('−7.6');
    expect(formatNumber(3, 1)).toBe('3');
  });
  it('reads minus signs and decimal commas', () => {
    expect(parseNumber('−7.6')).toBe(-7.6);
    expect(parseNumber('0,25')).toBe(0.25);
    expect(parseNumber(' 2 ')).toBe(2);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('prefersSegments', () => {
  it('uses segments for a few short labels only', () => {
    expect(prefersSegments(['1×', '2×', '4×', '8×'])).toBe(true);
    expect(prefersSegments(['draw', 'erase'])).toBe(true);
    expect(prefersSegments(['nearest neighbor', 'bilinear'])).toBe(false);
    expect(prefersSegments(['a', 'b', 'c', 'd', 'e'])).toBe(false);
    expect(prefersSegments(['only'])).toBe(false);
  });
});

describe('sameValue', () => {
  it('compares numbers, strings and points by value', () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue(NaN, NaN)).toBe(true);
    expect(sameValue('a', 'b')).toBe(false);
    expect(sameValue({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(sameValue({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    expect(sameValue({ x: 1 }, { x: 1, y: 2 })).toBe(false);
  });
});
