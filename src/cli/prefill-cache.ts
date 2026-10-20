/**
 * Decode every window the engine could request on the benchmark audio
 * (10 s and 5 s windows ending on a 0.5 s grid, plus short windows at
 * stream starts), so parameter sweeps can run from cache in seconds.
 *
 * Usage: node dist/cli/prefill-cache.js [--gt dir] [--audio dir]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AsrModel, SAMPLE_RATE } from '../engine/asr';
import { DEFAULT_ENGINE_OPTIONS } from '../engine/engine';
import { loadAudio } from './audio-file';
import { CachedTranscriber } from './cached-asr';
import type { GtCase } from './score';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

/** Paath streams: every follow window ending on a 0.5 s grid (search windows decode on demand). */
async function prefillStream(model: AsrModel, wav: string, id: string): Promise<void> {
  const audio = loadAudio(wav);
  const asr = new CachedTranscriber(model, resolve('.cache/asr'), id, 0);
  const o = DEFAULT_ENGINE_OPTIONS;
  const dur = audio.length / SAMPLE_RATE;
  let done = 0;
  for (let end = 1; end <= dur; end += 0.5) {
    for (const w of [o.paathWindowSec]) {
      const start = Math.round(Math.max(0, end - w) * SAMPLE_RATE);
      const n = Math.round(end * SAMPLE_RATE) - start;
      if (n < SAMPLE_RATE) continue;
      await asr.transcribe(audio.subarray(start, start + n), start);
      if (++done % 300 === 0) asr.save();
    }
  }
  asr.save();
  console.log(`${id}: ${asr.misses} decoded, ${asr.hits} cached`);
}

async function main(): Promise<void> {
  const streams = process.argv.indexOf('--streams');
  if (streams >= 0) {
    const model = await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));
    const dir = resolve(arg('dir', '../work/paath'));
    for (const name of process.argv[streams + 1].split(',')) await prefillStream(model, join(dir, `${name}.wav`), `paath-${name}`);
    return;
  }
  const gtDir = resolve(arg('gt', '../work/bench/test'));
  const audioDir = resolve(arg('audio', '../work/audio'));
  const model = await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));
  const o = DEFAULT_ENGINE_OPTIONS;
  const cases = readdirSync(gtDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(gtDir, f), 'utf8')) as GtCase);
  const byVideo = new Map<string, number[]>();
  for (const c of cases) {
    const list = byVideo.get(c.video_id) ?? [];
    list.push(Math.floor((c.uem?.start ?? 0) * 2) / 2);
    byVideo.set(c.video_id, list);
  }
  for (const [video, starts] of byVideo) {
    const audio = loadAudio(join(audioDir, `${video}_16k.wav`));
    const asr = new CachedTranscriber(model, resolve('.cache/asr'), video, 0);
    const dur = audio.length / SAMPLE_RATE;
    const jobs: [number, number][] = [];
    for (let end = 0.5; end <= dur; end += 0.5) {
      for (const w of [o.searchWindowSec, o.followWindowSec]) jobs.push([Math.max(0, end - w), end]);
    }
    // Short search windows right after each stream start.
    for (const s of starts) {
      for (let end = s + o.minSearchAudioSec; end < s + o.searchWindowSec; end += 0.5) jobs.push([s, end]);
    }
    let done = 0;
    for (const [a, b] of jobs) {
      const start = Math.round(a * SAMPLE_RATE);
      const n = Math.round(b * SAMPLE_RATE) - start;
      if (n < SAMPLE_RATE) continue;
      await asr.transcribe(audio.subarray(start, start + n), start);
      if (++done % 200 === 0) asr.save();
    }
    asr.save();
    console.log(`${video}: ${jobs.length} windows, ${asr.misses} decoded, ${asr.hits} cached`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
