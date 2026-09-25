import { describe, expect, it } from 'vitest';
import { renderTexInHtml } from './katexHtml';

describe('renderTexInHtml', () => {
  it('renders display and inline math in the body', () => {
    const out = renderTexInHtml('<html><body><p>\\(x^2\\)</p>$$\\frac{a}{b}$$</body></html>');
    expect(out).not.toContain('\\(');
    expect(out).not.toContain('$$');
    expect(out).toContain('katex-display');
    expect(out.match(/class="katex"/g)).toHaveLength(2);
  });

  it('leaves the head alone', () => {
    const out = renderTexInHtml('<html><head><meta content="\\(x\\)"></head><body></body></html>');
    expect(out).toContain('<meta content="\\(x\\)">');
  });

  it('decodes HTML entities before rendering', () => {
    const out = renderTexInHtml('<body>$$\\begin{bmatrix} 1 &amp; 2 \\end{bmatrix}$$</body>');
    expect(out).toContain('katex-display');
  });

  it('reports invalid TeX with the file name', () => {
    expect(() => renderTexInHtml('<body>\\(\\frac{1}\\)</body>', 'demo.html')).toThrow(/demo\.html/);
  });
});
