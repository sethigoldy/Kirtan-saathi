/**
 * Paath follower: tracks continuous recitation along an ordered stream of
 * lines. The stream is either a whole source in reading order (sehaj or
 * akhand paath crosses shabad boundaries) or a bani's line list (Japji,
 * Rehras, Sukhmani, ...). Headings are part of the stream because paathis
 * read them aloud.
 *
 * Each update aligns the most recent seconds of ASR output against a small
 * window of the stream around the current position. Where the alignment
 * ends is where the reader is. Recitation moves forward, so the follower
 * advances as soon as a word of the next line is matched, and moves back
 * only on repeated evidence (paathis re-read a line after a slip).
 */
import type { Corpus } from './corpus';
import type { Retriever } from './retrieval';

export interface PaathOptions {
  /** Stream lines considered behind and ahead of the current position. */
  behindLines: number;
  aheadLines: number;
  /** Minimum fraction of the recent audio explained to accept a position. */
  minScore: number;
  /** Key units matched into the next line before the display moves there. */
  minCharsInto: number;
  /**
   * Skipping lines (moving 2+ ahead) needs this many key units into the
   * target line and agreement from `skipUpdates` consecutive updates, unless
   * every skipped line is short (headings like "ਸਲੋਕੁ ਮਃ ੩ ॥").
   */
  skipCharsInto: number;
  skipUpdates: number;
  shortLine: number;
  /** When lost, look this many lines behind / ahead before giving up. */
  relocateBehind: number;
  relocateAhead: number;
  relocateScore: number;
  /** Consecutive updates pointing backwards before moving back. */
  backUpdates: number;
  /** Updates with speech but no acceptable match before declaring lost. */
  lostUpdates: number;
  /** Below this query self-score the audio is treated as a pause (hold). */
  minQuerySelf: number;
  /** Self-score floor for normalizing short queries. */
  floor: number;
  /**
   * Distance penalties (in score units) when choosing among lines where the
   * recent audio could end: per line moved back, and per line skipped beyond
   * the next one (short headings are free). Identical lines — Gurbani repeats
   * headings and phrases — then resolve towards the expected position.
   */
  backPenalty: number;
  skipPenalty: number;
}

export const DEFAULT_PAATH_OPTIONS: PaathOptions = {
  behindLines: 4,
  aheadLines: 6,
  minScore: 0.45,
  minCharsInto: 3,
  skipCharsInto: 6,
  skipUpdates: 2,
  shortLine: 10,
  relocateBehind: 30,
  relocateAhead: 60,
  relocateScore: 0.6,
  backUpdates: 2,
  lostUpdates: 8,
  minQuerySelf: 3,
  floor: 6,
  backPenalty: 0.12,
  skipPenalty: 0.06,
};

export interface PaathUpdate {
  /** Global line index on display. */
  line: number;
  score: number;
  held: boolean;
  lost: boolean;
}

/** An ordered sequence of global line indices with a name for display. */
export interface LineStream {
  id: string;
  name: string;
  lines: Int32Array;
}

/** All lines of the source that contains `line`, in reading order. */
export function sourceStream(corpus: Corpus, line: number): LineStream {
  const source = corpus.shabads[corpus.shabadOf[line]].source;
  let first = line, last = line;
  while (first > 0 && corpus.shabads[corpus.shabadOf[first - 1]].source === source) first--;
  while (last + 1 < corpus.lineCount && corpus.shabads[corpus.shabadOf[last + 1]].source === source) last++;
  const lines = new Int32Array(last - first + 1);
  for (let i = 0; i < lines.length; i++) lines[i] = first + i;
  const s = corpus.sources[source];
  return { id: `source:${s.id}`, name: s.nameEn, lines };
}

/** A bani's lines from the corpus definitions. */
export function baniStream(corpus: Corpus, baniId: string): LineStream {
  const b = corpus.banis.find((x) => x.id === baniId);
  if (!b) throw new Error(`unknown bani ${baniId}`);
  return { id: `bani:${b.id}`, name: b.nameEn, lines: Int32Array.from(b.lines) };
}

export class PaathFollower {
  readonly opts: PaathOptions;
  private pos: number;
  private back: { idx: number; n: number } | null = null;
  private skip: { idx: number; n: number } | null = null;
  private misses = 0;

  constructor(
    readonly corpus: Corpus,
    readonly retriever: Retriever,
    readonly stream: LineStream,
    startIndex: number,
    opts: Partial<PaathOptions> = {},
  ) {
    this.opts = { ...DEFAULT_PAATH_OPTIONS, ...opts };
    this.pos = Math.max(0, Math.min(stream.lines.length - 1, startIndex));
  }

  get index(): number {
    return this.pos;
  }

  get line(): number {
    return this.stream.lines[this.pos];
  }

  /** Operator: jump to a line (ignored if it is not in the stream). */
  force(line: number): void {
    const idx = this.stream.lines.indexOf(line);
    if (idx >= 0) {
      this.pos = idx;
      this.back = null;
      this.misses = 0;
    }
  }

