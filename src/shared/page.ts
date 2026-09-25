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
  brand.innerHTML = 'Computer Vision<span>·</span>Basics';
  container.append(brand);

  if (options.title) {
    const crumb = document.createElement('nav');
    crumb.className = 'breadcrumb';
    const chapter = options.chapterId ? chapterById(options.chapterId) : undefined;
    if (chapter) {
      const link = document.createElement('a');
      link.href = `${home}#${chapter.id}`;
      link.textContent = `${chapter.number}. ${chapter.title}`;
      crumb.append('/ ', link, ` / ${options.title}`);
    } else {
      crumb.append(`/ ${options.title}`);
    }
    container.append(crumb);
  }

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  container.append(spacer, createRepoLink(), createThemeToggle());
  header.append(container);
  document.body.prepend(header);

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="container">Computer Vision Basics: interactive computer vision fundamentals.</div>`;
  document.body.append(footer);
}
