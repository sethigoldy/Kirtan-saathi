/**
 * Line tracker for one locked shabad.
 *
 * An online HMM over the shabad's singable lines. Transitions encode how
 * kirtan moves: mostly stay on the current line, sometimes advance, often
 * return to the rahao (refrain), rarely jump elsewhere. Emissions are
 * alignment scores of the most recent seconds of ASR output against each
 * line. The displayed line changes only with sustained evidence, so the
 * projector does not flicker.
 */
import type { Corpus } from './corpus';
import { LineRole } from './gurmukhi';
import type { Retriever } from './retrieval';

export interface TrackerOptions {
  stay: number;
  next: number;
  toRahao: number;
  previous: number;
  /** Probability mass for jumps to any other line, spread uniformly. */
  other: number;
  /** Emission sharpness: likelihood = exp(beta * score). */
  beta: number;
  /** Below this query self-score the audio is treated as non-verbal (hold). */
  minQuerySelf: number;
  /**
   * When no line explains at least this fraction of the recent audio, hold:
   * instrumental passages decode as consonant soup that matches every line
   * a little, and relative scores alone would move the display at random.
   */
  minEmission: number;
  /**
   * Posterior needed to show a line from a blank display. Below 60% the
   * display never changes: the line already shown stays.
   */
  showPosterior: number;
  /** Posterior (at least 60%) and margin needed to switch lines, held for `switchHops`. */
  switchPosterior: number;
  switchMargin: number;
  switchHops: number;
  /** Posterior that switches immediately. */
  instantPosterior: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  stay: 0.9,
  next: 0.05,
  toRahao: 0.025,
  previous: 0.01,
  other: 0.015,
  beta: 12,
  minQuerySelf: 3,
  minEmission: 0.6,
  showPosterior: 0.6,
  switchPosterior: 0.6,
  switchMargin: 0.25,
  switchHops: 2,
  instantPosterior: 0.85,
};

export interface TrackerUpdate {
  /** Global line index on display, or null. */
  line: number | null;
  posterior: number;
  /** Best emission score among the shabad's lines this hop (NaN if held). */
  bestEmission: number;
  held: boolean;
}

export class LineTracker {
  readonly opts: TrackerOptions;
  /** Global line indices of singable lines, in shabad order. */
  readonly lines: number[];
  private readonly rahaoStart: number[];
  private readonly trans: Float64Array; // n*n row-major, from -> to
  private belief: Float64Array;
  private displayed: number | null = null; // local index
  private pending: { idx: number; hops: number } | null = null;

