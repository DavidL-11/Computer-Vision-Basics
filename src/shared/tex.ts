// LaTeX rendering shared by the build step (static formulas in HTML) and the live value panels.

import katex, { type KatexOptions } from 'katex';

export const KATEX_OPTIONS: KatexOptions = {
  throwOnError: true,
  // \htmlClass{name}{…} lets CSS color parts of a formula (e.g. results, line colors).
  trust: (context) => context.command === '\\htmlClass',
  strict: (code: string) => (code === 'htmlExtension' ? 'ignore' : 'warn'),
};

export function renderTex(tex: string, displayMode = false): string {
  return katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode });
}

/** Fixed number of decimals, so values don't jump around while dragging. */
export function fmt(x: number, digits: number): string {
  const s = x.toFixed(digits);
  // Avoid "-0.00"
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/** Right-aligned bracket matrix. `split` draws a dashed rule before that column, as in [R | t]. */
export function texMatrix(rows: readonly (readonly number[])[], digits: number, split?: number): string {
  const body = rows.map((row) => row.map((v) => fmt(v, digits)).join(' & ')).join(' \\\\ ');
  const cols = rows[0].length;
  if (split === undefined) return `\\begin{bmatrix*}[r] ${body} \\end{bmatrix*}`;
  const spec = 'r'.repeat(split) + ':' + 'r'.repeat(cols - split);
  return `\\left[\\begin{array}{${spec}} ${body} \\end{array}\\right]`;
}

export const texVector = (v: readonly number[], digits: number) => texMatrix(v.map((x) => [x]), digits);

/** "(x, y)" with fixed decimals. */
export const texTuple = (v: readonly number[], digits: number) => `(${v.map((x) => fmt(x, digits)).join(',\\ ')})`;

/** Wraps rendered math in a panel row. */
export const eq = (tex: string) => `<div class="eq">${renderTex(tex)}</div>`;

/** TeX for a number with `digits` significant digits, as m·10ᵉ when it is small, e.g. the entries of F. */
export function sci(x: number, digits = 3): string {
  if (Math.abs(x) < 1e-12) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2) return String(Number(x.toPrecision(digits)));
  return `${fmt(x / 10 ** e, digits - 1)}\\!\\cdot\\!10^{${e}}`;
}

/** Right-aligned bracket matrix of sci() values. */
export const texSciMatrix = (rows: readonly (readonly number[])[], digits = 3) =>
  `\\begin{bmatrix*}[r] ${rows.map((r) => r.map((v) => sci(v, digits)).join(' & ')).join(' \\\\ ')} \\end{bmatrix*}`;
