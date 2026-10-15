import { chapters, type Chapter, type Demo } from '../data/chapters.ts';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

function renderHero(): string {
  return `<section class="hero">
  <h1>Computer Vision Basics</h1>
  <p class="lead">Interactive demos for the core ideas of computer vision, from how light becomes pixels to reconstructing 3D scenes. Each one puts the math next to the picture, so you can change a parameter and see what it does.</p>
</section>`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function renderToc(): string {
  const items = chapters.map(
    (c) => `<li><a href="#${c.id}"><span class="toc-number">${pad(c.number)}</span>${esc(c.title)}</a></li>`,
  );
  return `<nav class="toc-wrap" aria-label="Chapters"><ol class="toc">${items.join('')}</ol></nav>`;
}

function renderDemo(demo: Demo, base: string): string {
  return `<a class="demo" href="${base}demos/${demo.slug}/"><h3>${esc(demo.title)}</h3><p>${esc(demo.description)}</p></a>`;
}

function renderChapter(c: Chapter, base: string): string {
  const demos = c.demos.length ? `<div class="demos">${c.demos.map((d) => renderDemo(d, base)).join('')}</div>` : '';
  return `<section class="chapter" id="${c.id}">
  <span class="chapter-number">${pad(c.number)}</span>
  <div class="chapter-body">
    <h2>${esc(c.title)}</h2>
    <p class="summary">${esc(c.summary)}</p>
    <p class="concepts">${c.concepts.map(esc).join(', ')}</p>${demos}
  </div>
</section>`;
}

/** Landing page body, rendered at build time so the content and demo links are in the static HTML. */
export function renderLanding(base: string): string {
  return `${renderHero()}
<div class="layout">${renderToc()}<div class="chapters">${chapters.map((c) => renderChapter(c, base)).join('\n')}</div></div>`;
}
