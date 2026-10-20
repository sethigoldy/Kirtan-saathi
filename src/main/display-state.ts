/**
 * Single source of truth for what the sangat sees. The engine host reports
 * shabad / line changes; the operator controls blanking and presentation
 * settings. Every output (projector window, OBS overlay, phone follow page)
 * renders the same view, so they can never disagree.
 */
import { EventEmitter } from 'node:events';

import { DEFAULT_SETTINGS, type DisplayLine, type DisplayReport, type DisplayView, type PresentationSettings } from './display-types';

export { DEFAULT_SETTINGS };
export type { DisplayLine, DisplayReport, DisplayShabad, DisplayView, PresentationSettings } from './display-types';

export class DisplayState extends EventEmitter {
  private seq = 0;
  private report: DisplayReport = { mode: 'kirtan', stream: null, shabad: null, line: null, next: null };
  private blank = false;
  private settingsValue: PresentationSettings;

  constructor(settings: Partial<PresentationSettings> = {}) {
    super();
    this.settingsValue = sanitize({ ...DEFAULT_SETTINGS, ...settings });
  }

  get settings(): PresentationSettings {
    return this.settingsValue;
  }

  get isBlank(): boolean {
    return this.blank;
  }

  update(report: DisplayReport): void {
    const prev = this.report;
    const same =
      prev.mode === report.mode &&
      prev.stream === report.stream &&
      prev.line === report.line &&
      (prev.shabad?.index ?? null) === (report.shabad?.index ?? null) &&
      (prev.next?.line ?? null) === (report.next?.line ?? null);
    this.report = report;
    if (!same) this.changed();
  }

  setBlank(blank: boolean): void {
    if (blank === this.blank) return;
    this.blank = blank;
    this.changed();
  }

  updateSettings(patch: Partial<PresentationSettings>): PresentationSettings {
    this.settingsValue = sanitize({ ...this.settingsValue, ...patch });
    this.changed();
    return this.settingsValue;
  }

  view(): DisplayView {
    const r = this.report;
    const s = r.shabad;
    const current = s && r.line !== null ? s.lines.find((l) => l.line === r.line) ?? null : null;
    let next: DisplayLine | null = null;
    if (r.mode !== 'kirtan' && current) {
      // Paath and bani move forward: the engine reports the next stream line
      // (which may be in the next shabad); fall back to the next line here.
      next = r.next ?? (s ? s.lines[s.lines.indexOf(current) + 1] ?? null : null);
    }
    const source = s
      ? [r.stream && r.stream !== s.source ? r.stream : '', s.source, s.section, s.author, s.page > 0 ? `page ${s.page}` : '']
          .filter(Boolean)
          .join(' · ')
      : '';
    return {
      seq: this.seq,
      blank: this.blank,
      mode: r.mode,
      stream: r.stream,
      source,
      current,
      next,
      lines: s?.lines ?? [],
      settings: this.settingsValue,
    };
  }

  private changed(): void {
    this.seq++;
    this.emit('change', this.view());
  }
}

function sanitize(s: PresentationSettings): PresentationSettings {
  return {
    larivaar: !!s.larivaar,
    vishraam: !!s.vishraam,
    nextLine: !!s.nextLine,
    showSource: !!s.showSource,
    fontScale: Math.min(2.5, Math.max(0.5, Number(s.fontScale) || 1)),
    theme: s.theme === 'light' || s.theme === 'saffron' ? s.theme : 'dark',
  };
}
