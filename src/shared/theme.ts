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

export function createThemeToggle(): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'theme-toggle';
  button.type = 'button';
  const render = () => {
    const dark = currentTheme() === 'dark';
    button.textContent = dark ? '☀' : '☾';
    button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    button.setAttribute('aria-label', button.title);
  };
  button.addEventListener('click', toggleTheme);
  onThemeChange(render);
  render();
  return button;
}
