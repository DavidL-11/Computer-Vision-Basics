import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

interface SitemapPage {
  /** Path relative to the base, e.g. '' for the landing page or 'demos/gamma/'. */
  path: string;
  /** Repo paths whose latest commit date becomes the page's lastmod. */
  sources: string[];
}

/** Committer date (ISO 8601) of the last commit touching any of the paths, or undefined outside git. */
function lastCommitDate(cwd: string, paths: string[]): string | undefined {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...paths], { cwd, encoding: 'utf8' });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function sitemap(options: { origin: string; root: string; pages: SitemapPage[] }): Plugin {
  let base = '/';
  return {
    name: 'sitemap',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    generateBundle() {
      const urls = options.pages.map((p) => {
        const loc = new URL(base + p.path, options.origin).href;
        const lastmod = lastCommitDate(options.root, p.sources);
        return `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
      });
      const source = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        '</urlset>',
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source });
    },
  };
}
