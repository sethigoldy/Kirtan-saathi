/**
 * Operator settings persisted to <userData>/settings.json. Unknown or invalid
 * values fall back to defaults, so a damaged file never stops the app.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomInt } from 'node:crypto';
import { DEFAULT_SETTINGS, type PresentationSettings } from './display-types';
import type { UpdatePrefs } from './update-check';

export interface AppSettings {
  presentation: PresentationSettings;
  projector: {
    /** Re-open the projector on start and when its display returns. */
    enabled: boolean;
    /** Electron display id; null = first external display. */
    displayId: number | null;
  };
  server: {
    port: number;
    /** Let phones on the same network open the follow page. */
    lan: boolean;
    /** Needed by other machines for /api/control. */
    pin: string;
  };
  updates: UpdatePrefs;
}

export const DEFAULT_PORT = 7531;

export function defaultSettings(): AppSettings {
  return {
    presentation: { ...DEFAULT_SETTINGS },
    projector: { enabled: false, displayId: null },
    server: { port: DEFAULT_PORT, lan: false, pin: String(randomInt(0, 10000)).padStart(4, '0') },
    updates: { check: true, auto: false },
  };
}

export function parseSettings(raw: unknown): AppSettings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Record<keyof AppSettings, Record<string, unknown>>>;
  const p = r.presentation ?? {};
  const pr = r.projector ?? {};
  const sv = r.server ?? {};
  const up = r.updates ?? {};
  return {
    presentation: { ...d.presentation, ...(p as Partial<PresentationSettings>) },
    projector: {
      enabled: typeof pr.enabled === 'boolean' ? pr.enabled : d.projector.enabled,
      displayId: typeof pr.displayId === 'number' ? pr.displayId : null,
    },
    server: {
      port: Number.isInteger(sv.port) && (sv.port as number) >= 1024 && (sv.port as number) < 65536 ? (sv.port as number) : d.server.port,
      lan: typeof sv.lan === 'boolean' ? sv.lan : d.server.lan,
      pin: typeof sv.pin === 'string' && /^\d{4,8}$/.test(sv.pin) ? sv.pin : d.server.pin,
    },
    updates: {
      check: typeof up.check === 'boolean' ? up.check : d.updates.check,
      auto: typeof up.auto === 'boolean' ? up.auto : d.updates.auto,
    },
  };
}

export class SettingsStore {
  private value: AppSettings;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* first run or unreadable: defaults */
    }
    this.value = parseSettings(raw);
  }

  get(): AppSettings {
    return this.value;
  }

  update(fn: (s: AppSettings) => void): AppSettings {
    fn(this.value);
    this.value = parseSettings(this.value);
    this.scheduleSave();
    return this.value;
  }

  /** Write now (atomic rename), e.g. on quit. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.value, null, 2));
      renameSync(tmp, this.file);
    } catch (e) {
      console.error(`settings: could not save ${this.file}: ${(e as Error).message}`);
    }
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }
}
