/**
 * Fullscreen projector window on a chosen display.
 *
 * - Remembers the display; if it is unplugged the window closes instead of
 *   jumping onto the operator's screen, and it reopens when the display
 *   returns (while the operator has the projector switched on).
 * - Keeps the display awake while shown.
 * - Escape closes it (a safety exit when only one screen is connected).
 */
import { BrowserWindow, powerSaveBlocker, screen, type Display } from 'electron';
import { EventEmitter } from 'node:events';

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  width: number;
  height: number;
}

export interface ProjectorStatus {
  enabled: boolean;
  displayId: number | null;
  showing: boolean;
  /** Display the window is on (or would open on). */
  targetId: number | null;
  displays: DisplayInfo[];
}

const THEME_BG: Record<string, string> = { khanda: '#fbf4e4', dark: '#0b0908', light: '#fbf8f1', saffron: '#0f1d45' };

export class Projector extends EventEmitter {
  private win: BrowserWindow | null = null;
  private blocker: number | null = null;
  private enabled = false;
  private displayId: number | null = null;
  private onDisplays = () => this.reconcile();

  constructor(private readonly url: () => string, private theme: () => string) {
    super();
    screen.on('display-added', this.onDisplays);
    screen.on('display-removed', this.onDisplays);
    screen.on('display-metrics-changed', this.onDisplays);
  }

  static displays(): DisplayInfo[] {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: d.label || `Display ${i + 1}`,
      primary: d.id === primary,
      width: d.size.width,
      height: d.size.height,
    }));
  }

  /** Remembered display if connected, else the first external display, else primary. */
  private target(): Display | null {
    const all = screen.getAllDisplays();
    if (this.displayId !== null) {
      // A remembered display that is not connected: do not fall back while
      // it is missing, so an unplugged projector never covers the operator.
      return all.find((d) => d.id === this.displayId) ?? null;
    }
    const primary = screen.getPrimaryDisplay();
    return all.find((d) => d.id !== primary.id) ?? primary;
  }

  status(): ProjectorStatus {
    return {
      enabled: this.enabled,
      displayId: this.displayId,
      showing: !!this.win,
      targetId: this.target()?.id ?? null,
      displays: Projector.displays(),
    };
  }

  set(enabled: boolean, displayId: number | null): void {
    const moved = displayId !== this.displayId;
    this.enabled = enabled;
    this.displayId = displayId;
    if (moved) this.close();
    this.reconcile();
  }

  /** Reload after the server port changes. */
  reload(): void {
    this.win?.loadURL(this.url()).catch(() => undefined);
  }

  private reconcile(): void {
    const d = this.enabled ? this.target() : null;
    if (!d) this.close();
    else if (!this.win) this.open(d);
    else this.place(d);
    this.emit('status', this.status());
  }

  private place(d: Display): void {
    if (!this.win) return;
    const b = d.bounds;
    const cur = this.win.getBounds();
    if (cur.x === b.x && cur.y === b.y && cur.width === b.width && cur.height === b.height) return;
    if (process.platform === 'darwin') this.win.setSimpleFullScreen(false);
    else this.win.setFullScreen(false);
    this.win.setBounds(b);
    this.fullscreen();
  }

  private fullscreen(): void {
    if (!this.win) return;
    // Simple fullscreen on macOS avoids a Spaces animation and stays on the projector.
    if (process.platform === 'darwin') this.win.setSimpleFullScreen(true);
    else this.win.setFullScreen(true);
  }

  private open(d: Display): void {
    const win = new BrowserWindow({
      ...d.bounds,
      frame: false,
      show: false,
      title: 'Kirtan Saathi — Projector',
      backgroundColor: THEME_BG[this.theme()] ?? THEME_BG.dark,
      skipTaskbar: false,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault();
        this.set(false, this.displayId);
      }
    });
    win.once('ready-to-show', () => {
      win.showInactive();
      this.fullscreen();
    });
    win.on('closed', () => {
      if (this.win === win) this.win = null;
      this.stopBlocker();
      this.emit('status', this.status());
    });
    this.win = win;
    if (this.blocker === null) this.blocker = powerSaveBlocker.start('prevent-display-sleep');
    void win.loadURL(this.url());
  }

  private close(): void {
    const w = this.win;
    this.win = null;
    this.stopBlocker();
    if (w && !w.isDestroyed()) w.destroy();
  }

  private stopBlocker(): void {
    if (this.blocker !== null) powerSaveBlocker.stop(this.blocker);
    this.blocker = null;
  }

  dispose(): void {
    screen.off('display-added', this.onDisplays);
    screen.off('display-removed', this.onDisplays);
    screen.off('display-metrics-changed', this.onDisplays);
    this.close();
  }

  /** For the CI smoke test. */
  capture(): Promise<Electron.NativeImage> | null {
    return this.win ? this.win.webContents.capturePage() : null;
  }
}
