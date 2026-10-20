/**
 * Calibration report: how well single windows identify the right shabad.
 *
 * For every benchmark recording, decodes windows of each length on a fixed
 * grid and reports where the true shabad ranks and how its score compares
 * with the best wrong shabad. Used to set lock thresholds from data.
 *
 * Usage: node dist/cli/calibrate.js [--gt dir] [--audio dir] [--windows 5,10] [--hop 2]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AsrModel, SAMPLE_RATE } from '../engine/asr';
import { Corpus } from '../engine/corpus';
import { canonicalCompareKey } from '../engine/gurmukhi';
import { Retriever } from '../engine/retrieval';
import { loadAudio } from './audio-file';
import { CachedTranscriber } from './cached-asr';
import type { GtCase } from './score';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

async function main(): Promise<void> {
  const gtDir = resolve(arg('gt', '../work/bench/test'));
  const audioDir = resolve(arg('audio', '../work/audio'));
  const windows = arg('windows', '5,10').split(',').map(Number);
  const hop = Number(arg('hop', '2'));
  const corpus = Corpus.load(resolve('resources/corpus.json.gz'));
  const retriever = new Retriever(corpus);
  const model = process.argv.includes('--cache-only')
    ? null
    : await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));

  const files = readdirSync(gtDir).filter((f) => /^[A-Za-z0-9_-]{11}\.json$/.test(f));
  for (const w of windows) {
    const trueScores: number[] = [], falseScores: number[] = [], margins: number[] = [];
    let top1 = 0, top3 = 0, n = 0, singing = 0;
    for (const f of files) {
      const gt = JSON.parse(readFileSync(join(gtDir, f), 'utf8')) as GtCase;
      const audio = loadAudio(join(audioDir, `${gt.video_id}_16k.wav`));
      const asr = new CachedTranscriber(model, resolve('.cache/asr'), gt.video_id, 0);
      const trueTexts = (gt.lines ?? []).map((l) => canonicalCompareKey(l.text));
      const isTrue = (shabad: number) => {
        const ours = corpus.linesOf(shabad).map((l) => canonicalCompareKey(corpus.text[l]));
        return ours.length === trueTexts.length && ours.every((x, i) => x === trueTexts[i]);
      };
      const trueCache = new Map<number, boolean>();
      const truth = (s: number) => {
        if (!trueCache.has(s)) trueCache.set(s, isTrue(s));
        return trueCache.get(s)!;
      };
      for (let end = w; end <= audio.length / SAMPLE_RATE; end += hop) {
        const start = Math.round((end - w) * SAMPLE_RATE);
        const r = await asr.transcribe(audio.subarray(start, start + Math.round(w * SAMPLE_RATE)), start);
        // Only score windows that overlap labelled singing.
        const mid = end - w / 2;
        if (!gt.segments.some((s) => mid >= s.start && mid <= s.end)) continue;
        singing++;
        const res = retriever.search(r.key);
        n++;
        const rank = res.shabads.findIndex((h) => truth(h.shabad));
        const tr = rank >= 0 ? res.shabads[rank].score : 0;
        const fa = res.shabads.find((h) => !truth(h.shabad))?.score ?? 0;
        if (rank === 0) top1++;
        if (rank >= 0 && rank < 3) top3++;
        trueScores.push(tr);
        falseScores.push(fa);
        margins.push(tr - fa);
      }
      asr.save();
    }
    console.log(`\nwindow ${w}s, hop ${hop}s, ${n} windows over singing`);
    console.log(`  true shabad top-1 ${(100 * top1 / n).toFixed(1)}%   top-3 ${(100 * top3 / n).toFixed(1)}%`);
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      console.log(
        `  p${String(p * 100).padStart(2)}: true ${pct(trueScores, p).toFixed(2)}   best-false ${pct(falseScores, p).toFixed(2)}   margin ${pct(margins, p).toFixed(2)}`,
      );
    }
    void singing;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
