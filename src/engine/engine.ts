/**
 * Live engine: audio in, (shabad, line) out.
 *
 *   searching: decode a long window, search the whole corpus, accumulate
 *              per-shabad evidence over time, lock when one shabad is
 *              clearly ahead (or a single window is decisive).
 *   locked:    decode a short window often, track the line inside the
 *              locked shabad, and periodically re-run the global search so a
 *              new shabad can take over. Sustained mismatch unlocks.
 *
 * The engine only ever emits canonical corpus lines, never ASR text.
 */
import type { AsrResult } from './asr';
import { SAMPLE_RATE } from './asr';
import type { Corpus } from './corpus';
import type { LineHit, Retriever } from './retrieval';
import { LineTracker, type TrackerOptions } from './tracker';
import { PaathFollower, baniStream, sourceStream, type LineStream, type PaathOptions } from './paath';

export interface Transcriber {
  /** `startSample` is the window's first sample in stream time. */
  transcribe(samples: Float32Array, startSample: number): Promise<AsrResult>;
}

export type EngineState = 'listening' | 'searching' | 'locked';

import type { EngineMode } from './mode';
export type { EngineMode };

export interface Candidate {
  shabad: number;
  line: number;
  score: number;
  evidence: number;
}

export interface EngineEvent {
  /** Stream time (s) at the end of the decoded window. */
  t: number;
  state: EngineState;
  shabad: number | null;
  /** Global line index on display, or null. */
  line: number | null;
  lineInShabad: number | null;
  confidence: number;
  candidates: Candidate[];
  reason: string;
  mode: EngineMode['kind'];
  /** Name of the stream being followed in paath / bani mode. */
  stream: string | null;
  asrText: string;
  windowSec: number;
  inferMs: number;
}

