import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { katexHtml } from './build/katexHtml.ts';
import { sitemap } from './build/sitemap.ts';
import { seo } from './build/seo.ts';

const root = import.meta.dirname;
const origin = 'https://davidl-11.github.io';

// Every folder in demos/ that contains an index.html becomes its own page.
const demoSlugs = readdirSync(resolve(root, 'demos'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(root, 'demos', d.name, 'index.html')))
  .map((d) => d.name);
const demoEntries = Object.fromEntries(demoSlugs.map((s) => [s, resolve(root, 'demos', s, 'index.html')]));

export default defineConfig({
  // GitHub Pages serves the site from https://<user>.github.io/Computer-Vision-Basics/
  base: '/Computer-Vision-Basics/',
  plugins: [
    katexHtml(),
    seo({ origin }),
    sitemap({
      origin,
      root,
      pages: [
        { path: '', sources: ['index.html', 'src/landing', 'src/data'] },
        ...demoSlugs.map((s) => ({ path: `demos/${s}/`, sources: [`demos/${s}`] })),
      ],
    }),
  ],
  build: {
    // Three.js (~700 kB) and KaTeX (~260 kB) end up in one chunk shared by the demos.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      input: {
        main: resolve(root, 'index.html'),
        ...demoEntries,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    passWithNoTests: true,
  },
});
