// Adds canonical and social preview tags to every page and prerenders the landing page from chapters.ts.

import type { Plugin } from 'vite';
import { renderLanding } from '../src/landing/render';

export function seo(options: { origin: string }): Plugin {
  let base = '/';
  return {
    name: 'seo',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml(html, ctx) {
      const path = ctx.path.replace(/^\//, '').replace(/index\.html$/, '');
      const url = new URL(base + path, options.origin).href;
      const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
      const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
      const head = [
        `<link rel="canonical" href="${url}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="Computer Vision Basics" />`,
        `<meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:url" content="${url}" />`,
        `<meta name="twitter:card" content="summary" />`,
      ].join('\n    ');
      html = html.replace('</head>', `  ${head}\n  </head>`);
      if (path === '') html = html.replace('<main class="container" id="app"></main>', `<main class="container" id="app">${renderLanding(base)}</main>`);
      return html;
    },
  };
}
