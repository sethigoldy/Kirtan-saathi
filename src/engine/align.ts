/**
 * Local alignment (Smith-Waterman, linear gaps) over key codes with a
 * Gurmukhi-aware substitution table. Consonants carry most of the identity;
 * vowels are cheap to drop or confuse because singers stretch, clip, and
 * swap them, and word-final sihari/aunkar are often not voiced.
 */
import { ALPHABET_SIZE, CARRIER_CODES, KEY_ALPHABET, VOWEL_CODES, codeOf } from './gurmukhi';

const A = ALPHABET_SIZE;

export interface ScoreTable {
  sub: Float32Array; // A*A
  gap: Float32Array; // per code, cost (negative) of inserting/deleting it
  self: Float32Array; // per code, score of an exact match
}

const SIMILAR_CONSONANTS: [string, string][] = [
  // aspiration pairs
  ['k', 'K'], ['g', 'G'], ['c', 'C'], ['j', 'J'], ['t', 'T'], ['d', 'D'],
  ['q', 'Q'], ['x', 'X'], ['p', 'f'], ['b', 'B'],
  // retroflex vs dental
  ['t', 'q'], ['T', 'Q'], ['d', 'x'], ['D', 'X'],
  // voicing (common in sung Punjabi and in this model's output: ਬਉਰਾ -> ਪਉਰਾ)
  ['b', 'p'], ['k', 'g'], ['c', 'j'], ['t', 'd'], ['q', 'x'], ['K', 'G'],
  ['C', 'J'], ['T', 'D'], ['Q', 'X'], ['f', 'B'],
  // Punjabi tone: ਭ ਧ ਢ ਝ ਘ are spoken like ਪ ਤ ਟ ਚ ਕ with a tone (ਭੈ -> ਪੈ)
  ['B', 'p'], ['X', 'q'], ['D', 't'], ['J', 'c'], ['G', 'k'],
  // common Punjabi confusions
  ['b', 'v'], ['R', 'r'], ['R', 'd'], ['y', 'j'], ['n', 'm'],
];
const SIMILAR_VOWELS: [string, string][] = [
  ['e', 'E'], ['o', 'O'], ['A', 'a'], ['Y', 'i'], ['Y', 'e'], ['W', 'u'], ['W', 'o'],
  ['i', 'e'], ['u', 'o'],
];

export const SCORES = {
  consonantMatch: 1.0,
  vowelMatch: 0.5,
  similarConsonant: 0.4,
  similarVowel: 0.15,
  consonantMismatch: -0.55,
  vowelMismatch: -0.25,
  crossClassMismatch: -0.55,
  vowelGap: -0.25,
  consonantGap: -0.6,
};

function isVowelLike(code: number): boolean {
  return VOWEL_CODES.has(code) || CARRIER_CODES.has(code);
}

export function buildScoreTable(): ScoreTable {
  const sub = new Float32Array(A * A);
  const gap = new Float32Array(A);
  const self = new Float32Array(A);
  for (let a = 0; a < A; a++) {
    const va = isVowelLike(a);
    gap[a] = va ? SCORES.vowelGap : SCORES.consonantGap;
    self[a] = va ? SCORES.vowelMatch : SCORES.consonantMatch;
    for (let b = 0; b < A; b++) {
      const vb = isVowelLike(b);
      let s: number;
      if (a === b) s = va ? SCORES.vowelMatch : SCORES.consonantMatch;
      else if (va !== vb) s = SCORES.crossClassMismatch;
      else s = va ? SCORES.vowelMismatch : SCORES.consonantMismatch;
      sub[a * A + b] = s;
    }
  }
  for (const [x, y] of SIMILAR_CONSONANTS) {
    const a = codeOf(x), b = codeOf(y);
    sub[a * A + b] = sub[b * A + a] = SCORES.similarConsonant;
  }
  for (const [x, y] of SIMILAR_VOWELS) {
    const a = codeOf(x), b = codeOf(y);
    sub[a * A + b] = sub[b * A + a] = SCORES.similarVowel;
  }
  return { sub, gap, self };
}

