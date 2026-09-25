import { initPage } from '../shared/page';
import { chapters, demoUrl, type Chapter, type Demo } from '../data/chapters';
import './landing.css';

initPage();

const app = document.getElementById('app')!;
const demoCount = chapters.reduce((n, c) => n + c.demos.length, 0);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; html?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  node.append(...children);
  return node;
}

function renderHero(): HTMLElement {
  return el(
    'section',
    { className: 'hero' },
    el('h1', { text: 'Computer vision fundamentals, interactively' }),
    el('p', {
      className: 'lead',
      text:
        'Small, hands-on visualizations for the core ideas of computer vision, from how light becomes pixels to ' +
        'reconstructing 3D surfaces. Every demo exposes the underlying math so you can change a parameter and watch what happens.',
    }),
    el(
      'div',
      { className: 'stats' },
      el('span', { html: `<strong>${chapters.length}</strong> chapters` }),
      el('span', { html: `<strong>${demoCount}</strong> interactive demo${demoCount === 1 ? '' : 's'}` }),
    ),
  );
}

function renderToc(): HTMLElement {
  const list = el('ol', { className: 'toc' });
  for (const c of chapters) {
    const a = el('a', { text: c.title });
    a.href = `#${c.id}`;
    if (c.demos.length) a.append(el('span', { className: 'dot', text: '' }));
    list.append(el('li', {}, a));
  }
  return el('nav', { className: 'toc-wrap', html: '<h2 class="toc-title">Chapters</h2>' }, list);
}

function renderDemo(demo: Demo): HTMLElement {
  const a = el(
    'a',
    { className: 'demo' },
    el('h4', { text: demo.title }),
    el('p', { text: demo.description }),
    el('span', { className: 'demo-open', text: 'Open demo →' }),
  );
  a.href = demoUrl(demo.slug);
  return a;
}

function renderChapter(chapter: Chapter): HTMLElement {
  const section = el('section', { className: 'chapter card' });
  section.id = chapter.id;
  section.append(
    el(
      'header',
      { className: 'chapter-head' },
      el('span', { className: 'chapter-number', text: String(chapter.number).padStart(2, '0') }),
      el('div', {}, el('h2', { text: chapter.title }), el('p', { className: 'muted', text: chapter.summary })),
    ),
    el('ul', { className: 'concepts' }, ...chapter.concepts.map((c) => el('li', { text: c }))),
  );
  if (chapter.demos.length) section.append(el('div', { className: 'demos' }, ...chapter.demos.map(renderDemo)));
  return section;
}

app.append(
  renderHero(),
  el('div', { className: 'layout' }, renderToc(), el('div', { className: 'chapters' }, ...chapters.map(renderChapter))),
);