  /**
   * Find the best position for `key` anywhere in the stream (used to start
   * following a bani). Searches in overlapping chunks to bound the cost.
   */
  static locate(retriever: Retriever, stream: LineStream, key: string, chunk = 60): { index: number; score: number } {
    let best = { index: -1, score: 0 };
    const lines = Array.from(stream.lines);
    for (let from = 0; from < lines.length; from += chunk - 4) {
      const part = lines.slice(from, Math.min(lines.length, from + chunk));
      const r = retriever.alignLines(key, part);
      if (r.endIndex >= 0 && r.score > best.score) best = { index: from + r.endIndex, score: r.score };
      if (from + chunk >= lines.length) break;
    }
    return best;
  }

  /** True when every stream line strictly between a and b is short. */
  private onlyShortBetween(a: number, b: number): boolean {
    for (let i = a + 1; i < b; i++) {
      if (this.corpus.key[this.stream.lines[i]].length > this.opts.shortLine) return false;
    }
    return true;
  }

  /** Lost: search a wider neighbourhood before giving up. */
  private relocate(key: string): boolean {
    const o = this.opts;
    const from = Math.max(0, this.pos - o.relocateBehind);
    const to = Math.min(this.stream.lines.length, this.pos + o.relocateAhead + 1);
    const part: LineStream = { ...this.stream, lines: this.stream.lines.subarray(from, to) };
    const loc = PaathFollower.locate(this.retriever, part, key);
    if (loc.index < 0 || loc.score < o.relocateScore) return false;
    this.pos = from + loc.index;
    this.misses = 0;
    this.back = this.skip = null;
    return true;
  }

  update(key: string): PaathUpdate {
    const o = this.opts;
    const n = this.stream.lines.length;
    const from = Math.max(0, this.pos - o.behindLines);
    const to = Math.min(n, this.pos + o.aheadLines + 1);
    const window = Array.from(this.stream.lines.subarray(from, to));
    const { querySelf, perLine } = this.retriever.endScores(key, window, o.floor, 6, false, o.minCharsInto);
    if (querySelf < o.minQuerySelf) return { line: this.line, score: 0, held: true, lost: false };

    // Choose where the reader is: best end score, penalized by distance.
    let bestK = -1, bestValue = -Infinity;
    for (let k = 0; k < perLine.length; k++) {
      const idx = from + k;
      let penalty = 0;
      if (idx < this.pos) penalty = o.backPenalty * (this.pos - idx);
      else if (idx > this.pos + 1) {
        let skipped = 0;
        for (let i = this.pos + 1; i < idx; i++) if (this.corpus.key[this.stream.lines[i]].length > o.shortLine) skipped++;
        penalty = o.skipPenalty * skipped;
      }
      // Other lines only count once the path is a word or so into them;
      // otherwise the reader is still at the boundary of the previous line.
      const value = (idx === this.pos ? perLine[k].score : perLine[k].scoreInto) - penalty;
      if (value > bestValue) { bestValue = value; bestK = k; }
    }
    const r = {
      endIndex: bestK,
      score: bestK >= 0 ? (from + bestK === this.pos ? perLine[bestK].score : perLine[bestK].scoreInto) : 0,
      endInto: bestK >= 0 ? perLine[bestK].into : 0,
      endLineLength: bestK >= 0 ? perLine[bestK].length : 0,
    };
    if (r.endIndex < 0 || r.score < o.minScore) {
      this.misses++;
      if (this.misses >= o.lostUpdates && this.relocate(key)) {
        return { line: this.line, score: r.score, held: false, lost: false };
      }
      return { line: this.line, score: r.score, held: false, lost: this.misses >= o.lostUpdates };
    }
    this.misses = 0;
    const idx = from + r.endIndex;
    if (idx === this.pos + 1 || (idx > this.pos + 1 && this.onlyShortBetween(this.pos, idx))) {
      // Next line (possibly past short headings): move once a word or so is read.
      if (r.endInto >= Math.min(o.minCharsInto, r.endLineLength)) this.pos = idx;
      this.back = this.skip = null;
    } else if (idx > this.pos) {
      // Skipping lines is rare in paath; require a firm, repeated match.
      if (r.endInto >= Math.min(o.skipCharsInto, r.endLineLength)) {
        if (this.skip && this.skip.idx === idx) this.skip.n++;
        else this.skip = { idx, n: 1 };
        if (this.skip.n >= o.skipUpdates) {
          this.pos = idx;
          this.skip = null;
        }
      }
      this.back = null;
    } else if (idx < this.pos) {
      if (this.back && this.back.idx === idx) this.back.n++;
      else this.back = { idx, n: 1 };
      if (this.back.n >= o.backUpdates) {
        this.pos = idx;
        this.back = null;
      }
      this.skip = null;
    } else {
      this.back = this.skip = null;
    }
    return { line: this.line, score: r.score, held: false, lost: false };
  }
}
