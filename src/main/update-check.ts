/**
 * Release check against GitHub: the newest published release, whether it is
 * newer than this app, and the "What's new" list from its release notes.
 * No Electron or Node imports, so the renderer can share the types.
 */

export const RELEASES_API = 'https://api.github.com/repos/sethigoldy/Kirtan-saathi/releases/latest';
export const RELEASES_PAGE = 'https://github.com/sethigoldy/Kirtan-saathi/releases';

export interface Release {
  version: string;
  /** Release page (download links and full notes). */
  url: string;
  /** "What's new" items, plain text. */
  notes: string[];
}

export interface UpdatePrefs {
  /** Check GitHub for a newer release when online. */
  check: boolean;
  /** Download updates in the background and install them when the app closes. */
  auto: boolean;
}

export interface UpdateStatus {
  current: string;
  state: 'idle' | 'checking' | 'latest' | 'offline' | 'available' | 'downloading' | 'ready' | 'error';
  release: Release | null;
  /** This copy can install updates itself (Windows installer, Linux AppImage). */
  canInstall: boolean;
  /** Download progress, 0–1. */
  progress: number;
  message: string;
  prefs: UpdatePrefs;
}

/** Compare dotted versions; a leading "v" and pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((x) => Number(x) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Bullet points under the release notes' "What's new" heading, without markdown. */
export function whatsNew(body: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.*)/);
    if (heading) {
      if (inside) break;
      inside = /what.?s new/i.test(heading[1]);
      continue;
    }
    const item = inside ? line.match(/^\s*[-*]\s+(.*)/) : null;
    if (item) {
      out.push(
        item[1]
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .trim(),
      );
    }
  }
  return out;
}

/** The latest published release (throws when offline or GitHub does not answer). */
export async function latestRelease(url = RELEASES_API, timeoutMs = 10_000): Promise<Release | null> {
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Kirtan-Saathi' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
  const r = (await res.json()) as { tag_name?: unknown; html_url?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown };
  if (typeof r.tag_name !== 'string' || r.draft || r.prerelease) return null;
  const page = typeof r.html_url === 'string' && r.html_url.startsWith(`${RELEASES_PAGE}/`) ? r.html_url : RELEASES_PAGE;
  return { version: r.tag_name.replace(/^v/, ''), url: page, notes: whatsNew(typeof r.body === 'string' ? r.body : '') };
}
