/**
 * Soak test.
 *
 *   node dist/cli/soak.js --hours 2
 *     Simulated: replays cached recognizer outputs (from .cache/asr) as fast
 *     as possible for N hours of audio, switching modes every 20 minutes,
 *     and reports heap growth and per-step engine time. Finds leaks in the
 *     engine's state (evidence, comparisons, caches) without the model.
 *
 *   node dist/cli/soak.js --real 10 [--audio <wav>]
 *     Real time: runs the model for N wall-clock minutes on a looped
 *     recording, paced by the pacer, and reports decode latency, how stale
 *     each update is when it lands, and resident memory over time.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AsrModel, SAMPLE_RATE, type AsrResult } from '../engine/asr';
import { Corpus } from '../engine/corpus';
import { Engine, type EngineMode, type Transcriber } from '../engine/engine';
import { toKeyTimed } from '../engine/gurmukhi';
import { Pacer } from '../engine/pacer';
import { Retriever } from '../engine/retrieval';
import { loadAudio } from './audio-file';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mb = (x: number) => `${(x / 1048576).toFixed(0)} MB`;
const pctl = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

/** Recognizer that replays cached outputs in file order. */
function replayTranscriber(): Transcriber {
  const entries: { p: string[]; pt: number[]; f: number; w: number; ms: number }[] = [];
  const dir = resolve('.cache/asr');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, (typeof entries)[number]>;
    const keys = Object.keys(c).sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]));
    for (const k of keys) entries.push(c[k]);
  }
  if (!entries.length) throw new Error('no cached recognizer outputs; run the benchmark first');
  let i = 0;
  return {
    async transcribe(samples: Float32Array): Promise<AsrResult> {
      const e = entries[i++ % entries.length];
      const pieceTimes = Float32Array.from(e.pt);
      const { key, src } = toKeyTimed(e.p);
      const keyTimes = new Float32Array(key.length);
      for (let k = 0; k < key.length; k++) keyTimes[k] = pieceTimes[src[k]];
      return { pieces: e.p, pieceTimes, text: e.p.join(''), key, keyTimes, frameSec: 0.04, frames: e.f, windowSec: samples.length / SAMPLE_RATE, inferMs: e.ms };
    },
  };
}

async function simulated(corpus: Corpus, retriever: Retriever, hours: number): Promise<void> {
  const engine = new Engine(corpus, retriever, replayTranscriber());
  const modes: EngineMode[] = [{ kind: 'kirtan' }, { kind: 'paath' }, { kind: 'bani', id: 'JAPJ' }, { kind: 'kirtan' }];
  const chunk = new Float32Array(1600);
  const total = hours * 3600 * SAMPLE_RATE;
  const stepMs: number[] = [];
  const reasons = new Map<string, number>();
  let nextReport = 0, nextMode = 20 * 60, modeIdx = 0;
  global.gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  for (let fed = 0; fed < total; fed += chunk.length) {
    engine.pushAudio(chunk);
    while (engine.due()) {
      const t0 = performance.now();
      const ev = await engine.step();
      stepMs.push(performance.now() - t0);
      if (ev) reasons.set(ev.reason, (reasons.get(ev.reason) ?? 0) + 1);
    }
    const t = fed / SAMPLE_RATE;
    if (t >= nextMode) {
      modeIdx = (modeIdx + 1) % modes.length;
      engine.setMode(modes[modeIdx]);
      nextMode += 20 * 60;
    }
    if (t >= nextReport) {
      global.gc?.();
      console.log(`  t=${(t / 60).toFixed(0).padStart(4)} min  heap ${mb(process.memoryUsage().heapUsed)}  mode ${engine.currentMode.kind}`);
      nextReport += 15 * 60;
    }
  }
  global.gc?.();
  const heap1 = process.memoryUsage().heapUsed;
  console.log(
    `simulated ${hours} h: ${stepMs.length} engine steps, matcher+tracker time p50 ${pctl(stepMs, 0.5).toFixed(1)} ms, ` +
      `p99 ${pctl(stepMs, 0.99).toFixed(1)} ms; heap ${mb(heap0)} -> ${mb(heap1)}`,
  );
  console.log(`  actions: ${[...reasons].map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

async function realTime(corpus: Corpus, retriever: Retriever, minutes: number, audioPath: string): Promise<void> {
  const model = await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));
  const pacer = new Pacer();
  const probe = new Float32Array(5 * SAMPLE_RATE).map(() => (Math.random() - 0.5) * 0.01);
  await model.transcribe(probe);
  const r = await model.transcribe(probe);
  const engine = new Engine(corpus, retriever, { transcribe: (s) => model.transcribe(s) });
  pacer.calibrate(r.inferMs, 5, engine.opts.followHopSec, engine.opts.followWindowSec);
  engine.opts.paceScale = pacer.scale;
  const audio = loadAudio(audioPath);
  const start = Date.now();
  const end = start + minutes * 60000;
  let fed = 0;
  const latency: number[] = [];
  const stale: number[] = [];
  const rss: number[] = [];
  let busy = false;
  let nextRss = start;
  await new Promise<void>((done) => {
    const timer = setInterval(async () => {
      const now = Date.now();
      // Feed audio up to wall-clock time (looping the recording).
      const target = Math.floor(((now - start) / 1000) * SAMPLE_RATE);
      while (fed < target) {
        const off = fed % audio.length;
        const n = Math.min(1600, target - fed, audio.length - off);
        engine.pushAudio(audio.subarray(off, off + n));
        fed += n;
      }
      if (now >= nextRss) {
        rss.push(process.memoryUsage().rss);
        nextRss += 30000;
      }
      if (now >= end) {
        clearInterval(timer);
        done();
        return;
      }
      if (busy || !engine.due()) return;
      busy = true;
      const audioEnd = engine.now;
      const ev = await engine.step();
      busy = false;
      if (!ev) return;
      latency.push(ev.inferMs);
      // How far behind live audio the update is when it lands.
      stale.push((Date.now() - start) / 1000 - audioEnd);
      const hop = ev.state === 'searching' ? engine.opts.searchHopSec : engine.opts.followHopSec;
      engine.opts.paceScale = pacer.observe(ev.inferMs, hop);
    }, 20);
  });
  console.log(
    `real time ${minutes} min, ${model.threads} threads: ${latency.length} decodes; decode p50 ${pctl(latency, 0.5).toFixed(0)} ms, ` +
      `p95 ${pctl(latency, 0.95).toFixed(0)} ms; update lands p50 ${pctl(stale, 0.5).toFixed(2)} s, p95 ${pctl(stale, 0.95).toFixed(2)} s ` +
      `after its audio; pace tier ${pacer.scale}x; RSS ${mb(rss[0])} -> ${mb(rss[rss.length - 1])} (max ${mb(Math.max(...rss))})`,
  );
}

async function main(): Promise<void> {
  const corpus = Corpus.load(resolve('resources/corpus.json.gz'));
  const retriever = new Retriever(corpus);
  if (arg('real')) await realTime(corpus, retriever, Number(arg('real')), resolve(arg('audio') ?? '../work/audio/kchMJPK9Axs_16k.wav'));
  else await simulated(corpus, retriever, Number(arg('hours') ?? 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
