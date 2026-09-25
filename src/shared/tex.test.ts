import { describe, expect, it } from 'vitest';
import { fmt, renderTex, texMatrix, texTuple, texVector } from './tex';

describe('fmt', () => {
  it('uses fixed decimals and avoids negative zero', () => {
    expect(fmt(1.23456, 2)).toBe('1.23');
    expect(fmt(-0.0001, 2)).toBe('0.00');
    expect(fmt(-0.5, 1)).toBe('-0.5');
  });
});

describe('texMatrix', () => {
  it('builds a right-aligned bracket matrix', () => {
    expect(texMatrix([[1, 2], [3, 4]], 0)).toBe('\\begin{bmatrix*}[r] 1 & 2 \\\\ 3 & 4 \\end{bmatrix*}');
  });

  it('adds a dashed rule for [R | t]', () => {
    expect(texMatrix([[1, 2, 3, 4]], 0, 3)).toContain('{rrr:r}');
  });

  it('builds column vectors and tuples', () => {
    expect(texVector([1, 2], 1)).toBe('\\begin{bmatrix*}[r] 1.0 \\\\ 2.0 \\end{bmatrix*}');
    expect(texTuple([1, -2], 1)).toBe('(1.0,\\ -2.0)');
  });
});

describe('renderTex', () => {
  it('renders valid TeX and allows \\htmlClass', () => {
    const html = renderTex(`\\htmlClass{result}{x = ${texVector([1, 2], 1)}}`);
    expect(html).toContain('katex');
    expect(html).toContain('result');
  });

  it('throws on invalid TeX', () => {
    expect(() => renderTex('\\frac{1}')).toThrow();
  });
});
