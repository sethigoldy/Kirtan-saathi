/**
 * Single source of truth for what the sangat sees. The engine host reports
 * shabad / line changes; the operator controls blanking and presentation
 * settings. Every output (projector window, OBS overlay, phone follow page)
 * renders the same view, so they can never disagree.
 */
import { EventEmitter } from 'node:events';
import type { MeaningLookup } from './meanings';

import { DEFAULT_SETTINGS, type DisplayLine, type DisplayReport, type DisplayView, type PresentationSettings } from './display-types';
import { creditText, pageText, parseMeaning, sectionPa } from '../present/format';

export { DEFAULT_SETTINGS };
export type { DisplayLine, DisplayReport, DisplayShabad, DisplayView, PresentationSettings } from './display-types';

export class DisplayState extends EventEmitter {
  private seq = 0;
  private report: DisplayReport = { mode: 'kirtan', stream: null, shabad: null, line: null, next: null };
  private blank = false;
  private settingsValue: PresentationSettings;

  constructor(settings: Partial<PresentationSettings> = {}, private readonly meanings: MeaningLookup | null = null) {
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
    // The author (Guru Sahib / Bhagat) is deliberately not shown with the tuk.
    const pa = this.settingsValue.language === 'pa';
    const stream = r.stream && r.stream !== s?.source ? (pa ? r.streamPa || r.stream : r.stream) : '';
    const source = s
      ? (pa
          ? [stream, s.sourcePa || s.source, sectionPa(s.section), pageText(s.source, s.page, 'pa')]
          : [stream, s.source, s.section, pageText(s.source, s.page)]
        )
          .filter(Boolean)
          .join(' · ')
      : '';
    // Lines always carry every language: the projector shows the operator's
    // choice, and each phone its reader's own.
    const withMeaning = this.meanings !== null;
    const m = this.meanings;
    const add = (l: DisplayLine | null): DisplayLine | null =>
      l && withMeaning ? { ...l, pa: m!.pa(l.line), hi: m!.hi(l.line), en: m!.en(l.line) } : l;
    const credits = withMeaning && current ? { arth: m!.credit(current.line), translation: m!.enCredit(current.line) } : { arth: '', translation: '' };
    return {
      seq: this.seq,
      blank: this.blank,
      mode: r.mode,
      stream: r.stream,
      source,
      current: add(current),
      next,
      lines: withMeaning ? (s?.lines ?? []).map((l) => add(l)!) : s?.lines ?? [],
      credit: creditText(credits, this.settingsValue.meaning, this.settingsValue.language),
      credits,
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
    waheguru: !!s.waheguru,
    fontScale: Math.min(2.5, Math.max(0.5, Number(s.fontScale) || 1)),
    hindi: s.hindi === 'below' || s.hindi === 'only' ? s.hindi : 'off',
    meaning: parseMeaning(s.meaning),
    theme: s.theme === 'dark' || s.theme === 'light' || s.theme === 'saffron' ? s.theme : 'khanda',
    language: s.language === 'pa' ? 'pa' : 'en',
  };
}
