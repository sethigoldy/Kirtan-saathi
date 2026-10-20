/**
 * Electron main process: the operator window, the engine utility process
 * (a direct MessagePort carries audio from the renderer to it), the display
 * state every output renders, the local presentation server, and the
 * projector window.
 */
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  MessageChannelMain,
  session,
  shell,
  systemPreferences,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DisplayState, type DisplayReport, type PresentationSettings } from './display-state';
import { Meanings } from './meanings';
import { Projector } from './projector';
import { PresentationServer, type ControlAction } from './server';
import { SettingsStore } from './settings';
import type { ToEngine } from './protocol';

let win: BrowserWindow | null = null;
let engine: UtilityProcess | null = null;
let engineStarted = false;
let settings: SettingsStore;
let display: DisplayState;
let server: PresentationServer;
let projector: Projector;

function appBase(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function resourcePaths(): { models: string; corpus: string } {
  const base = appBase();
  return { models: join(base, 'models'), corpus: join(base, 'resources', 'corpus.json.gz') };
}

function loadMeanings(): Meanings | null {
  try {
    return Meanings.load(join(appBase(), 'resources', 'meanings.json.gz'));
  } catch (e) {
    console.error(`meanings unavailable: ${(e as Error).message}`);
    return null;
  }
}

function startEngine(): UtilityProcess {
  const child = utilityProcess.fork(join(__dirname, 'engine-host.js'), [], {
    serviceName: 'kirtan-saathi-engine',
    stdio: 'pipe',
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[engine] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[engine] ${d}`));
  child.on('message', (m: { type?: string; report?: DisplayReport }) => {
    if (m?.type === 'display' && m.report) display.update(m.report);
  });
  child.on('exit', (code) => {
    console.error(`engine exited with code ${code}`);
    engine = null;
    engineStarted = false;
  });
  return child;
}

/** Commands from the presentation server or operator controls, not the renderer port. */
function toEngine(msg: ToEngine): void {
  engine?.postMessage({ type: 'cmd', msg });
}

/** Give the renderer a fresh port to the engine (on every page load). */
function connect(): void {
  if (!win) return;
  if (!engine) engine = startEngine();
  const { port1, port2 } = new MessageChannelMain();
  if (!engineStarted) {
    engine.postMessage({ type: 'init', paths: resourcePaths() }, [port2]);
    engineStarted = true;
  } else {
    engine.postMessage({ type: 'attach' }, [port2]);
  }
  win.webContents.postMessage('engine-port', null, [port1]);
}

function presentStatus() {
  const s = settings.get();
  return {
    projector: projector.status(),
    server: { port: server.port, lan: s.server.lan, urls: server.urls() },
  };
}

function pushStatus(): void {
  win?.webContents.send('present:status', presentStatus());
}

function control(action: ControlAction): void {
  if (action === 'blank') display.setBlank(true);
  else if (action === 'unblank') display.setBlank(false);
  else toEngine({ type: 'step', offset: action === 'next' ? 1 : -1 });
}

function registerIpc(): void {
  // macOS asks once, when the operator first presses Start listening.
  ipcMain.handle('mic:access', async () => {
    if (process.platform !== 'darwin') return true;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    if (status === 'not-determined') return systemPreferences.askForMediaAccess('microphone').catch(() => false);
    return false;
  });
  ipcMain.handle('present:init', () => ({ view: display.view(), status: presentStatus() }));
  ipcMain.handle('present:settings', (_e, patch: Partial<PresentationSettings>) => {
    const next = display.updateSettings(patch ?? {});
    settings.update((s) => (s.presentation = next));
    return next;
  });
  ipcMain.handle('present:control', (_e, action: ControlAction) => {
    if (['blank', 'unblank', 'next', 'prev'].includes(action)) control(action);
  });
  ipcMain.handle('present:projector', (_e, p: { enabled: boolean; displayId: number | null }) => {
    projector.set(!!p.enabled, typeof p.displayId === 'number' ? p.displayId : null);
  });
  ipcMain.handle('present:lan', async (_e, lan: boolean) => {
    settings.update((s) => (s.server.lan = !!lan));
    await server.reconfigure({ lan: !!lan });
    projector.reload();
    pushStatus();
  });
  ipcMain.handle('present:copy', (_e, text: string) => {
    if (typeof text === 'string' && text.length < 500) clipboard.writeText(text);
  });
  ipcMain.handle('present:open', (_e, url: string) => {
    // Only our own pages: the overlay / follow preview in the default browser.
    if (typeof url === 'string' && url.startsWith(`http://127.0.0.1:${server.port}/`)) void shell.openExternal(url);
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: 'Kirtan Saathi',
    backgroundColor: '#14110f',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      // Keep decoding and the projector updating while the window is unfocused.
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-finish-load', () => {
    connect();
    pushStatus();
  });
  void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
    // The operator window is the app: closing it closes the projector too
    // (on macOS as well). The projector setting is kept for the next start.
    app.quit();
  });
}

