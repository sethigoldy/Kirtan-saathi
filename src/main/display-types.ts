/**
 * Display types shared by the main process and the browser-side
 * presentation page (no Node imports, so both builds can use it).
 */

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
  /**
   * Meaning (arth) under the tuk: Punjabi, Hindi, or both. Hindi uses a Hindi
   * translation when one is bundled, otherwise the Punjabi arth in Hindi script.
   */
  meaning: 'off' | 'pa' | 'hi' | 'both';
  /** 'khanda': light background with a Khanda watermark. */
  theme: 'khanda' | 'dark' | 'light' | 'saffron';
}

export const DEFAULT_SETTINGS: PresentationSettings = {
  larivaar: false,
  vishraam: true,
  nextLine: true,
  showSource: true,
  waheguru: true,
  fontScale: 1,
  hindi: 'off',
  meaning: 'off',
  theme: 'khanda',
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
}

export interface DisplayShabad {
  index: number;
  source: string;
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
  /** Whose arth is shown, e.g. "Arth: Prof. Sahib Singh" ('' when meanings are off). */
  credit: string;
  settings: PresentationSettings;
}

/** Engine-host report (see engine-host.ts). */
export interface DisplayReport {
  mode: 'kirtan' | 'paath' | 'bani';
  stream: string | null;
  shabad: DisplayShabad | null;
  line: number | null;
  next: DisplayLine | null;
}