export interface EngineOptions {
  searchWindowSec: number;
  searchHopSec: number;
  minSearchAudioSec: number;
  followWindowSec: number;
  followHopSec: number;
  /** Tracker emission uses ASR units from the last `tailSec` of the window. */
  tailSec: number;
  /** While locked, run the global search this often... */
  globalCheckSec: number;
  /** ...on a window this long (the tracker still uses only the recent tail). */
  globalWindowSec: number;
  // Identification.
  evidenceHalfLifeSec: number;
  windowBaseline: number;
  alignedCharsForFullWeight: number;
  topShabadsPerWindow: number;
  distinctLineScore: number;
  distinctLineBonus: number;
  distinctLineWindowSec: number;
  supportWindowSec: number;
  minSupport: number;
  lockEvidence: number;
  lockMargin: number;
  instantLockScore: number;
  instantLockMargin: number;
  instantLockMinChars: number;
  switchStickiness: number;
  /**
   * Weight of evidence from additional distinct lines (beyond the best one),
   * each line keeping its best recent contribution with `lineHalfLifeSec`.
   * Rewards a shabad heard progressing through its lines over one that only
   * shares a repeated phrase.
   */
  lineDiversityWeight: number;
  lineHalfLifeSec: number;
  /**
   * Paired switch: while locked, compare each challenger with the locked
   * shabad on the same windows. Switch when, over `pairedWindowSec`, a
   * challenger has at least `pairedMinSamples` comparisons, explains the
   * audio better by `pairedMargin` on average, and wins `pairedWinFraction`
   * of them. The window stretches with `paceScale` (comparisons come with
   * the global checks, which the pacer spaces out), so the samples still fit.
   */
  pairedWindowSec: number;
  pairedMinSamples: number;
  pairedMargin: number;
  pairedWinFraction: number;
  /** A comparison only counts when the challenger explains at least this much. */
  pairedMinScore: number;
  /**
   * Windows whose best match anywhere is below this look like instrumental
   * passages or unclear audio (tabla bols decode as consonant soup); they do
   * not count towards losing the lock.
   */
  lyricScore: number;
  // Losing the shabad: at least `lostMinHops` updates within `lostWindowSec`
  // (stretched with `paceScale`, like the hops) averaging below `lostScore`.
  lostWindowSec: number;
  lostMinHops: number;
  lostScore: number;
  /** Windows with less speech than this (query self-score) do not count. */
  lostMinSelf: number;
  /**
   * Stale lock: when, over the last `staleSec`, the locked shabad explained
   * less than `lostScore` of the voiced audio on average, search again, as
   * Search again would. Unlike the lost check, this counts windows the global
   * search cannot place either (a new shabad sung less clearly), so it looks
   * over a longer stretch than an instrumental break. Not stretched with
   * `paceScale`: breaks last as long on any computer, and even at 4× the
   * window holds more than `lostMinHops` updates. 0: off.
   */
  staleSec: number;
  /** Multiplies hop lengths; raised by the pacer on slow machines. */
  paceScale: number;
  tracker: Partial<TrackerOptions>;
  // Paath and bani modes.
  paathWindowSec: number;
  paathHopSec: number;
  baniSearchWindowSec: number;
  /** Fraction of a window a bani position must explain to start following. */
  baniLockScore: number;
  paath: Partial<PaathOptions>;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  searchWindowSec: 10,
  searchHopSec: 1,
  minSearchAudioSec: 3,
  followWindowSec: 5,
  followHopSec: 0.5,
  tailSec: 3,
  globalCheckSec: 2,
  globalWindowSec: 10,
  evidenceHalfLifeSec: 20,
  windowBaseline: 0.58,
  alignedCharsForFullWeight: 20,
  topShabadsPerWindow: 30,
  distinctLineScore: 0.6,
  distinctLineBonus: 0.15,
  distinctLineWindowSec: 60,
  supportWindowSec: 45,
  minSupport: 3,
  lockEvidence: 0.7,
  lockMargin: 0.3,
  instantLockScore: 0.88,
  instantLockMargin: 0.2,
  instantLockMinChars: 24,
  switchStickiness: 0.3,
  lineDiversityWeight: 0,
  lineHalfLifeSec: 60,
  pairedWindowSec: 12,
  pairedMinSamples: 4,
  pairedMargin: 0.12,
  pairedWinFraction: 0.75,
  pairedMinScore: 0.65,
  lyricScore: 0.6,
  lostWindowSec: 15,
  lostMinHops: 16,
  lostScore: 0.35,
  lostMinSelf: 8,
  staleSec: 45,
  paceScale: 1,
  tracker: {},
  paathWindowSec: 4,
  paathHopSec: 0.5,
  baniSearchWindowSec: 8,
  baniLockScore: 0.6,
  paath: {},
};

interface Evidence {
  e: number;
  t: number;
  support: number[];
  lines: Map<number, number>;
  bestLine: number;
  bestLineScore: number;
  lineEv: Map<number, { v: number; t: number }>;
}

export class Engine {
  readonly opts: EngineOptions;
  private readonly capacity: number;
  private readonly ring: Float32Array;
  private total = 0;
  private sinceReset = 0;
  private nextAt: number;
  private state: EngineState = 'listening';
  private evidence = new Map<number, Evidence>();
  private tracker: LineTracker | null = null;
  private lastGlobal = -Infinity;
  private recentEmission: { t: number; e: number }[] = [];
  /** Locked shabad's emission on every voiced window, for the stale-lock check. */
  private voicedEmission: { t: number; e: number }[] = [];
  /** When the current shabad was locked (or the stale-lock window last restarted). */
  private lockedAt = 0;
  private paired = new Map<number, { t: number; d: number; line: number }[]>();
  private lastGlobalTop = 1;
  private manual = false;
  private mode: EngineMode = { kind: 'kirtan' };
  private follower: PaathFollower | null = null;

