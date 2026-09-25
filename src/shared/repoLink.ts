const OWNER = 'DavidL-11';
const REPO = 'Computer-Vision-Basics';
const CACHE_KEY = 'cv-basics-repo-stats';
// Unauthenticated GitHub API calls are limited to 60 per hour per IP.
const CACHE_MS = 60 * 60 * 1000;

interface RepoStats {
  stars: number;
  forks: number;
  time: number;
}

const ICONS = {
  github:
    'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z',
  star: 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z',
  fork: 'M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z',
};

const icon = (path: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;

const formatCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

async function loadStats(): Promise<RepoStats | null> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as RepoStats | null;
    if (cached && Date.now() - cached.time < CACHE_MS) return cached;
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`);
    if (!res.ok) return cached;
    const data = (await res.json()) as { stargazers_count: number; forks_count: number };
    const stats = { stars: data.stargazers_count, forks: data.forks_count, time: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(stats));
    return stats;
  } catch {
    return null;
  }
}

/** Link to the source repository with its star and fork counts. */
export function createRepoLink(): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'repo-link';
  a.href = `https://github.com/${OWNER}/${REPO}`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = 'Source code on GitHub';
  a.innerHTML = `${icon(ICONS.github)}<span class="repo-name">${OWNER}/${REPO}</span>`;

  void loadStats().then((stats) => {
    if (!stats) return;
    for (const [path, count, label] of [
      [ICONS.star, stats.stars, 'stars'],
      [ICONS.fork, stats.forks, 'forks'],
    ] as const) {
      const span = document.createElement('span');
      span.className = 'repo-stat';
      span.title = `${count} ${label}`;
      span.innerHTML = icon(path);
      span.append(formatCount(count));
      a.append(span);
    }
  });
  return a;
}