export const DEFAULT_TABLE = buildScoreTable();

export function selfScore(codes: ArrayLike<number>, table: ScoreTable = DEFAULT_TABLE, from = 0, to = codes.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += table.self[codes[i]];
  return s;
}

export interface LocalAlignment {
  score: number;
  /** Aligned span in the query, [qStart, qEnd). */
  qStart: number;
  qEnd: number;
  /** Aligned span in the reference, [rStart, rEnd). */
  rStart: number;
  rEnd: number;
}

/** Reusable scratch buffers sized to the longest reference seen. */
export class Aligner {
  private h = new Float32Array(256);
  private hs = new Int32Array(256); // start (q index) of the path ending at each cell
  private hr = new Int32Array(256); // start (r index)
  private hPrev = new Float32Array(256);
  private hsPrev = new Int32Array(256);
  private hrPrev = new Int32Array(256);

  constructor(readonly table: ScoreTable = DEFAULT_TABLE) {}

  private ensure(n: number): void {
    if (this.h.length > n) return;
    const size = Math.max(n + 1, this.h.length * 2);
    this.h = new Float32Array(size);
    this.hs = new Int32Array(size);
    this.hr = new Int32Array(size);
    this.hPrev = new Float32Array(size);
    this.hsPrev = new Int32Array(size);
    this.hrPrev = new Int32Array(size);
  }

  /** Smith-Waterman over q (rows) x r (columns). */
  local(q: ArrayLike<number>, r: ArrayLike<number>, rFrom = 0, rTo = r.length): LocalAlignment {
    const n = rTo - rFrom;
    this.ensure(n);
    const { sub, gap } = this.table;
    let prev = this.hPrev, prevS = this.hsPrev, prevR = this.hrPrev;
    let cur = this.h, curS = this.hs, curR = this.hr;
    prev.fill(0, 0, n + 1);
    let best = 0, bqS = 0, bqE = 0, brS = 0, brE = 0;
    for (let i = 1; i <= q.length; i++) {
      const qa = q[i - 1];
      const row = qa * A;
      const gq = gap[qa];
      cur[0] = 0;
      curS[0] = i;
      curR[0] = 0;
      for (let j = 1; j <= n; j++) {
        const rb = r[rFrom + j - 1];
        let v = prev[j - 1] + sub[row + rb];
        let s = prevS[j - 1], rs = prevR[j - 1];
        if (prev[j - 1] <= 0) { s = i - 1; rs = j - 1; v = sub[row + rb]; }
        const up = prev[j] + gq; // query char unmatched
        if (up > v) { v = up; s = prevS[j]; rs = prevR[j]; }
        const left = cur[j - 1] + gap[rb]; // reference char unmatched
        if (left > v) { v = left; s = curS[j - 1]; rs = curR[j - 1]; }
        if (v <= 0) { v = 0; s = i; rs = j; }
        cur[j] = v; curS[j] = s; curR[j] = rs;
        if (v > best) { best = v; bqS = s; bqE = i; brS = rs; brE = j; }
      }
      const t = prev; prev = cur; cur = t;
      const ts = prevS; prevS = curS; curS = ts;
      const tr = prevR; prevR = curR; curR = tr;
    }
    return { score: best, qStart: bqS, qEnd: bqE, rStart: brS + rFrom, rEnd: brE + rFrom };
  }
}

/**
 * Repeat-tolerant local alignment.
 *
 * Like Smith-Waterman, but the path may also restart at a reference position
 * whose `restart[j]` cost is finite, coming from the best cell of the
 * previous query row. That lets one alignment explain a query in which the
 * singer repeats a phrase, returns to the refrain, or crosses into the next
 * line. Restarts are only allowed at word, phrase (vishraam) and line starts,
 * so a long reference cannot be stitched together from arbitrary fragments.
 */
export class RepeatAligner {
  private v = new Float32Array(256);
  private vPrev = new Float32Array(256);
  private qs = new Int32Array(256);
  private qsPrev = new Int32Array(256);
  private rs = new Int32Array(256);
  private rsPrev = new Int32Array(256);