  constructor(
    readonly corpus: Corpus,
    readonly retriever: Retriever,
    readonly asr: Transcriber,
    opts: Partial<EngineOptions> = {},
  ) {
    this.opts = {
      ...DEFAULT_ENGINE_OPTIONS,
      ...opts,
      tracker: { ...DEFAULT_ENGINE_OPTIONS.tracker, ...opts.tracker },
      paath: { ...DEFAULT_ENGINE_OPTIONS.paath, ...opts.paath },
    };
    this.capacity = Math.ceil(Math.max(this.opts.searchWindowSec, this.opts.followWindowSec) * SAMPLE_RATE) + SAMPLE_RATE * 4;
    this.ring = new Float32Array(this.capacity);
    this.nextAt = Math.round(this.opts.minSearchAudioSec * SAMPLE_RATE);
  }

  /** Stream time in seconds. */
  get now(): number {
    return this.total / SAMPLE_RATE;
  }

  get currentState(): EngineState {
    return this.state;
  }

  get lockedShabad(): number | null {
    return this.currentShabad();
  }

  get currentMode(): EngineMode {
    return this.mode;
  }

  /** Switch mode; clears any lock and starts searching again. */
  setMode(mode: EngineMode): void {
    if (mode.kind === 'bani') baniStream(this.corpus, mode.id); // validates the id
    this.mode = mode;
    this.reset();
  }

  private currentLine(): number | null {
    if (this.follower) return this.follower.line;
    return this.tracker?.displayedLine ?? null;
  }

  /** Next line in reading order while following paath / bani (else null). */
  nextLine(): number | null {
    if (!this.follower) return null;
    const i = this.follower.index + 1;
    return i < this.follower.stream.lines.length ? this.follower.stream.lines[i] : null;
  }

  private currentShabad(): number | null {
    if (this.follower) return this.corpus.shabadOf[this.follower.line];
    return this.tracker?.shabad ?? null;
  }

  /** Stream to follow in paath / bani mode, positioned at `line`. */
  private streamFor(line: number): { stream: LineStream; index: number } {
    if (this.mode.kind === 'bani') {
      const stream = baniStream(this.corpus, this.mode.id);
      const index = stream.lines.indexOf(line);
      if (index >= 0) return { stream, index };
    }
    const stream = sourceStream(this.corpus, line);
    return { stream, index: line - stream.lines[0] };
  }

  private startFollower(stream: LineStream, index: number, asr?: AsrResult): void {
    this.tracker = null;
    this.follower = new PaathFollower(this.corpus, this.retriever, stream, index, this.opts.paath);
    if (asr) this.follower.update(this.keySince(asr, this.opts.paathWindowSec));
    this.state = 'locked';
    this.recentEmission = [];
    this.voicedEmission = [];
    this.lockedAt = this.now;
    this.paired.clear();
  }

  pushAudio(chunk: Float32Array): void {
    let off = 0;
    while (off < chunk.length) {
      const pos = this.total % this.capacity;
      const n = Math.min(chunk.length - off, this.capacity - pos);
      this.ring.set(chunk.subarray(off, off + n), pos);
      off += n;
      this.total += n;
      this.sinceReset += n;
    }
  }

  /** True when enough new audio has arrived for the next decode. */
  due(): boolean {
    return this.total >= this.nextAt;
  }

  /** Samples until the next decode is due (for schedulers). */
  samplesUntilDue(): number {
    return Math.max(0, this.nextAt - this.total);
  }

  private window(sec: number): { samples: Float32Array; start: number } {
    const n = Math.min(Math.round(sec * SAMPLE_RATE), this.total, this.sinceReset, this.capacity);
    const out = new Float32Array(n);
    const start = this.total - n;
    for (let k = 0; k < n; ) {
      const pos = (start + k) % this.capacity;
      const m = Math.min(n - k, this.capacity - pos);
      out.set(this.ring.subarray(pos, pos + m), k);
      k += m;
    }
    return { samples: out, start };
  }

