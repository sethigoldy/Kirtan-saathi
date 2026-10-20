/**
 * Whole-corpus retrieval for noisy ASR keys.
 *
 * 1. Candidate lines: IDF-weighted character-trigram overlap over every
 *    singable line (headings and short invocations excluded).
 * 2. Candidate shabads: the shabads owning the best candidate lines.
 * 3. Verification: repeat-tolerant local alignment of the query against the
 *    shabad's text (or, for very long compositions, the lines around the
 *    candidates). Restarts are allowed at line, vishraam and word starts, so
 *    repeated phrases and returns to the rahao are explained naturally.
 * 4. Score = aligned score / query self-score: the fraction of what was heard
 *    that this shabad explains.
 *
 * First-letter search (what sevadars type) is deliberately not used: one
 * wrong character destroys a word's first-letter key, while trigrams and
 * alignment degrade gracefully.
 */
import { RepeatAligner, selfScore, DEFAULT_TABLE, type ScoreTable } from './align';
import type { Corpus } from './corpus';
import { ALPHABET_SIZE, Boundary, SKELETON_SIZE, encodeKey, skeleton } from './gurmukhi';
import { NgramIndex } from './ngram-index';


export interface LineHit {
  /** Line where the alignment ends (the most recent line heard). */
  line: number;
  shabad: number;
  /** Fraction of the query explained, roughly [0, 1]. */
  score: number;
  /** Raw alignment score. */
  sw: number;
  qStart: number;
  qEnd: number;
}

export interface SearchResult {
  /** One hit per candidate shabad, sorted by score descending. */
  shabads: LineHit[];
  querySelf: number;
}

export interface RetrieverOptions {
  /** Lines taken from the trigram stage. */
  candidateLines: number;
  /** Shabads verified by alignment. */
  candidateShabads: number;
  /** Grams in more than this fraction of lines are ignored. */
  maxDfFraction: number;
  /** n for the consonant-skeleton n-gram index. */
  skeletonN: number;
  charWeight: number;
  skeletonWeight: number;
  /** Query self-score floor: short queries cannot score 1.0 by chance. */
  queryFloor: number;
  /** Floor used when scoring the short tail window inside a known shabad. */
  tailFloor: number;
  /** Restart costs, in units of one consonant match. */
  restartLine: number;
  restartPhrase: number;
  restartWord: number;
  /** Shabads longer than this are verified on a neighbourhood of lines. */
  maxRefLines: number;
  refNeighbourhood: number;
}

export const DEFAULT_RETRIEVER_OPTIONS: RetrieverOptions = {
  candidateLines: 300,
  candidateShabads: 80,
  maxDfFraction: 0.04,
  skeletonN: 4,
  charWeight: 1,
  skeletonWeight: 1,
  queryFloor: 10,
  tailFloor: 4,
  restartLine: 0.8,
  restartPhrase: 0.8,
  restartWord: 2.0,
  maxRefLines: 48,
  refNeighbourhood: 8,
};

interface Ref {
  codes: Uint8Array;
  restart: Float32Array;
  lineAt: Int32Array;
}

export class Retriever {
  readonly opts: RetrieverOptions;
  readonly codes: Uint8Array[];
  readonly lineSelf: Float32Array;
  private readonly charIndex: NgramIndex;
  private readonly skelIndex: NgramIndex;
  private readonly aligner: RepeatAligner;
  private readonly refCache = new Map<number, Ref>();
  private readonly lineRestart: (Float32Array | undefined)[];

  constructor(readonly corpus: Corpus, opts: Partial<RetrieverOptions> = {}, table: ScoreTable = DEFAULT_TABLE) {
    this.opts = { ...DEFAULT_RETRIEVER_OPTIONS, ...opts };
    this.aligner = new RepeatAligner(table);
    const n = corpus.lineCount;
    this.codes = new Array(n);
    this.lineSelf = new Float32Array(n);
    this.lineRestart = new Array(n);
    const skel: Uint8Array[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const c = encodeKey(corpus.key[i]);
      this.codes[i] = c;
      skel[i] = skeleton(c);
      this.lineSelf[i] = selfScore(c, table);
    }
    const include = (i: number) => corpus.isSingable(i);
    this.charIndex = new NgramIndex(this.codes, ALPHABET_SIZE, 3, include, this.opts.maxDfFraction);
    this.skelIndex = new NgramIndex(skel, SKELETON_SIZE, this.opts.skeletonN, include, this.opts.maxDfFraction);
  }

  private restartCost(flag: number): number {
    const o = this.opts;
    if (flag === Boundary.LineStart) return o.restartLine;
    if (flag === Boundary.Phrase) return o.restartPhrase;
    if (flag === Boundary.Word) return o.restartWord;
    return Infinity;
  }