  constructor(readonly table: ScoreTable = DEFAULT_TABLE) {}

  private ensure(n: number): void {
    if (this.v.length > n) return;
    const size = Math.max(n + 1, this.v.length * 2);
    this.v = new Float32Array(size);
    this.vPrev = new Float32Array(size);
    this.qs = new Int32Array(size);
    this.qsPrev = new Int32Array(size);
    this.rs = new Int32Array(size);
    this.rsPrev = new Int32Array(size);
  }

  /**
   * @param restart cost (positive) of restarting at reference position j,
   *   or Infinity where restarts are not allowed.
   * Returns the best score, the query span, and the reference span of the
   * final segment (`rStart`..`rEnd`; `rEnd` is where the path ends).
   */
  align(
    q: ArrayLike<number>,
    r: ArrayLike<number>,
    restart: ArrayLike<number>,
    rFrom = 0,
    rTo = r.length,
    /** If given, endBest[j] receives the best score of a path ending at reference
     *  position j within the last `endRows` query positions (the most recent audio). */
    endBest?: Float32Array,
    endRows = 6,
  ): LocalAlignment {
    const n = rTo - rFrom;
    this.ensure(n);
    if (endBest) endBest.fill(0, 0, n);
    const recordFrom = q.length - endRows;
    const { sub, gap } = this.table;
    let prev = this.vPrev, prevQ = this.qsPrev, prevR = this.rsPrev;
    let cur = this.v, curQ = this.qs, curR = this.rs;
    prev.fill(0, 0, n + 1);
    let best = 0, bqS = 0, bqE = 0, brS = 0, brE = 0;
    let rowBestPrev = 0, rowBestPrevQ = 0;
    for (let i = 1; i <= q.length; i++) {
      const qa = q[i - 1];
      const row = qa * A;
      const gq = gap[qa];
      cur[0] = 0; curQ[0] = i; curR[0] = 0;
      let rowBest = 0, rowBestQ = i;
      for (let j = 1; j <= n; j++) {
        const rb = r[rFrom + j - 1];
        const s = sub[row + rb];
        // Diagonal (or fresh local start).
        let v: number, vq: number, vr: number;
        if (prev[j - 1] > 0) { v = prev[j - 1] + s; vq = prevQ[j - 1]; vr = prevR[j - 1]; }
        else { v = s; vq = i - 1; vr = j - 1; }
        // Restart from the best cell of the previous row.
        const rc = restart[rFrom + j - 1];
        if (rc !== Infinity && rowBestPrev > 0) {
          const w = rowBestPrev - rc + s;
          if (w > v) { v = w; vq = rowBestPrevQ; vr = j - 1; }
        }
        const up = prev[j] + gq;
        if (up > v) { v = up; vq = prevQ[j]; vr = prevR[j]; }
        const left = cur[j - 1] + gap[rb];
        if (left > v) { v = left; vq = curQ[j - 1]; vr = curR[j - 1]; }
        if (v <= 0) { v = 0; vq = i; vr = j; }
        cur[j] = v; curQ[j] = vq; curR[j] = vr;
        if (v > rowBest) { rowBest = v; rowBestQ = vq; }
        if (v > best) { best = v; bqS = vq; bqE = i; brS = vr; brE = j; }
        if (endBest && i > recordFrom && v > endBest[j - 1]) endBest[j - 1] = v;
      }
      rowBestPrev = rowBest;
      rowBestPrevQ = rowBestQ;
      let t = prev; prev = cur; cur = t;
      let ti = prevQ; prevQ = curQ; curQ = ti;
      ti = prevR; prevR = curR; curR = ti;
      void t;
    }
    return { score: best, qStart: bqS, qEnd: bqE, rStart: brS + rFrom, rEnd: brE + rFrom };
  }
}

/** Debug helper: decode codes back to the key alphabet. */
export function codesToKey(codes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < codes.length; i++) s += KEY_ALPHABET[codes[i]];
  return s;
}
