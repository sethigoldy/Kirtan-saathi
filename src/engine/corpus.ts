import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { LineRole, stripVishraam, toKeyWithBoundaries } from './gurmukhi';

/** On-disk corpus format written by `build-corpus` (gzipped JSON). */
export interface CorpusFile {
  version: 1;
  generatedAt: string;
  provenance: { name: string; version: string; textLicense: string; codeLicense: string; url: string };
  sources: { id: string; name: string; nameEn: string }[];
  shabads: {
    id: string;
    source: number;
    section: string;
    author: string;
    page: number;
    start: number;
    count: number;
  }[];
  lines: { id: string[]; text: string[]; page: number[]; role: number[] };
  banis: { id: string; name: string; nameEn: string; lines: number[] }[];
}

export interface ShabadInfo {
  index: number;
  id: string;
  source: number;
  section: string;
  author: string;
  page: number;
  /** Global index of the shabad's first line. */
  start: number;
  count: number;
}

/** In-memory corpus with matching keys derived at load time. */
export class Corpus {
  readonly sources: CorpusFile['sources'];
  readonly shabads: ShabadInfo[];
  readonly banis: CorpusFile['banis'];
  readonly provenance: CorpusFile['provenance'];
  readonly lineId: string[];
  /** Canonical display text with vishraam markers (';' major, '.' minor). */
  readonly text: string[];
  /** Display text without vishraam markers. */
  readonly plain: string[];
  /** Matching key (see gurmukhi.ts). */
  readonly key: string[];
  /** Per key unit: restart boundary (word / phrase / line start). */
  readonly keyFlags: Uint8Array[];
  readonly role: Uint8Array;
  readonly page: Int32Array;
  readonly shabadOf: Int32Array;
  readonly lineInShabad: Int32Array;

  constructor(file: CorpusFile) {
    if (file.version !== 1) throw new Error(`unsupported corpus version ${file.version}`);
    this.sources = file.sources;
    this.banis = file.banis;
    this.provenance = file.provenance;
    this.lineId = file.lines.id;
    this.text = file.lines.text;
    const n = this.text.length;
    this.plain = new Array(n);
    this.key = new Array(n);
    this.keyFlags = new Array(n);
    this.role = Uint8Array.from(file.lines.role);
    this.page = Int32Array.from(file.lines.page);
    this.shabadOf = new Int32Array(n);
    this.lineInShabad = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.plain[i] = stripVishraam(this.text[i]);
      const kb = toKeyWithBoundaries(this.text[i]);
      this.key[i] = kb.key;
      this.keyFlags[i] = kb.flags;
    }
    this.shabads = file.shabads.map((s, index) => ({ index, ...s }));
    for (const s of this.shabads) {
      for (let j = 0; j < s.count; j++) {
        this.shabadOf[s.start + j] = s.index;
        this.lineInShabad[s.start + j] = j;
      }
    }
  }

  get lineCount(): number {
    return this.text.length;
  }

  /** Global line indices of a shabad, in order. */
  linesOf(shabad: number): number[] {
    const s = this.shabads[shabad];
    return Array.from({ length: s.count }, (_, j) => s.start + j);
  }

  /** True when a line should take part in retrieval and tracking. */
  isSingable(line: number): boolean {
    const r = this.role[line];
    return r !== LineRole.Header && r !== LineRole.Mangal && this.key[line].length > 0;
  }

  static load(path: string): Corpus {
    const raw = readFileSync(path);
    const json = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    return new Corpus(JSON.parse(json) as CorpusFile);
  }
}