  private restartOf(line: number): Float32Array {
    let r = this.lineRestart[line];
    if (!r) {
      const f = this.corpus.keyFlags[line];
      r = new Float32Array(f.length);
      for (let j = 0; j < f.length; j++) r[j] = this.restartCost(f[j]);
      this.lineRestart[line] = r;
    }
    return r;
  }

  private buildRef(lines: number[]): Ref {
    let len = 0;
    for (const l of lines) len += this.codes[l].length;
    const codes = new Uint8Array(len);
    const restart = new Float32Array(len);
    const lineAt = new Int32Array(len);
    let p = 0;
    for (const l of lines) {
      const c = this.codes[l];
      codes.set(c, p);
      restart.set(this.restartOf(l), p);
      lineAt.fill(l, p, p + c.length);
      p += c.length;
    }
    return { codes, restart, lineAt };
  }

  private shabadRef(shabad: number): Ref {
    let ref = this.refCache.get(shabad);
    if (!ref) {
      ref = this.buildRef(this.corpus.linesOf(shabad).filter((l) => this.corpus.isSingable(l)));
      if (this.refCache.size > 4000) this.refCache.clear();
      this.refCache.set(shabad, ref);
    }
    return ref;
  }

  /** Candidate lines by n-gram overlap (characters + consonant skeleton), best first. */
  candidateLines(q: Uint8Array, limit: number): { line: number; s: number }[] {
    const scores = new Map<number, number>();
    if (this.opts.charWeight > 0) this.charIndex.score(q, scores, this.opts.charWeight);
    if (this.opts.skeletonWeight > 0) this.skelIndex.score(skeleton(q), scores, this.opts.skeletonWeight);
    const scored: { line: number; s: number }[] = [];
    for (const [line, v] of scores) scored.push({ line, s: v });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit);
  }

  private hit(q: Uint8Array, querySelf: number, shabad: number, ref: Ref, floor: number): LineHit {
    const al = this.aligner.align(q, ref.codes, ref.restart);
    const endPos = Math.max(0, Math.min(ref.lineAt.length - 1, al.rEnd - 1));
    return {
      line: ref.lineAt.length ? ref.lineAt[endPos] : this.corpus.shabads[shabad].start,
      shabad,
      sw: al.score,
      score: al.score / Math.max(querySelf, floor),
      qStart: al.qStart,
      qEnd: al.qEnd,
    };
  }

  /** Search the whole corpus. */
  search(key: string): SearchResult {
    const o = this.opts;
    const q = encodeKey(key);
    const querySelf = selfScore(q);
    if (q.length < 6) return { shabads: [], querySelf };
    const cand = this.candidateLines(q, o.candidateLines);
    const byShabad = new Map<number, number[]>();
    for (const c of cand) {
      const s = this.corpus.shabadOf[c.line];
      const list = byShabad.get(s);
      if (list) list.push(c.line);
      else if (byShabad.size < o.candidateShabads) byShabad.set(s, [c.line]);
    }
    const hits: LineHit[] = [];
    for (const [shabad, lines] of byShabad) {
      const info = this.corpus.shabads[shabad];
      let ref: Ref;
      if (info.count <= o.maxRefLines) {
        ref = this.shabadRef(shabad);
      } else {
        const keep = new Set<number>();
        for (const l of lines.slice(0, 4)) {
          for (let k = l - o.refNeighbourhood; k <= l + o.refNeighbourhood; k++) {
            if (k >= info.start && k < info.start + info.count && this.corpus.isSingable(k)) keep.add(k);
          }
        }
        ref = this.buildRef([...keep].sort((a, b) => a - b));
      }
      hits.push(this.hit(q, querySelf, shabad, ref, o.queryFloor));
    }
    hits.sort((a, b) => b.score - a.score || b.sw - a.sw);
    return { shabads: hits, querySelf };
  }

  /** Score every singable line of one shabad on its own (used while tracking). */
  scoreShabadLines(key: string, shabad: number, floor = this.opts.tailFloor): { hits: LineHit[]; querySelf: number } {
    const q = encodeKey(key);
    const querySelf = selfScore(q);
    const s = this.corpus.shabads[shabad];
    const hits: LineHit[] = [];
    for (let line = s.start; line < s.start + s.count; line++) {
      if (!this.corpus.isSingable(line)) continue;
      const al = this.aligner.align(q, this.codes[line], this.restartOf(line));
      hits.push({
        line,
        shabad,
        sw: al.score,
        score: al.score / Math.max(querySelf, floor),
        qStart: al.qStart,
        qEnd: al.qEnd,
      });
    }
    return { hits, querySelf };
  }

  /** Score a query against one shabad as a whole. */
  scoreShabad(key: string, shabad: number): LineHit & { querySelf: number } {
    const q = encodeKey(key);
    const querySelf = selfScore(q);
    return { ...this.hit(q, querySelf, shabad, this.shabadRef(shabad), this.opts.queryFloor), querySelf };
  }
}