  /** Operator: lock to a shabad (optionally a line). */
  lock(shabad: number, line: number | null = null): void {
    this.manual = true;
    if (this.mode.kind !== 'kirtan') {
      const start = line ?? this.corpus.shabads[shabad].start;
      const { stream, index } = this.streamFor(start);
      this.startFollower(stream, index);
      return;
    }
    this.follower = null;
    this.tracker = new LineTracker(this.corpus, this.retriever, shabad, line, this.opts.tracker);
    if (line !== null) this.tracker.force(line);
    this.state = 'locked';
    this.recentEmission = [];
    this.voicedEmission = [];
    this.lockedAt = this.now;
  }

  /** Operator: move the display to a line in the locked shabad. */
  setLine(line: number): void {
    if (this.follower) this.follower.force(line);
    else this.tracker?.force(line);
  }

  /**
   * Operator / remote: move the display `offset` lines. Paath and bani move
   * through the reading stream (across shabads); kirtan moves through the
   * locked shabad's singable lines. Returns the new line, or null.
   */
  stepLine(offset: number): number | null {
    let lines: ArrayLike<number> & { indexOf(x: number): number };
    let i: number;
    if (this.follower) {
      lines = this.follower.stream.lines;
      i = this.follower.index;
    } else if (this.tracker) {
      lines = this.tracker.lines;
      const shown = this.tracker.displayedLine;
      i = shown === null ? (offset > 0 ? -1 : lines.length) : lines.indexOf(shown);
    } else {
      return null;
    }
    const j = Math.min(lines.length - 1, Math.max(0, i + offset));
    if (j === i || lines.length === 0) return null;
    this.setLine(lines[j]);
    return lines[j];
  }

  /** What should be on screen right now. */
  display(): { shabad: number | null; line: number | null; next: number | null; stream: string | null } {
    return {
      shabad: this.currentShabad(),
      line: this.currentLine(),
      next: this.nextLine(),
      stream: this.follower?.stream.name ?? null,
    };
  }

  /** Operator or auto: clear lock and evidence, start searching again. */
  reset(): void {
    this.tracker = null;
    this.follower = null;
    this.manual = false;
    this.evidence.clear();
    this.recentEmission = [];
    this.voicedEmission = [];
    this.lockedAt = this.now;
    this.paired.clear();
    this.state = this.total > 0 ? 'searching' : 'listening';
    this.sinceReset = 0;
    this.nextAt = this.total + Math.round(this.opts.minSearchAudioSec * SAMPLE_RATE);
  }

  private decay(ev: Evidence, t: number): void {
    if (t > ev.t) {
      ev.e *= Math.pow(0.5, (t - ev.t) / this.opts.evidenceHalfLifeSec);
      ev.t = t;
    }
  }

  private lockScore(ev: Evidence, t: number): number {
    const o = this.opts;
    let distinct = 0;
    for (const [line, lt] of ev.lines) {
      if (t - lt <= o.distinctLineWindowSec) distinct++;
      else ev.lines.delete(line);
    }
    let sum = 0, max = 0;
    if (o.lineDiversityWeight > 0) {
      for (const [line, le] of ev.lineEv) {
        const v = le.v * Math.pow(0.5, (t - le.t) / o.lineHalfLifeSec);
        if (v < 0.005) { ev.lineEv.delete(line); continue; }
        sum += v;
        if (v > max) max = v;
      }
    }
    return ev.e + o.distinctLineBonus * Math.max(0, Math.min(distinct, 3) - 1) + o.lineDiversityWeight * (sum - max);
  }

