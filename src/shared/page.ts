import './styles/base.css';
import { chapterById } from '../data/chapters';
import { createThemeToggle, initTheme } from './theme';
import { createRepoLink } from './repoLink';

export interface PageOptions {
  title?: string;
  chapterId?: string;
}

/** Adds the shared header (breadcrumb, theme toggle) and footer. */
export function initPage(options: PageOptions = {}): void {
  initTheme();

  const home = import.meta.env.BASE_URL;
  const header = document.createElement('header');
  header.className = 'site-header';
  const container = document.createElement('div');
  container.className = 'container';

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = home;
  brand.textContent = 'Computer Vision Basics';
  container.append(brand);

  if (options.title) {
    const crumb = document.createElement('nav');
    crumb.className = 'breadcrumb';
    const chapter = options.chapterId ? chapterById(options.chapterId) : undefined;
    const part = (tag: 'a' | 'span', className: string, text: string) => {
      const e = document.createElement(tag);
      e.className = className;
      e.textContent = text;
      return e;
    };
    crumb.append(part('span', 'sep', '/'));
    if (chapter) {
      const link = part('a', 'chapter-link', chapter.title) as HTMLAnchorElement;
      link.href = `${home}#${chapter.id}`;
      crumb.append(link, part('span', 'sep chapter-sep', '/'));
    }
    crumb.append(part('span', 'current', options.title));
    container.append(crumb);
  }

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  container.append(spacer, createRepoLink(), createThemeToggle());
  header.append(container);
  document.body.prepend(header);

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="container"><span>Computer Vision Basics</span><a href="${home}">All chapters</a></div>`;
  document.body.append(footer);
}
