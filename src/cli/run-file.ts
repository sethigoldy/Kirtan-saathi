/**
 * Follow any audio file from the command line and print the timeline of
 * shabad and line changes (canonical text only).
 *
 * Usage: npm run run-file -- <audio file> [--mode kirtan|paath|bani:<ID>] [--start <sec>] [--debug]
 * Bani IDs: JAPJ (Japji), JAAP (Jaap), RHRS (Rehras), SHLA (Sohila), ANND (Anand), SKMI (Sukhmani), ...
 * Non-WAV input needs ffmpeg on PATH.
 */
import { resolve } from 'node:path';
import { AsrModel, SAMPLE_RATE } from '../engine/asr';
import { Corpus } from '../engine/corpus';
import { Engine } from '../engine/engine';
import { Retriever } from '../engine/retrieval';
import { loadAudio } from './audio-file';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function clock(t: number): string {
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('usage: npm run run-file -- <audio file> [--mode kirtan|paath|bani:<ID>] [--start <sec>] [--debug]');
    process.exit(2);
  }
  const corpus = Corpus.load(resolve('resources/corpus.json.gz'));
  const retriever = new Retriever(corpus);
  const model = await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));
  const engine = new Engine(corpus, retriever, { transcribe: (s) => model.transcribe(s) });
  const modeArg = arg('mode') ?? 'kirtan';
  engine.setMode(modeArg.startsWith('bani:') ? { kind: 'bani', id: modeArg.slice(5) } : { kind: modeArg as 'kirtan' | 'paath' });
  const audio = loadAudio(file);
  const start = Math.round(Number(arg('start') ?? 0) * SAMPLE_RATE);
  const debug = process.argv.includes('--debug');
  let shown: string | null = null;
  let decodeMs = 0, decodes = 0;
  for (let p = start; p < audio.length; p += 1600) {
    engine.pushAudio(audio.subarray(p, Math.min(p + 1600, audio.length)));
    while (engine.due()) {
      const ev = await engine.step();
      if (!ev) continue;
      decodeMs += ev.inferMs;
      decodes++;
      const t = start / SAMPLE_RATE + ev.t;
      if (debug) console.log(`  ${clock(t)} [${ev.reason}] ${ev.asrText}`);
      const key = ev.line === null ? null : `${ev.shabad}:${ev.line}`;
      if (key !== shown) {
        shown = key;
        if (ev.line === null) {
          console.log(`${clock(t)}  —`);
        } else {
          const s = corpus.shabads[ev.shabad!];
          const tag = ev.reason.startsWith('lock') || ev.reason.startsWith('switch')
            ? `  [${ev.reason}: ${corpus.sources[s.source].nameEn}, ${s.section}, page ${s.page}]`
            : '';
          console.log(`${clock(t)}  ${corpus.plain[ev.line]}${tag}`);
        }
      }
    }
  }
  console.error(`${decodes} decodes, mean ${(decodeMs / Math.max(decodes, 1)).toFixed(0)} ms (${model.threads} threads)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
