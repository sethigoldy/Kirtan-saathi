/**
 * Display types shared by the main process and the browser-side
 * presentation page (no Node imports, so both builds can use it).
 */

/** Meanings under the tuk: Punjabi arth, Hindi, English translation. */
export type MeaningLang = 'pa' | 'hi' | 'en';

export interface PresentationSettings {
  /** Write Gurbani without spaces between words. */
  larivaar: boolean;
  /** Colour words at vishraam (pause) points. */
  vishraam: boolean;
  /** Show the next line under the current one (paath and bani modes). */
  nextLine: boolean;
  /** Show source, raag and page under the line. */
  showSource: boolean;
  /** Show ਵਾਹਿਗੁਰੂ on the projector and overlay while no line is on screen (searching). */
  waheguru: boolean;
  /** Multiplier on the base font size. */
  fontScale: number;
  /** Devanagari (Hindi script) transliteration: under the Gurmukhi, or instead of it. */
  hindi: 'off' | 'below' | 'only';
  /** English transliteration (the tuk in English letters) under the tuk. */
  roman: boolean;
  /**
   * Meanings under the tuk, in this order (empty = off): Punjabi arth, Hindi
   * (a Hindi translation when one is bundled, otherwise the Punjabi arth in
   * Hindi script), English translation.
   */
  meaning: MeaningLang[];
  /** 'khanda': light background with a Khanda watermark. */
  theme: 'khanda' | 'dark' | 'light' | 'saffron';
  /** The app's own words (not Gurbani): labels, the source line, credits. */
  language: 'en' | 'pa';
}

export const DEFAULT_SETTINGS: PresentationSettings = {
  larivaar: false,
  vishraam: true,
  nextLine: true,
  showSource: true,
  waheguru: true,
  fontScale: 1,
  hindi: 'off',
  roman: false,
  meaning: [],
  theme: 'khanda',
  language: 'en',
};

export interface DisplayLine {
  line: number;
  /** Canonical text with vishraam markers (';' major, '.' minor). */
  text: string;
  role: number;
  /** Punjabi meaning (arth). */
  pa?: string;
  /** Hindi meaning, when a Hindi translation is bundled. */
  hi?: string;
  /** English translation. */
  en?: string;
}

export interface DisplayShabad {
  index: number;
  source: string;
  /** Scripture name in Gurmukhi. */
  sourcePa?: string;
  section: string;
  author: string;
  page: number;
  lines: DisplayLine[];
}

/** What every presentation client receives. */
export interface DisplayView {
  seq: number;
  blank: boolean;
  mode: 'kirtan' | 'paath' | 'bani';
  stream: string | null;
  /** "Sri Guru Granth Sahib · Raag Gauree · page 335" (no author name). */
  source: string;
  current: DisplayLine | null;
  next: DisplayLine | null;
  /** Whole shabad, for the follow page. */
  lines: DisplayLine[];
  /** Credit for the meanings shown, e.g. "Arth: Prof. Sahib Singh · Translation: Dr. Sant Singh Khalsa" ('' when off). */
  credit: string;
  /** Per-language credits, so a phone showing its own choice credits it. */
  credits: { arth: string; translation: string };
  settings: PresentationSettings;
}

/** Engine-host report (see engine-host.ts). */
export interface DisplayReport {
  mode: 'kirtan' | 'paath' | 'bani';
  stream: string | null;
  /** The stream (bani or scripture) name in Gurmukhi. */
  streamPa?: string | null;
  shabad: DisplayShabad | null;
  line: number | null;
  next: DisplayLine | null;
}
