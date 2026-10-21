/**
 * Update notices and self-update. When the computer is online, checks GitHub
 * for a newer release shortly after start and every 6 hours, and tells the
 * operator what changed.
 *
 * The Windows installer and the Linux AppImage can update themselves with
 * electron-updater: when the operator presses Update now, or in the
 * background when "Install updates automatically" is on. A downloaded update
 * installs when the app closes (or on Restart and update), never during
 * kirtan. Unsigned macOS apps and .deb installs cannot replace themselves, so
 * they get a link to the release page instead.
 *
 *   KIRTAN_SAATHI_UPDATE_URL    release JSON to check instead of GitHub (tests)
 *   KIRTAN_SAATHI_UPDATE_FEED   update feed to download from instead of GitHub
 *                               (tests; such downloads are never installed)
 */
import { app, net } from 'electron';
import { EventEmitter } from 'node:events';
import type { AppUpdater } from 'electron-updater';
import { compareVersions, latestRelease, RELEASES_API, RELEASES_PAGE, type UpdatePrefs, type UpdateStatus } from './update-check';

const EVERY_MS = 6 * 3600_000;

/** Whether this copy of the app can replace itself. */
function canSelfUpdate(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return false;
}

export class Updates extends EventEmitter {
  private s: Omit<UpdateStatus, 'prefs'>;
  private timer: NodeJS.Timeout | null = null;
  private updater: AppUpdater | null = null;

  constructor(private readonly prefs: () => UpdatePrefs) {
    super();
    this.s = { current: app.getVersion(), state: 'idle', release: null, canInstall: canSelfUpdate(), progress: 0, message: '' };
  }

  status(): UpdateStatus {
    return { ...this.s, prefs: { ...this.prefs() } };
  }

  /** The release page to open for a manual download. */
  get page(): string {
    return this.s.release?.url ?? RELEASES_PAGE;
  }

  start(delayMs = 5000): void {
    setTimeout(() => void this.check(false), delayMs);
    this.timer = setInterval(() => void this.check(false), EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Look for a newer release. Automatic checks stay quiet when they fail. */
  async check(manual: boolean): Promise<void> {
    if (!manual && !this.prefs().check) return;
    if (this.s.state === 'checking' || this.s.state === 'downloading' || this.s.state === 'ready') return;
    if (!net.isOnline()) {
      this.set({ state: 'offline', message: '' });
      return;
    }
    this.set({ state: 'checking', message: '' });
    try {
      const r = await latestRelease(process.env.KIRTAN_SAATHI_UPDATE_URL || RELEASES_API);
      if (!r || compareVersions(r.version, this.s.current) <= 0) {
        this.set({ state: 'latest', release: null });
        return;
      }
      this.set({ state: 'available', release: r });
      if (this.prefs().auto && this.s.canInstall) await this.download();
    } catch (e) {
      this.set({ state: manual ? 'error' : 'idle', message: manual ? String((e as Error).message ?? e) : '' });
    }
  }

  /** Download the update; it installs when the app closes. */
  async download(): Promise<void> {
    if (!this.s.canInstall || !this.s.release || this.s.state === 'downloading' || this.s.state === 'ready') return;
    this.set({ state: 'downloading', progress: 0, message: '' });
    try {
      const u = await this.autoUpdater();
      const found = await u.checkForUpdates();
      if (!found?.isUpdateAvailable) throw new Error('the release has no installer for this computer yet');
      await u.downloadUpdate();
    } catch (e) {
      this.set({ state: 'available', message: `Could not download the update (${String((e as Error).message ?? e).split('\n')[0]}). Use Download instead.` });
    }
  }

  /** Close the app and install the downloaded update. */
  installNow(): void {
    if (this.s.state === 'ready') this.updater?.quitAndInstall(true, true);
  }

  private async autoUpdater(): Promise<AppUpdater> {
    if (this.updater) return this.updater;
    // Loaded only when needed: development runs and notify-only installs never use it.
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    const feed = process.env.KIRTAN_SAATHI_UPDATE_FEED;
    if (feed) {
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
      autoUpdater.autoInstallOnAppQuit = false;
    }
    autoUpdater.on('download-progress', (p: { percent: number }) => this.set({ state: 'downloading', progress: p.percent / 100 }));
    autoUpdater.on('update-downloaded', () => this.set({ state: 'ready', progress: 1 }));
    this.updater = autoUpdater;
    return autoUpdater;
  }

  private set(patch: Partial<Omit<UpdateStatus, 'prefs'>>): void {
    this.s = { ...this.s, ...patch };
    this.emit('status', this.status());
  }
}
