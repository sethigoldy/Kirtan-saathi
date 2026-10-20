/**
 * Paath evaluation on stitched sehaj-paath streams (see docs in README).
 *
 * Usage: node dist/cli/paath-eval.js <stream> [--dir <dir with <stream>.wav and .clips.json>]
 *        [--mode paath|kirtan|bani:<ID>] [--cache-only] [--opts '<json>'] [--verbose]
 *
 * Metrics (scored inside clips, 0.1 s resolution):
 *   exact      display shows the clip's line
 *   within-1   display is the clip's line or an adjacent line in reading order
 *   lag        per line: first time the display shows it, minus the clip start
 *   missed     lines never shown between 1 s before their start and 3 s after their end
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Aligner, selfScore } from '../engine/align';
import { AsrModel, SAMPLE_RATE } from '../engine/asr';
import { Corpus } from '../engine/corpus';
import { Engine, type EngineMode, type EngineOptions } from '../engine/engine';
import { encodeKey, toKey } from '../engine/gurmukhi';
import { Retriever } from '../engine/retrieval';
import { loadAudio } from './audio-file';
import { CachedTranscriber } from './cached-asr';

interface Clip { start: number; end: number; text: string; ang: string; line?: number | null }

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

/** Map each clip to a corpus line: sequential search within its ang range. */
export function labelClips(corpus: Corpus, clips: Clip[]): Clip[] {
  const aligner = new Aligner();
  const sggs = 0; // source index of Sri Guru Granth Sahib (first in corpus order)
  let ptr = -1;
  const codesOf = new Map<number, Uint8Array>();
  const codes = (l: number) => {
    let c = codesOf.get(l);
    if (!c) { c = encodeKey(corpus.key[l]); codesOf.set(l, c); }
    return c;
  };
  for (const clip of clips) {
    const [a, b] = clip.ang.split('-').map(Number);
    const q = encodeKey(toKey(clip.text));
    const qs = selfScore(q);
    let best = { line: -1, score: 0 };
    const consider = (l: number) => {
      if (l < 0 || l >= corpus.lineCount) return;
      const s = corpus.shabads[corpus.shabadOf[l]];
      if (s.source !== sggs || corpus.page[l] < a - 1 || corpus.page[l] > b + 1) return;
      const c = codes(l);
      const al = aligner.local(q, c);
      const score = al.score / Math.max(qs, selfScore(c), 1);
      if (score > best.score + 1e-6) best = { line: l, score };
    };
    if (ptr >= 0) for (let l = ptr; l <= ptr + 30; l++) consider(l);
    if (best.score < 0.6) {
      for (let l = 0; l < corpus.lineCount; l++) {
        if (corpus.page[l] >= a - 1 && corpus.page[l] <= b + 1 && corpus.shabads[corpus.shabadOf[l]].source === sggs) consider(l);
      }
    }
    clip.line = best.score >= 0.5 ? best.line : null;
    if (clip.line !== null) ptr = clip.line;
  }
  return clips;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((x, y) => x - y);
  return s[s.length >> 1];
}

export interface PaathMetrics {
  name: string;
  mode: string;
  minutes: number;
  clips: number;
  unlabeled: number;
  lines: number;
  exact: number;
  within1: number;
  farOff: number;
  lagMedian: number;
  lagP90: number;
  missed: number;
  firstDisplaySec: number | null;
  unlocks: number;
  uncachedWindows: number;
}

