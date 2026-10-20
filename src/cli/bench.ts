/**
 * Run the engine live-and-blind over the Live Gurbani Captioning benchmark v1
 * and score it.
 *
 * Usage:
 *   node dist/cli/bench.js --gt <bench>/test --audio <dir with {id}_16k.wav>
 *        [--out bench-out] [--cache .cache/asr] [--latency] [--only <id>]
 *        [--cache-only] [--opts '{"lockMargin":0.4}'] [--verbose]
 *
 * Live: at stream time t the engine has only audio up to t. With --latency,
 * each prediction is also delayed by its measured decode time, which is what
 * a viewer would see on this machine.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AsrModel, SAMPLE_RATE } from '../engine/asr';
import { Corpus } from '../engine/corpus';
import { Engine, type EngineEvent, type EngineOptions } from '../engine/engine';
import { canonicalCompareKey } from '../engine/gurmukhi';
import { Retriever } from '../engine/retrieval';
import { loadAudio } from './audio-file';
import { CachedTranscriber } from './cached-asr';
import { scoreCase, type GtCase, type PredSegment } from './score';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Map our shabad index to the GT shabad id when their texts are identical. */
function gtShabadFor(corpus: Corpus, shabad: number, gt: GtCase): number | null {
  if (!gt.lines?.length) return null;
  const ours = corpus.linesOf(shabad).map((l) => canonicalCompareKey(corpus.text[l]));
  const theirs = gt.lines.map((l) => canonicalCompareKey(l.text));
  if (ours.length !== theirs.length) return null;
  let same = 0;
  for (let i = 0; i < ours.length; i++) if (ours[i] === theirs[i]) same++;
  return same / theirs.length >= 0.8 ? (gt.lines[0].shabad_id ?? gt.shabad_id ?? null) : null;
}

export interface CaseRun {
  id: string;
  accuracy: number;
  firstLockSec: number | null;
  firstCorrectLockSec: number | null;
  wrongShabadSec: number;
  locks: number;
  events: EngineEvent[];
  segments: PredSegment[];
}

export async function runCase(
  corpus: Corpus,
  retriever: Retriever,
  model: AsrModel | null,
  gt: GtCase,
  id: string,
  audioDir: string,
  cacheDir: string,
  opts: Partial<EngineOptions>,
  latency: boolean,
): Promise<CaseRun> {
  const audio = loadAudio(join(audioDir, `${gt.video_id}_16k.wav`));
  // Start on a 0.5 s grid so cold-start cases share cached windows.
  const startSec = Math.floor((gt.uem?.start ?? 0) * 2) / 2;
  const offset = Math.round(startSec * SAMPLE_RATE);
  const asr = new CachedTranscriber(model, cacheDir, gt.video_id, offset);
  const engine = new Engine(corpus, retriever, asr, opts);
  const chunk = Math.round(0.1 * SAMPLE_RATE);
  const events: EngineEvent[] = [];
  for (let p = offset; p < audio.length; p += chunk) {
    engine.pushAudio(audio.subarray(p, Math.min(p + chunk, audio.length)));
    while (engine.due()) {
      const ev = await engine.step();
      if (ev) events.push(ev);
    }
  }
  asr.save();

  const gtShabadCache = new Map<number, number | null>();
  const resolveShabad = (s: number) => {
    if (!gtShabadCache.has(s)) gtShabadCache.set(s, gtShabadFor(corpus, s, gt));
    return gtShabadCache.get(s)!;
  };

  // Turn events into a step function of (shabad, line) over time.
  const segments: PredSegment[] = [];
  let cur: { start: number; shabad: number | null; line: number | null } | null = null;
  let firstLock: number | null = null;
  let firstCorrect: number | null = null;
  let locks = 0;
  let wrongShabadSec = 0;
  const end = audio.length / SAMPLE_RATE;
  const close = (t: number) => {
    if (cur && cur.shabad !== null && cur.line !== null && t > cur.start) {
      const gid = resolveShabad(cur.shabad);
      segments.push({
        start: Math.round(cur.start * 100) / 100,
        end: Math.round(t * 100) / 100,
        shabad_id: gid ?? -1 - cur.shabad,
        line_idx: corpus.lineInShabad[cur.line],
      });
      if (gid === null) wrongShabadSec += t - cur.start;
    }
  };
  for (const ev of events) {
    const t = startSec + ev.t + (latency ? ev.inferMs / 1000 : 0);
    if (ev.reason.startsWith('lock') || ev.reason.startsWith('switch')) {
      locks++;
      if (firstLock === null) firstLock = t - startSec;
      if (firstCorrect === null && ev.shabad !== null && resolveShabad(ev.shabad) !== null) firstCorrect = t - startSec;
    }
    const shabad = ev.line === null ? null : ev.shabad;
    if (!cur || cur.shabad !== shabad || cur.line !== ev.line) {
      close(t);
      cur = { start: t, shabad, line: ev.line };
    }
  }
  close(end);

  const s = scoreCase(gt, { video_id: gt.video_id, segments });
  return {
    id,
    accuracy: s.frame_accuracy,
    firstLockSec: firstLock,
    firstCorrectLockSec: firstCorrect,
    wrongShabadSec,
    locks,
    events,
    segments,
  };
}