  private addEvidence(shabads: LineHit[], t: number): void {
    const o = this.opts;
    for (const ev of this.evidence.values()) this.decay(ev, t);
    for (const h of shabads.slice(0, o.topShabadsPerWindow)) {
      const aligned = h.qEnd - h.qStart;
      const weight = Math.min(1, aligned / o.alignedCharsForFullWeight);
      const c = Math.max(0, h.score - o.windowBaseline) * weight;
      let ev = this.evidence.get(h.shabad);
      if (!ev) {
        if (c <= 0) continue;
        ev = { e: 0, t, support: [], lines: new Map(), bestLine: h.line, bestLineScore: 0, lineEv: new Map() };
        this.evidence.set(h.shabad, ev);
      }
      ev.e += c;
      if (c > 0) {
        ev.support.push(t);
        const le = ev.lineEv.get(h.line);
        const prev = le ? le.v * Math.pow(0.5, (t - le.t) / o.lineHalfLifeSec) : 0;
        ev.lineEv.set(h.line, { v: Math.max(prev, c), t });
      }
      if (h.score >= o.distinctLineScore) ev.lines.set(h.line, t);
      ev.bestLine = h.line;
      ev.bestLineScore = h.score;
    }
    for (const [s, ev] of this.evidence) {
      ev.support = ev.support.filter((x) => t - x <= o.supportWindowSec);
      if (ev.e < 0.01 && ev.support.length === 0) this.evidence.delete(s);
    }
  }

