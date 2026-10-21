/**
 * End-to-end harness: launches the real app (operator window, engine,
 * presentation server, projector) and drives it with Playwright. The
 * microphone is Chromium's fake capture device playing a recorded Japji
 * Sahib paath, so audio takes the same path as at a gurdwara.
 *
 *   KIRTAN_APP=<path to Kirtan Saathi.exe>   test an installed or packaged app
 *   (unset)                                  test this checkout (needs the Electron binary and the model)
 *   E2E_OUT=<dir>                            screenshots of failed checks and app logs (default e2e-results)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import type { DisplayView } from '../main/display-types';

export const REPO = resolve(__dirname, '..', '..');
export const JAPJI_WAV = join(REPO, 'test', 'fixtures', 'japji-50s.wav');
export const OUT = resolve(process.env.E2E_OUT ?? join(REPO, 'e2e-results'));
/** The version under test (an installed app is built from this checkout). */
export const VERSION = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string }).version;

/**
 * The stand-in for GitHub; tests change it. `answer` and `status` are the
 * latest-release API reply; `feed` is the update the app may download
 * (electron-updater's latest.yml / latest-linux.yml and the file).
 */
export const releases: { answer: Record<string, unknown>; status: number; feed: { version: string; payload: Buffer } | null } = {
  answer: { tag_name: `v${VERSION}` },
  status: 200,
  feed: null,
};
let releasesBase: string | null = null;

function feedFile(version: string): string {
  return process.platform === 'win32' ? `Kirtan-Saathi-Setup-${version}.exe` : `Kirtan-Saathi-${version}-Linux-x86_64.AppImage`;
}

/** Update checks and downloads go to this local server, so tests never reach the internet. */
async function releaseServer(): Promise<string> {
  if (releasesBase) return releasesBase;
  const s = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const f = releases.feed;
    if (path === '/releases/latest') {
      res.writeHead(releases.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(releases.answer));
    } else if (f && (path === '/feed/latest.yml' || path === '/feed/latest-linux.yml')) {
      const file = feedFile(f.version);
      const sha = createHash('sha512').update(f.payload).digest('base64');
      res.writeHead(200, { 'Content-Type': 'text/yaml' }).end(
        `version: ${f.version}\nfiles:\n  - url: ${file}\n    sha512: ${sha}\n    size: ${f.payload.length}\npath: ${file}\nsha512: ${sha}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`,
      );
    } else if (f && path === `/feed/${feedFile(f.version)}`) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.payload.length }).end(f.payload);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  s.unref();
  releasesBase = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return releasesBase;
}

export interface App {
  app: ElectronApplication;
  /** The operator window. */
  page: Page;
  userData: string;
  /** Presentation server, e.g. http://127.0.0.1:7531 */
  base: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The app binary and the arguments that come before ours. */
function target(): { exe: string; pre: string[] } {
  const packaged = process.env.KIRTAN_APP;
  // In plain Node, the electron package exports the path to its binary.
  return packaged ? { exe: packaged, pre: [] } : { exe: require('electron') as string, pre: [REPO] };
}

function switches(userData: string): string[] {
  const s = [
    `--user-data-dir=${userData}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${JAPJI_WAV}`,
    '--disable-gpu',
  ];
  if (process.platform === 'linux') s.push('--no-sandbox');
  return s;
}

let launches = 0;

/** Start the app with a private settings folder and wait until the engine is ready. */
export async function launch(userData = mkdtempSync(join(tmpdir(), 'kirtan-saathi-e2e-'))): Promise<App> {
  mkdirSync(OUT, { recursive: true });
  const { exe, pre } = target();
  const stand = await releaseServer();
  const env = { ...process.env, KIRTAN_SAATHI_UPDATE_URL: `${stand}/releases/latest`, KIRTAN_SAATHI_UPDATE_FEED: `${stand}/feed` } as Record<string, string>;
  const app = await electron.launch({ executablePath: exe, args: [...pre, ...switches(userData)], cwd: REPO, env, timeout: 120_000 });
  const log = createWriteStream(join(OUT, `app-${++launches}.log`));
  app.process().stdout?.pipe(log);
  app.process().stderr?.pipe(log);
  const page = await app.firstWindow();
  await page.waitForSelector('#mic:not([disabled])', { timeout: 240_000 });
  await page.waitForSelector('#preview[src^="http"]');
  const base = (await page.$eval('#preview', (f) => (f as HTMLIFrameElement).src)).replace(/\/projector$/, '');
  return { app, page, userData, base };
}

/** A second copy of the app with the same settings folder; resolves with its exit code. */
export function launchSecond(userData: string, timeoutMs = 60_000): Promise<number | null> {
  const { exe, pre } = target();
  return new Promise((done, fail) => {
    const p = spawn(exe, [...pre, ...switches(userData)], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      p.kill();
      fail(new Error(`the second copy was still running after ${timeoutMs} ms`));
    }, timeoutMs);
    p.on('exit', (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
}

/** What every screen shows, from the presentation server. */
export async function state(base: string): Promise<DisplayView> {
  const res = await fetch(`${base}/api/state`);
  return (await res.json()) as DisplayView;
}

/** Poll until `ok` holds; the error names what was awaited and the last value seen. */
export async function until<T>(what: string, get: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: T | undefined;
  let err: unknown;
  for (;;) {
    try {
      last = await get();
      if (ok(last)) return last;
      err = undefined;
    } catch (e) {
      err = e;
    }
    if (Date.now() > end) {
      const seen = JSON.stringify(last)?.slice(0, 400);
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}; last value: ${seen}${err ? `; error: ${String(err)}` : ''}`);
    }
    await sleep(250);
  }
}

/** Gurbani text as rendered: vishraam markers removed, spaces collapsed. */
export function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/[;.,](?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
}

/** Screenshot every open window (for a failed check). */
export async function snap(app: ElectronApplication | undefined, name: string): Promise<void> {
  if (!app) return;
  mkdirSync(OUT, { recursive: true });
  const slug = name.replace(/[^\w]+/g, '-').slice(0, 60);
  const windows = app.windows();
  for (let i = 0; i < windows.length; i++) {
    await windows[i].screenshot({ path: join(OUT, `${slug}-${i + 1}.png`) }).catch(() => undefined);
  }
}
