/**
 * Shabad-transition test: splices recording A (first `--a-sec` seconds)
 * and recording B, runs the engine live, and reports how long after the
 * splice it takes to show shabad B, and any time spent on a third shabad.
 *
 * Usage: node dist/cli/transition.js <idA> <idB> [--a-sec 150] [--b-sec 150]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AsrModel, SAMPLE_RATE } from '../engine/asr';
import { Corpus } from '../engine/corpus';
import { Engine } from '../engine/engine';
import { canonicalCompareKey } from '../engine/gurmukhi';
import { Retriever } from '../engine/retrieval';
import { loadAudio } from './audio-file';
import { CachedTranscriber } from './cached-asr';
import type { GtCase } from './score';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

export interface TransitionResult {
  /** Seconds after the splice until shabad B is on screen (null: never). */
  switchSec: number | null;
  /** Seconds shabad A stayed on screen after the splice. */
  oldAfterSec: number;
  onA: number;
  onB: number;
  onOther: number;
}

/** Plays `a` then `b` through the engine and measures the change from shabad `sA` to `sB`. */
export async function runTransition(
  corpus: Corpus,
  engine: Engine,
  a: Float32Array,
  b: Float32Array,
  sA: number,
  sB: number,
  onEvent?: (t: number, reason: string, name: string) => void,
): Promise<TransitionResult> {
  const audio = new Float32Array(a.length + b.length);
  audio.set(a);
  audio.set(b, a.length);
  const splice = a.length / SAMPLE_RATE;
  let onA = 0, onB = 0, onOther = 0, oldAfter = 0, firstB: number | null = null, prevT = 0, prevShabad: number | null = null;
  for (let p = 0; p < audio.length; p += 1600) {
    engine.pushAudio(audio.subarray(p, Math.min(p + 1600, audio.length)));
    while (engine.due()) {
      const ev = await engine.step();
      if (!ev) continue;
      const dt = ev.t - prevT;
      if (prevShabad === sA) {
        onA += dt;
        if (ev.t > splice) oldAfter += Math.min(dt, ev.t - splice);
      }
      else if (prevShabad === sB) onB += dt;
      else if (prevShabad !== null) onOther += dt;
      prevT = ev.t;
      prevShabad = ev.line === null ? null : ev.shabad;
      if (onEvent && ev.reason !== 'follow' && ev.reason !== 'hold' && ev.reason !== 'search') {
        const name = ev.shabad === null ? '-' : ev.shabad === sA ? 'A' : ev.shabad === sB ? 'B' : `other(${corpus.shabads[ev.shabad].id})`;
        onEvent(ev.t, ev.reason, name);
      }
      if (firstB === null && ev.t > splice && ev.shabad === sB && ev.line !== null) firstB = ev.t;
    }
  }
  return { switchSec: firstB === null ? null : firstB - splice, oldAfterSec: oldAfter, onA, onB, onOther };
}

/** The shabad of a benchmark case (from its first sung line). */
export function shabadOf(corpus: Corpus, gt: GtCase): number {
  const t1 = canonicalCompareKey(gt.lines![1].text);
  for (let i = 0; i < corpus.lineCount; i++) if (canonicalCompareKey(corpus.text[i]) === t1) return corpus.shabadOf[i];
  throw new Error('shabad not found');
}

async function main(): Promise<void> {
  const [idA, idB] = process.argv.slice(2, 4);
  const aSec = Number(arg('a-sec', '150'));
  const bSec = Number(arg('b-sec', '150'));
  const gtDir = resolve(arg('gt', '../work/bench/test'));
  const audioDir = resolve(arg('audio', '../work/audio'));
  const corpus = Corpus.load(resolve('resources/corpus.json.gz'));
  const retriever = new Retriever(corpus);
  const gtA = JSON.parse(readFileSync(join(gtDir, `${idA}.json`), 'utf8')) as GtCase;
  const gtB = JSON.parse(readFileSync(join(gtDir, `${idB}.json`), 'utf8')) as GtCase;
  const a = loadAudio(join(audioDir, `${idA}_16k.wav`)).subarray(0, aSec * SAMPLE_RATE);
  const b = loadAudio(join(audioDir, `${idB}_16k.wav`)).subarray(0, bSec * SAMPLE_RATE);
  const model = process.argv.includes('--cache-only')
    ? null
    : await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));
  const asr = new CachedTranscriber(model, resolve('.cache/asr'), `splice-${idA}-${aSec}-${idB}-${bSec}`, 0);
  const engine = new Engine(corpus, retriever, asr, JSON.parse(arg('opts', '{}')));
  const r = await runTransition(corpus, engine, a, b, shabadOf(corpus, gtA), shabadOf(corpus, gtB), (t, reason, name) =>
    console.log(`t=${t.toFixed(1)} ${reason} ${name}`),
  );
  asr.save();
  console.log(
    `splice at ${(a.length / SAMPLE_RATE).toFixed(0)} s; shabad B shown ${r.switchSec === null ? 'never' : `${r.switchSec.toFixed(1)} s after the splice`}; ` +
      `time on A ${r.onA.toFixed(0)} s, on B ${r.onB.toFixed(0)} s, on another shabad ${r.onOther.toFixed(0)} s`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