  constructor(
    readonly corpus: Corpus,
    readonly retriever: Retriever,
    readonly shabad: number,
    startLine: number | null,
    opts: Partial<TrackerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_TRACKER_OPTIONS, ...opts };
    this.lines = corpus.linesOf(shabad).filter((l) => corpus.isSingable(l));
    const n = this.lines.length;
    this.rahaoStart = this.findRahaoStarts();
    this.trans = this.buildTransitions();
    this.belief = new Float64Array(n).fill(1 / Math.max(n, 1));
    const start = startLine === null ? -1 : this.lines.indexOf(startLine);
    if (start >= 0) {
      this.belief.fill(0.4 / Math.max(n - 1, 1));
      this.belief[start] = n === 1 ? 1 : 0.6;
      this.displayed = start;
    }
  }

  /** Local indices where a rahao group starts (refrain may span two lines). */
  private findRahaoStarts(): number[] {
    const starts: number[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      if (this.corpus.role[this.lines[i]] !== LineRole.Rahao) continue;
      // The line before "...ਰਹਾਉ ॥" belongs to the refrain when it does not
      // close a numbered stanza (e.g. "ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥").
      const prev = i - 1;
      const prevText = prev >= 0 ? this.corpus.plain[this.lines[prev]] : '';
      const prevClosesStanza = /॥\s*[੦-੯]+\s*॥/.test(prevText);
      const isPair = prev >= 0 && !prevClosesStanza && this.corpus.role[this.lines[prev]] === LineRole.Verse;
      starts.push(isPair ? prev : i);
    }
    return [...new Set(starts)];
  }

  private buildTransitions(): Float64Array {
    const n = this.lines.length;
    const t = new Float64Array(n * n);
    const o = this.opts;
    for (let from = 0; from < n; from++) {
      const row = from * n;
      const assigned = new Float64Array(n);
      assigned[from] += o.stay;
      if (from + 1 < n) assigned[from + 1] += o.next;
      else assigned[from] += o.next; // last line: wait (or loop to rahao below)
      const rahao = this.rahaoStart.filter((r) => r !== from);
      if (rahao.length) for (const r of rahao) assigned[r] += o.toRahao / rahao.length;
      else assigned[from] += o.toRahao;
      if (from - 1 >= 0) assigned[from - 1] += o.previous;
      else assigned[from] += o.previous;
      for (let to = 0; to < n; to++) assigned[to] += o.other / n;
      let sum = 0;
      for (let to = 0; to < n; to++) sum += assigned[to];
      for (let to = 0; to < n; to++) t[row + to] = assigned[to] / sum;
    }
    return t;
  }

  get displayedLine(): number | null {
    return this.displayed === null ? null : this.lines[this.displayed];
  }

  /** Move the display to a line chosen by the operator. */
  force(line: number): void {
    const idx = this.lines.indexOf(line);
    if (idx < 0) return;
    this.belief.fill(0.1 / Math.max(this.lines.length - 1, 1));
    this.belief[idx] = this.lines.length === 1 ? 1 : 0.9;
    this.displayed = idx;
    this.pending = null;
  }

  /** Feed the matching key of the most recent audio. */
  update(key: string): TrackerUpdate {
    const n = this.lines.length;
    const o = this.opts;
    if (n === 0) return { line: null, posterior: 0, bestEmission: NaN, held: true };
    const { hits, querySelf } = this.retriever.scoreShabadLines(key, this.shabad);
    if (querySelf < o.minQuerySelf) {
      return { line: this.displayedLine, posterior: this.displayed === null ? 0 : this.belief[this.displayed], bestEmission: NaN, held: true };
    }
    // hits are in shabad order over singable lines, same order as this.lines.
    let bestE = -Infinity;
    for (const h of hits) if (h.score > bestE) bestE = h.score;
    if (bestE < o.minEmission) {
      return { line: this.displayedLine, posterior: this.displayed === null ? 0 : this.belief[this.displayed], bestEmission: bestE, held: true };
    }

    // Predict.
    const prior = new Float64Array(n);
    for (let from = 0; from < n; from++) {
      const b = this.belief[from];
      if (b === 0) continue;
      const row = from * n;
      for (let to = 0; to < n; to++) prior[to] += b * this.trans[row + to];
    }
    // Correct.
    let sum = 0;
    const post = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      post[i] = prior[i] * Math.exp(o.beta * (hits[i].score - bestE));
      sum += post[i];
    }
    for (let i = 0; i < n; i++) post[i] /= sum;
    this.belief = post;

    let top = 0;
    for (let i = 1; i < n; i++) if (post[i] > post[top]) top = i;

    if (this.displayed === null) {
      if (post[top] >= o.showPosterior) this.displayed = top;
    } else if (top !== this.displayed) {
      const margin = post[top] - post[this.displayed];
      if (post[top] >= o.instantPosterior) {
        this.displayed = top;
        this.pending = null;
      } else if (post[top] >= o.switchPosterior && margin >= o.switchMargin) {
        if (this.pending && this.pending.idx === top) this.pending.hops++;
        else this.pending = { idx: top, hops: 1 };
        if (this.pending.hops >= o.switchHops) {
          this.displayed = top;
          this.pending = null;
        }
      } else {
        this.pending = null;
      }
    } else {
      this.pending = null;
    }
    return {
      line: this.displayedLine,
      posterior: this.displayed === null ? post[top] : post[this.displayed],
      bestEmission: bestE,
      held: false,
    };
  }
}
