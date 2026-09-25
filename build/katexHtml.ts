// Renders LaTeX in the <body> of HTML pages at build time: $$…$$ as display math, \(…\) inline.
// Pages ship finished markup, so static formulas need no JavaScript and never flash as raw TeX.

import type { Plugin } from 'vite';
import { renderTex } from '../src/shared/tex';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|nbsp);/g, (m) => ENTITIES[m]);

function render(tex: string, displayMode: boolean, file: string): string {
  try {
    return renderTex(decode(tex).trim(), displayMode);
  } catch (e) {
    throw new Error(`Invalid TeX in ${file}: ${(e as Error).message}\n  ${tex.trim()}`);
  }
}

export function renderTexInHtml(html: string, file = 'HTML'): string {
  const bodyStart = html.indexOf('<body');
  if (bodyStart < 0) return html;
  const body = html
    .slice(bodyStart)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => render(tex, true, file))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => render(tex, false, file));
  return html.slice(0, bodyStart) + body;
}

export function katexHtml(): Plugin {
  return {
    name: 'katex-html',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => renderTexInHtml(html, ctx.path),
    },
  };
}
