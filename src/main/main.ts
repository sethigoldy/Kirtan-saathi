/**
 * Electron main process: one operator window, one engine utility process,
 * and a direct MessagePort between them so audio never passes through main.
 */
import { app, BrowserWindow, MessageChannelMain, session, systemPreferences, utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';

let win: BrowserWindow | null = null;
let engine: UtilityProcess | null = null;
let engineStarted = false;

function resourcePaths(): { models: string; corpus: string } {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return { models: join(base, 'models'), corpus: join(base, 'resources', 'corpus.json.gz') };
}

function startEngine(): UtilityProcess {
  const child = utilityProcess.fork(join(__dirname, 'engine-host.js'), [], {
    serviceName: 'gurbani-engine',
    stdio: 'pipe',
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[engine] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[engine] ${d}`));
  child.on('exit', (code) => {
    console.error(`engine exited with code ${code}`);
    engine = null;
    engineStarted = false;
  });
  return child;
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

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Gurbani Live',
    backgroundColor: '#14110f',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      // A projector or follow-along view must keep updating when unfocused.
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.webContents.on('did-finish-load', connect);
  void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

/**
 * Smoke test (development only): GURBANI_SMOKE=<16 kHz mono wav> streams the
 * file through the renderer at real-time pace, saves a screenshot to
 * GURBANI_SMOKE_SHOT (default smoke.png) after GURBANI_SMOKE_SECONDS, quits.
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
    require('node:fs').writeFileSync(shot, img.toPNG());
    console.log(`smoke: streamed ${((pos - offset) / 16000).toFixed(1)} s, screenshot ${shot}`);
    app.quit();
  }, seconds * 1000);
}

app.whenReady().then(async () => {
  // Microphone only; everything else is denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone').catch(() => false);
  }
  createWindow();
  if (process.env.GURBANI_SMOKE) win!.webContents.once('did-finish-load', () => setTimeout(smokeTest, 8000));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  engine?.kill();
  if (process.platform !== 'darwin') app.quit();
});