/**
 * Smoke test (development and CI): GURBANI_SMOKE=<16 kHz mono wav> streams
 * the file through the renderer at real-time pace, saves screenshots after
 * GURBANI_SMOKE_SECONDS, then quits.
 *   GURBANI_SMOKE_SHOT        operator screenshot (default smoke.png)
 *   GURBANI_SMOKE_PROJECTOR   projector screenshot (opens the projector)
 *   GURBANI_SMOKE_MODE        kirtan, paath or bani:<ID>
 *   GURBANI_SMOKE_REPORT      JSON with the final display view
 */
function smokeTest(): void {
  const file = process.env.GURBANI_SMOKE;
  if (!file || !win) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadAudio } = require('../cli/audio-file') as typeof import('../cli/audio-file');
  const pcm = loadAudio(file);
  const offset = Math.round(Number(process.env.GURBANI_SMOKE_OFFSET ?? 0) * 16000);
  const seconds = Number(process.env.GURBANI_SMOKE_SECONDS ?? 60);
  const shot = process.env.GURBANI_SMOKE_SHOT ?? 'smoke.png';
  const projShot = process.env.GURBANI_SMOKE_PROJECTOR;
  const report = process.env.GURBANI_SMOKE_REPORT;
  const mode = process.env.GURBANI_SMOKE_MODE;
  if (mode) win.webContents.send('smoke-mode', mode);
  if (projShot) projector.set(true, null);
  let pos = offset;
  const started = Date.now();
  const timer = setInterval(() => {
    const target = offset + Math.round(((Date.now() - started) / 1000) * 16000);
    if (pos < target && pos < pcm.length && win) {
      win.webContents.send('smoke-audio', pcm.slice(pos, Math.min(target, pcm.length)));
      pos = target;
    }
  }, 100);
  setTimeout(async () => {
    clearInterval(timer);
    const img = await win!.webContents.capturePage();
    writeFileSync(shot, img.toPNG());
    const p = projector.capture();
    if (projShot && p) writeFileSync(projShot, (await p).toPNG());
    if (report) writeFileSync(report, JSON.stringify({ view: display.view(), urls: server.urls() }, null, 2));
    const line = display.view().current?.text ?? '(no line)';
    console.log(`smoke: streamed ${((pos - offset) / 16000).toFixed(1)} s, line: ${line}, screenshot ${shot}`);
    app.exit(0);
  }, seconds * 1000);
}

// One running copy: a second launch focuses the first window.
if (!app.requestSingleInstanceLock() && !process.env.GURBANI_SMOKE) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // Microphone only, and only for the operator window's own page.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && wc === win?.webContents));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

    settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
    const s = settings.get();
    display = new DisplayState(s.presentation, loadMeanings());
    server = new PresentationServer(
      display,
      { port: s.server.port, lan: s.server.lan, pin: s.server.pin, staticDir: join(__dirname, '..', 'static') },
      control,
    );
    await server.start();
    projector = new Projector(
      () => `http://127.0.0.1:${server.port}/projector`,
      () => display.settings.theme,
    );
    projector.on('status', (st: ReturnType<Projector['status']>) => {
      settings.update((x) => {
        x.projector.enabled = st.enabled;
        x.projector.displayId = st.displayId;
      });
      pushStatus();
    });
    display.on('change', (view) => win?.webContents.send('present:view', view));
    registerIpc();

    createWindow();
    if (s.projector.enabled && !process.env.GURBANI_SMOKE) projector.set(true, s.projector.displayId);
    if (process.env.GURBANI_SMOKE) win!.webContents.once('did-finish-load', () => setTimeout(smokeTest, 8000));
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    engine?.kill();
    settings?.flush();
    projector?.dispose();
    void server?.stop();
  });
}
