// Without a stored choice the OS preference applies via CSS `color-scheme: light dark`;
// an explicit choice is stored and set as <html data-theme>. Canvas/WebGL code can't
// follow CSS automatically, so it listens for 'themechange' and re-reads cssColor().

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'cv-basics-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : null;
}

export function currentTheme(): Theme {
  return storedTheme() ?? (media.matches ? 'dark' : 'light');
}

function notify(): void {
  window.dispatchEvent(new CustomEvent<Theme>('themechange', { detail: currentTheme() }));
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
  notify();
}

export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(callback: (theme: Theme) => void): void {
  window.addEventListener('themechange', () => callback(currentTheme()));
}

export function initTheme(): void {
  const stored = storedTheme();
  if (stored) document.documentElement.dataset.theme = stored;
  media.addEventListener('change', () => {
    if (!storedTheme()) notify();
  });
}

let probe: HTMLElement | null = null;

/**
 * Resolves a color token like '--axis-x' to 'rgb(...)'. getPropertyValue() would
 * return the unresolved light-dark(...) string, so the value goes through a probe element.
 */
export function cssColor(name: string): string {
  if (!probe) {
    probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
  }
  probe.style.color = `var(${name})`;
  return getComputedStyle(probe).color;
}

const SUN =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/></g></svg>';
const MOON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1Z"/></svg>';

export function createThemeToggle(): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'icon-button theme-toggle';
  button.type = 'button';
  const render = () => {
    const dark = currentTheme() === 'dark';
    button.innerHTML = dark ? SUN : MOON;
    button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    button.setAttribute('aria-label', button.title);
  };
  button.addEventListener('click', toggleTheme);
  onThemeChange(render);
  render();
  return button;
}
