import { chapters, type Chapter, type Demo } from '../data/chapters';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

function renderHero(): string {
  const demoCount = chapters.reduce((n, c) => n + c.demos.length, 0);
  return `<section class="hero">
  <h1>Computer vision fundamentals, interactively</h1>
  <p class="lead">Small, hands-on visualizations for the core ideas of computer vision, from how light becomes pixels to reconstructing 3D surfaces. Every demo exposes the underlying math so you can change a parameter and watch what happens.</p>
  <div class="stats"><span><strong>${chapters.length}</strong> chapters</span><span><strong>${demoCount}</strong> interactive demo${demoCount === 1 ? '' : 's'}</span></div>
</section>`;
}

function renderToc(): string {
  const items = chapters.map(
    (c) => `<li><a href="#${c.id}">${esc(c.title)}${c.demos.length ? '<span class="dot"></span>' : ''}</a></li>`,
  );
  return `<nav class="toc-wrap"><h2 class="toc-title">Chapters</h2><ol class="toc">${items.join('')}</ol></nav>`;
}

function renderDemo(demo: Demo, base: string): string {
  return `<a class="demo" href="${base}demos/${demo.slug}/"><h4>${esc(demo.title)}</h4><p>${esc(demo.description)}</p><span class="demo-open">Open demo →</span></a>`;
}

function renderChapter(c: Chapter, base: string): string {
  const concepts = c.concepts.map((k) => `<li>${esc(k)}</li>`).join('');
  const demos = c.demos.length ? `<div class="demos">${c.demos.map((d) => renderDemo(d, base)).join('')}</div>` : '';
  return `<section class="chapter card" id="${c.id}">
  <header class="chapter-head"><span class="chapter-number">${String(c.number).padStart(2, '0')}</span><div><h2>${esc(c.title)}</h2><p class="muted">${esc(c.summary)}</p></div></header>
  <ul class="concepts">${concepts}</ul>${demos}
</section>`;
}

/** Landing page body, rendered at build time so the content and demo links are in the static HTML. */
export function renderLanding(base: string): string {
  return `${renderHero()}
<div class="layout">${renderToc()}<div class="chapters">${chapters.map((c) => renderChapter(c, base)).join('\n')}</div></div>`;
}