  private ranked(t: number): { shabad: number; score: number; ev: Evidence }[] {
    const out: { shabad: number; score: number; ev: Evidence }[] = [];
    for (const [shabad, ev] of this.evidence) out.push({ shabad, score: this.lockScore(ev, t), ev });
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  private candidates(t: number): Candidate[] {
    return this.ranked(t)
      .slice(0, 3)
      .map((r) => ({ shabad: r.shabad, line: r.ev.bestLine, score: r.ev.bestLineScore, evidence: r.score }));
  }

  /** Line that best explains the most recent seconds of a window. */
  private recentLine(asr: AsrResult, shabad: number): number | null {
    const { hits, querySelf } = this.retriever.scoreShabadLines(this.keySince(asr, this.opts.tailSec + 1), shabad);
    if (querySelf < 3 || !hits.length) return null;
    let best = hits[0];
    for (const h of hits) if (h.score > best.score) best = h;
    return best.line;
  }

  private startTracking(shabad: number, line: number | null, asr?: AsrResult): void {
    if (this.mode.kind !== 'kirtan' && line !== null) {
      const { stream, index } = this.streamFor(line);
      this.startFollower(stream, index, asr);
      return;
    }
    this.follower = null;
    const recent = asr ? this.recentLine(asr, shabad) : null;
    this.tracker = new LineTracker(this.corpus, this.retriever, shabad, recent ?? line, this.opts.tracker);
    this.state = 'locked';
    this.recentEmission = [];
    this.voicedEmission = [];
    this.lockedAt = this.now;
    this.paired.clear();
    this.lastGlobalTop = 1;
  }

  /** Best challenger by paired comparison against the locked shabad, if decisive. */
  private pairedChallenger(t: number): { shabad: number; line: number; mean: number } | null {
    const o = this.opts;
    let best: { shabad: number; line: number; mean: number } | null = null;
    const windowSec = o.pairedWindowSec * o.paceScale;
    for (const [shabad, samples] of this.paired) {
      const recent = samples.filter((x) => t - x.t <= windowSec);
      if (recent.length === 0) { this.paired.delete(shabad); continue; }
      this.paired.set(shabad, recent);
      if (recent.length < o.pairedMinSamples) continue;
      const mean = recent.reduce((a, x) => a + x.d, 0) / recent.length;
      const wins = recent.filter((x) => x.d > 0).length / recent.length;
      if (mean >= o.pairedMargin && wins >= o.pairedWinFraction && (!best || mean > best.mean)) {
        best = { shabad, line: recent[recent.length - 1].line, mean };
      }
    }
    return best;
  }

  /** Matching key of the last `sec` seconds of a decoded window. */
  private keySince(asr: AsrResult, sec: number): string {
    const from = asr.windowSec - sec;
    let k = 0;
    while (k < asr.key.length && asr.keyTimes[k] < from) k++;
    return asr.key.slice(k);
  }

  private event(asr: AsrResult, t: number, reason: string, confidence: number): EngineEvent {
    const line = this.currentLine();
    return {
      t,
      state: this.state,
      shabad: this.currentShabad(),
      line,
      lineInShabad: line === null ? null : this.corpus.lineInShabad[line],
      confidence,
      candidates: this.candidates(t),
      reason,
      mode: this.mode.kind,
      stream: this.follower?.stream.name ?? null,
      asrText: asr.text,
      windowSec: asr.windowSec,
      inferMs: asr.inferMs,
    };
  }

  /** Run one decode if due. Returns null when nothing was due. */
  async step(): Promise<EngineEvent | null> {
    if (!this.due()) return null;
    const o = this.opts;
    if (this.state === 'listening') this.state = 'searching';
    const t = this.now;

    if (this.state === 'searching' && this.mode.kind === 'bani') {
      // Bani mode: locate the position directly within the bani.
      const stream = baniStream(this.corpus, this.mode.id);
      const { samples, start } = this.window(o.baniSearchWindowSec);
      const asr = await this.asr.transcribe(samples, start);
      this.nextAt = this.total + Math.round(o.searchHopSec * o.paceScale * SAMPLE_RATE);
      const loc = PaathFollower.locate(this.retriever, stream, asr.key);
      if (loc.index >= 0 && loc.score >= o.baniLockScore) {
        this.startFollower(stream, loc.index, asr);
        return this.event(asr, t, 'lock-bani', loc.score);
      }
      return this.event(asr, t, 'search', loc.score);
    }

    if (this.state === 'searching') {
      const { samples, start } = this.window(o.searchWindowSec);
      const asr = await this.asr.transcribe(samples, start);
      this.nextAt = this.total + Math.round(o.searchHopSec * o.paceScale * SAMPLE_RATE);
      const res = this.retriever.search(asr.key);
      this.addEvidence(res.shabads, t);

      // Decisive single window (clear paath, or a long clean kirtan line).
      const top = res.shabads[0];
      const second = res.shabads[1];
      if (
        top &&
        top.score >= o.instantLockScore &&
        top.qEnd - top.qStart >= o.instantLockMinChars &&
        (!second || top.score - second.score >= o.instantLockMargin)
      ) {
        this.startTracking(top.shabad, top.line, asr);
        return this.event(asr, t, 'lock-instant', top.score);
      }

      const ranked = this.ranked(t);
      const best = ranked[0];
      const runner = ranked[1];
      if (
        best &&
        best.score >= o.lockEvidence &&
        best.score - (runner?.score ?? 0) >= o.lockMargin &&
        best.ev.support.length >= o.minSupport
      ) {
        const line = res.shabads.find((h) => h.shabad === best.shabad)?.line ?? best.ev.bestLine;
        this.startTracking(best.shabad, line, asr);
        return this.event(asr, t, 'lock', best.score);
      }
      return this.event(asr, t, 'search', best?.score ?? 0);
    }

    if (this.follower) {
      const follower = this.follower;
      const { samples, start } = this.window(o.paathWindowSec);
      const asr = await this.asr.transcribe(samples, start);
      this.nextAt = this.total + Math.round(o.paathHopSec * o.paceScale * SAMPLE_RATE);
      const upd = follower.update(asr.key);
      if (upd.lost && !this.manual) {
        this.follower = null;
        this.state = 'searching';
        this.evidence.clear();
        return this.event(asr, t, 'unlock', upd.score);
      }
      return this.event(asr, t, upd.held ? 'hold' : 'follow', upd.score);
    }

    // Locked (kirtan).
    const tracker = this.tracker!;
    const global = t - this.lastGlobal >= o.globalCheckSec * o.paceScale;
    const { samples, start } = this.window(global ? Math.max(o.globalWindowSec, o.followWindowSec) : o.followWindowSec);
    const asr = await this.asr.transcribe(samples, start);
    this.nextAt = this.total + Math.round(o.followHopSec * o.paceScale * SAMPLE_RATE);
    const upd = tracker.update(this.keySince(asr, o.tailSec));
    let reason = upd.held ? 'hold' : 'follow';

    // How much of the recent audio does the locked shabad explain?
    const whole = this.retriever.scoreShabad(this.keySince(asr, o.followWindowSec), tracker.shabad);
    if (whole.querySelf >= o.lostMinSelf && this.lastGlobalTop >= o.lyricScore) {
      this.recentEmission.push({ t, e: whole.score });
    }
    this.recentEmission = this.recentEmission.filter((x) => t - x.t <= o.lostWindowSec * o.paceScale);
    const staleSec = o.staleSec;
    if (whole.querySelf >= o.lostMinSelf) this.voicedEmission.push({ t, e: whole.score });
    this.voicedEmission = this.voicedEmission.filter((x) => t - x.t <= staleSec);

    if (global) {
      this.lastGlobal = t;
      const res = this.retriever.search(asr.key);
      this.addEvidence(res.shabads, t);
      this.lastGlobalTop = res.shabads[0]?.score ?? 0;
      if (!this.manual && res.querySelf >= o.lostMinSelf) {
        // Paired comparison on this same window: challengers vs the locked shabad.
        const locked = this.retriever.scoreShabad(asr.key, tracker.shabad).score;
        const scores = new Map<number, { score: number; line: number }>();
        for (const h of res.shabads.slice(0, 5)) scores.set(h.shabad, { score: h.score, line: h.line });
        for (const r of this.ranked(t).slice(0, 3)) {
          if (!scores.has(r.shabad)) {
            const h = this.retriever.scoreShabad(asr.key, r.shabad);
            scores.set(r.shabad, { score: h.score, line: h.line });
          }
        }
        for (const [shabad, v] of scores) {
          if (shabad === tracker.shabad || v.score < o.pairedMinScore) continue;
          const list = this.paired.get(shabad) ?? [];
          list.push({ t, d: v.score - locked, line: v.line });
          this.paired.set(shabad, list);
        }
      }
      const challenger = this.manual ? null : this.pairedChallenger(t);
      if (challenger) {
        this.startTracking(challenger.shabad, challenger.line, asr);
        return this.event(asr, t, 'switch-paired', challenger.mean);
      }
      const ranked = this.ranked(t);
      const lockedScore = ranked.find((r) => r.shabad === tracker.shabad)?.score ?? 0;
      const best = ranked[0];
      if (
        !this.manual &&
        best &&
        best.shabad !== tracker.shabad &&
        best.score >= o.lockEvidence &&
        best.score - lockedScore >= o.lockMargin + o.switchStickiness &&
        best.ev.support.length >= o.minSupport
      ) {
        const line = res.shabads.find((h) => h.shabad === best.shabad)?.line ?? best.ev.bestLine;
        this.startTracking(best.shabad, line, asr);
        return this.event(asr, t, 'switch', best.score);
      }
    }

    if (!this.manual && this.recentEmission.length >= o.lostMinHops) {
      const mean = this.recentEmission.reduce((a, x) => a + x.e, 0) / this.recentEmission.length;
      if (mean < o.lostScore) {
        const lost = tracker.shabad;
        this.tracker = null;
        this.state = 'searching';
        this.evidence.delete(lost);
        this.recentEmission = [];
        this.voicedEmission = [];
        this.lockedAt = this.now;
        reason = 'unlock';
      }
    }
    if (this.tracker && !this.manual && o.staleSec > 0 && t - this.lockedAt >= staleSec && this.voicedEmission.length >= o.lostMinHops) {
      const mean = this.voicedEmission.reduce((a, x) => a + x.e, 0) / this.voicedEmission.length;
      if (mean < o.lostScore) {
        const stale = this.tracker.shabad;
        this.tracker = null;
        this.state = 'searching';
        this.evidence.delete(stale);
        this.paired.clear();
        this.recentEmission = [];
        this.voicedEmission = [];
        reason = 'unlock-stale';
      }
    }
    return this.event(asr, t, reason, upd.posterior);
  }
}
