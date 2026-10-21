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
import { createWriteStream, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import type { DisplayView } from '../main/display-types';

export const REPO = resolve(__dirname, '..', '..');
export const JAPJI_WAV = join(REPO, 'test', 'fixtures', 'japji-50s.wav');
export const OUT = resolve(process.env.E2E_OUT ?? join(REPO, 'e2e-results'));

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
  const app = await electron.launch({ executablePath: exe, args: [...pre, ...switches(userData)], cwd: REPO, timeout: 120_000 });
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