/** Run the engine over one stitched paath stream and score it. */
export async function evaluatePaath(params: {
  corpus: Corpus;
  retriever: Retriever;
  model: AsrModel | null;
  name: string;
  dir: string;
  mode: string;
  cacheDir: string;
  opts?: Partial<EngineOptions>;
  onChange?: (t: number, reason: string, line: number | null) => void;
}): Promise<PaathMetrics> {
  const { corpus, retriever, model, name, dir } = params;
  const mode: EngineMode = params.mode.startsWith('bani:') ? { kind: 'bani', id: params.mode.slice(5) } : { kind: params.mode as 'paath' | 'kirtan' };
  const manifest = JSON.parse(readFileSync(join(dir, `${name}.clips.json`), 'utf8')) as { clips: Clip[] };
  const clips = labelClips(corpus, manifest.clips);
  const unlabeled = clips.filter((c) => c.line === null).length;
  const audio = loadAudio(join(dir, `${name}.wav`));
  const asr = new CachedTranscriber(model, params.cacheDir, `paath-${name}`, 0);
  const engine = new Engine(corpus, retriever, asr, params.opts ?? {});
  engine.setMode(mode);

  // Display timeline: (time, line|null) change points.
  const changes: { t: number; line: number | null }[] = [];
  let shown: number | null | undefined;
  let unlocks = 0;
  for (let p = 0; p < audio.length; p += 1600) {
    engine.pushAudio(audio.subarray(p, Math.min(p + 1600, audio.length)));
    while (engine.due()) {
      const ev = await engine.step();
      if (!ev) continue;
      if (ev.reason === 'unlock') unlocks++;
      if (ev.line !== shown) {
        shown = ev.line;
        changes.push({ t: ev.t, line: ev.line });
        params.onChange?.(ev.t, ev.reason, ev.line);
      }
    }
  }
  asr.save();
  let ci = 0;
  let cur: number | null = null;
  const displayAt = (t: number): number | null => {
    // Times are queried in increasing order within each clip; rewind when needed.
    if (ci > 0 && changes[ci - 1].t > t) { ci = 0; cur = null; }
    while (ci < changes.length && changes[ci].t <= t) cur = changes[ci++].line;
    return cur;
  };

  // Frame metrics inside labelled clips.
  let frames = 0, exact = 0, within1 = 0, wrongFar = 0;
  for (const c of clips) {
    if (c.line === null || c.line === undefined) continue;
    for (let t = c.start; t < c.end; t += 0.1) {
      const d = displayAt(t);
      frames++;
      if (d === c.line) exact++;
      if (d !== null && Math.abs(d - c.line) <= 1) within1++;
      if (d !== null && Math.abs(d - c.line) > 5) wrongFar++;
    }
  }
  // Lag per distinct line (first clip of each line).
  const lags: number[] = [];
  let missed = 0, lines = 0;
  const seen = new Set<number>();
  for (const c of clips) {
    if (c.line === null || c.line === undefined || seen.has(c.line)) continue;
    seen.add(c.line);
    lines++;
    const hit = changes.find((x) => x.line === c.line && x.t >= c.start - 1 && x.t <= c.end + 3);
    if (hit) lags.push(hit.t - c.start);
    else missed++;
  }
  const firstLabeled = clips.find((c) => c.line !== null);
  const firstCorrect = changes.find((x) => x.line !== null && clips.some((c) => c.line === x.line && Math.abs(x.t - c.start) < 30));
  const sortedLags = [...lags].sort((a, b) => a - b);
  const pct = (x: number) => Math.round((10000 * x) / Math.max(frames, 1)) / 100;
  return {
    name,
    mode: params.mode,
    minutes: Math.round((audio.length / SAMPLE_RATE / 60) * 10) / 10,
    clips: clips.length,
    unlabeled,
    lines,
    exact: pct(exact),
    within1: pct(within1),
    farOff: pct(wrongFar),
    lagMedian: Math.round(median(lags) * 100) / 100,
    lagP90: sortedLags.length ? Math.round(sortedLags[Math.floor(sortedLags.length * 0.9)] * 100) / 100 : NaN,
    missed,
    firstDisplaySec: firstCorrect ? Math.round((firstCorrect.t - (firstLabeled?.start ?? 0)) * 10) / 10 : null,
    unlocks,
    uncachedWindows: model ? 0 : asr.misses,
  };
}

async function main(): Promise<void> {
  const name = process.argv[2];
  const corpus = Corpus.load(resolve('resources/corpus.json.gz'));
  const retriever = new Retriever(corpus);
  const model = process.argv.includes('--cache-only')
    ? null
    : await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));
  const verbose = process.argv.includes('--verbose');
  const m = await evaluatePaath({
    corpus,
    retriever,
    model,
    name,
    dir: resolve(arg('dir', '../work/paath')!),
    mode: arg('mode', 'paath')!,
    cacheDir: resolve(arg('cache', '.cache/asr')!),
    opts: JSON.parse(arg('opts', '{}')!) as Partial<EngineOptions>,
    onChange: verbose ? (t, reason, line) => console.log(`${t.toFixed(1)} ${reason} ${line === null ? '-' : corpus.plain[line]}`) : undefined,
  });
  console.log(
    `${m.name} [${m.mode}] ${m.minutes} min, ${m.clips} clips (${m.unlabeled} unlabeled), ${m.lines} lines\n` +
      `  exact ${m.exact}%   within-1 ${m.within1}%   far-off ${m.farOff}%\n` +
      `  lag median ${m.lagMedian} s, p90 ${m.lagP90} s, missed ${m.missed}/${m.lines} lines   ` +
      `first display ${m.firstDisplaySec ?? 'never'} s   unlocks ${m.unlocks}`,
  );
  if (m.uncachedWindows) console.log(`  (${m.uncachedWindows} uncached windows treated as silence)`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