async function main(): Promise<void> {
  const gtDir = resolve(arg('gt', '../work/bench/test')!);
  const audioDir = resolve(arg('audio', '../work/audio')!);
  const outDir = resolve(arg('out', 'bench-out')!);
  const cacheDir = resolve(arg('cache', '.cache/asr')!);
  const corpusPath = resolve(arg('corpus', 'resources/corpus.json.gz')!);
  const modelDir = resolve(arg('models', 'models')!);
  const only = arg('only');
  const opts = JSON.parse(arg('opts', '{}')!) as Partial<EngineOptions>;
  const latency = flag('latency');

  const t0 = Date.now();
  const corpus = Corpus.load(corpusPath);
  const retriever = new Retriever(corpus);
  console.error(`corpus + index ready in ${Date.now() - t0} ms (${corpus.lineCount} lines)`);
  const model = flag('cache-only')
    ? null
    : await AsrModel.load(join(modelDir, 'model.int8.onnx'), join(modelDir, 'edge-vocab.json'));

  mkdirSync(outDir, { recursive: true });
  const runs: CaseRun[] = [];
  let correct = 0, total = 0;
  for (const f of readdirSync(gtDir).filter((x) => x.endsWith('.json')).sort()) {
    const id = f.replace(/\.json$/, '');
    if (only && !id.startsWith(only)) continue;
    const gt = JSON.parse(readFileSync(join(gtDir, f), 'utf8')) as GtCase;
    const run = await runCase(corpus, retriever, model, gt, id, audioDir, cacheDir, opts, latency);
    runs.push(run);
    writeFileSync(join(outDir, f), JSON.stringify({ video_id: gt.video_id, segments: run.segments }, null, 1));
    const sc = scoreCase(gt, { segments: run.segments });
    correct += sc.correct;
    total += sc.total;
    const fl = run.firstCorrectLockSec === null ? '  never' : `${run.firstCorrectLockSec.toFixed(1).padStart(6)}s`;
    console.log(
      `${id.padEnd(22)} ${run.accuracy.toFixed(1).padStart(6)}%   first correct lock ${fl}   locks ${run.locks}   wrong-shabad ${run.wrongShabadSec.toFixed(0)}s`,
    );
    if (flag('verbose')) {
      for (const ev of run.events) {
        if (ev.reason === 'search' || ev.reason === 'follow' || ev.reason === 'hold') continue;
        const c = ev.shabad !== null ? `${corpus.shabads[ev.shabad].id}:${ev.lineInShabad}` : '-';
        console.log(`   t=${ev.t.toFixed(1)} ${ev.reason} ${c} conf=${ev.confidence.toFixed(2)} | ${ev.asrText}`);
      }
    }
  }
  const overall = total ? (correct / total) * 100 : 0;
  console.log(`OVERALL frame accuracy (live, blind${latency ? ', with decode latency' : ''}): ${overall.toFixed(1)}%  [${correct}/${total} frames]`);
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ overall, latency, opts, runs: runs.map(({ events, segments, ...r }) => r) }, null, 1));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
