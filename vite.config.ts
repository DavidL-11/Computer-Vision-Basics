import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

// Every folder in demos/ that contains an index.html becomes its own page.
const demoEntries = Object.fromEntries(
  readdirSync(resolve(root, 'demos'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(root, 'demos', d.name, 'index.html')))
    .map((d) => [d.name, resolve(root, 'demos', d.name, 'index.html')]),
);

export default defineConfig({
  // GitHub Pages serves the site from https://<user>.github.io/Computer-Vision-Basics/
  base: '/Computer-Vision-Basics/',
  build: {
    // Three.js alone is ~700 kB; that is expected for the 3D demos.
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
