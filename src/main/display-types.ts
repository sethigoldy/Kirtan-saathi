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
  /** Show source, raag, author and page under the line. */
  showSource: boolean;
  /** Multiplier on the base font size. */
  fontScale: number;
  theme: 'dark' | 'light' | 'saffron';
}

export const DEFAULT_SETTINGS: PresentationSettings = {
  larivaar: false,
  vishraam: true,
  nextLine: true,
  showSource: true,
  fontScale: 1,
  theme: 'dark',
};

export interface DisplayLine {
  line: number;
  /** Canonical text with vishraam markers (';' major, '.' minor). */
  text: string;
  role: number;
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
  /** "Sri Guru Granth Sahib · Raag Gauree · Bhagat Kabir · page 335" */
  source: string;
  current: DisplayLine | null;
  next: DisplayLine | null;
  /** Whole shabad, for the follow page. */
  lines: DisplayLine[];
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
