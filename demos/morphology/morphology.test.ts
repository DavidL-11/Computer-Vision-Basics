import { describe, expect, it } from 'vitest';
import {
  type Binary,
  close,
  complement,
  createBinary,
  dilate,
  erode,
  initialImage,
  labelComponents,
  open,
  structuringElement,
} from './morphology';

function binary(rows: string[]): Binary {
  const b = createBinary(rows[0].length, rows.length);
  b.data.set(rows.join('').split('').map((c) => (c === '#' ? 1 : 0)));
  return b;
}

const count = (b: Binary) => b.data.reduce((a, v) => a + v, 0);
const square = structuringElement('square', 1);

describe('structuring elements', () => {
  it('have the expected shapes', () => {
    expect(count(structuringElement('square', 2))).toBe(25);
    expect(count(structuringElement('cross', 2))).toBe(9);
    expect(count(structuringElement('disk', 2))).toBe(21);
  });
});

describe('opening and closing', () => {
  it('opening removes specks smaller than B and keeps larger objects', () => {
    const a = binary([
      '..........',
      '.#....###.',
      '......###.',
      '..##..###.',
      '..........',
    ]);
    const opened = open(a, square);
    expect(count(opened)).toBe(9);
    expect(opened.data[2 * 10 + 7]).toBe(1);
  });

  it('closing fills a hole smaller than B', () => {
    const a = binary([
      '#######',
      '#######',
      '###.###',
      '#######',
      '#######',
    ]);
    expect(count(close(a, square))).toBe(35);
  });

  it('opening splits blobs joined by a thin bridge', () => {
    const a = binary([
      '###....###',
      '###....###',
      '##########',
      '###....###',
      '###....###',
    ]);
    expect(labelComponents(a, 8).count).toBe(1);
    expect(labelComponents(open(a, square), 8).count).toBe(2);
  });
});

describe('duality', () => {
  it('eroding A equals dilating the complement, complemented', () => {
    const a = initialImage();
    const b = structuringElement('disk', 2);
    expect(erode(a, b).data).toEqual(complement(dilate(complement(a), b)).data);
    expect(close(a, b).data).toEqual(complement(open(complement(a), b)).data);
  });

  it('dilation grows and erosion shrinks', () => {
    const a = initialImage();
    const grown = dilate(a, square);
    const shrunk = erode(a, square);
    a.data.forEach((v, i) => {
      expect(grown.data[i]).toBeGreaterThanOrEqual(v);
      expect(shrunk.data[i]).toBeLessThanOrEqual(v);
    });
  });
});

describe('connected components', () => {
  const diagonal = binary([
    '#....',
    '.#...',
    '..#..',
    '.....',
    '...##',
  ]);

  it('a diagonal line is one component with 8-connectivity but separate pixels with 4', () => {
    expect(labelComponents(diagonal, 8).count).toBe(2);
    expect(labelComponents(diagonal, 4).count).toBe(4);
  });

  it('merges labels that meet later (a U shape)', () => {
    const u = binary([
      '#...#',
      '#...#',
      '#####',
    ]);
    const { count: n, sizes, labels } = labelComponents(u, 4);
    expect(n).toBe(1);
    expect(sizes).toEqual([9]);
    expect(labels[4]).toBe(1);
  });

  it('numbers components in raster order and counts their sizes', () => {
    const { labels, sizes } = labelComponents(diagonal, 4);
    expect(labels[0]).toBe(1);
    expect(labels[4 * 5 + 3]).toBe(4);
    expect(sizes).toEqual([1, 1, 1, 2]);
  });
});
