/**
 * CI benchmark: kirtan benchmark v1 (live, blind) + paath streams, compared
 * with ci/baseline.json and gated by ci/thresholds.json.
 *
 * Usage: node dist/cli/ci-bench.js --data .bench-data --out bench-results [--cache .cache/asr]
 *        [--private .bench-data/darbar]
 *
 * --private: caption-labelled Darbar Sahib recordings from the private data
 * repository (gt/*.json + audio/<id>_16k.wav). Only aggregate numbers are
 * printed or written; their decodes go to a temporary directory, never the
 * shared cache.
 * Writes <out>/results.json and <out>/summary.md; exits 1 if a gate fails.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AsrModel } from '../engine/asr';
import { Corpus } from '../engine/corpus';
import { Retriever } from '../engine/retrieval';
import { normalizeGt, runCase } from './bench';
import { evaluatePaath, type PaathMetrics } from './paath-eval';
import { scoreCase, type GtCase } from './score';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

interface Results {
  commit: string;
  kirtan: {
    frameAccuracy: number;
    wrongShabadSec: number;
    medianFirstLockSec: number;
    cases: { id: string; accuracy: number; firstCorrectLockSec: number | null; wrongShabadSec: number }[];
  };
  paath: PaathMetrics[];
  /** Private caption-labelled set (aggregate only). */
  darbar?: { recordings: number; minutes: number; frameAccuracy: number; wrongShabadSec: number; medianFirstLockSec: number };
}

interface Thresholds {
  kirtanFrameAccuracyMin: number;
  kirtanWrongShabadSecMax: number;
  paathWithin1Min: number;
  paathLagMedianMax: number;
  /** null: report the private set without gating it (until it has a baseline). */
  darbarFrameAccuracyMin?: number | null;
  darbarWrongShabadSecMax?: number | null;
}

const PAATH_RUNS: { name: string; mode: string }[] = [
  { name: 'val-1090', mode: 'paath' },
  { name: 'ang14', mode: 'paath' },
  { name: 'japji', mode: 'bani:JAPJ' },
];

function delta(cur: number, base: number | undefined, digits = 1, higherIsBetter = true): string {
  if (base === undefined || Number.isNaN(base)) return '';
  const d = cur - base;
  if (Math.abs(d) < Math.pow(10, -digits) / 2) return ' (±0)';
  const good = higherIsBetter ? d > 0 : d < 0;
  return ` (${d > 0 ? '+' : ''}${d.toFixed(digits)} ${good ? '▲' : '▼'})`;
}

async function main(): Promise<void> {
  const data = resolve(arg('data', '.bench-data'));
  const out = resolve(arg('out', 'bench-results'));
  const cacheDir = resolve(arg('cache', '.cache/asr'));
  mkdirSync(out, { recursive: true });
  const thresholds = JSON.parse(readFileSync(resolve('ci/thresholds.json'), 'utf8')) as Thresholds;
  const baseline = existsSync(resolve('ci/baseline.json'))
    ? (JSON.parse(readFileSync(resolve('ci/baseline.json'), 'utf8')) as Results)
    : null;

  const corpus = Corpus.load(resolve('resources/corpus.json.gz'));
  const retriever = new Retriever(corpus);
  const model = await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));

  // Kirtan benchmark.
  const gtDir = join(data, 'bench', 'test');
  let correct = 0, total = 0, wrong = 0;
  const cases: Results['kirtan']['cases'] = [];
  for (const f of readdirSync(gtDir).filter((x) => x.endsWith('.json')).sort()) {
    const gt = JSON.parse(readFileSync(join(gtDir, f), 'utf8')) as GtCase;
    const id = f.replace(/\.json$/, '');
    const run = await runCase(corpus, retriever, model, gt, id, join(data, 'audio'), cacheDir, {}, false);
    const s = scoreCase(gt, { segments: run.segments });
    correct += s.correct;
    total += s.total;
    wrong += run.wrongShabadSec;
    cases.push({ id, accuracy: s.frame_accuracy, firstCorrectLockSec: run.firstCorrectLockSec, wrongShabadSec: Math.round(run.wrongShabadSec) });
    console.log(`kirtan ${id}: ${s.frame_accuracy}%`);
  }
  const locks = cases.map((c) => c.firstCorrectLockSec ?? 999).sort((a, b) => a - b);

  // Paath streams.
  const paath: PaathMetrics[] = [];
  for (const r of PAATH_RUNS) {
    const m = await evaluatePaath({ corpus, retriever, model, name: r.name, dir: join(data, 'paath'), mode: r.mode, cacheDir });
    paath.push(m);
    console.log(`paath ${r.name} [${r.mode}]: within-1 ${m.within1}%, lag ${m.lagMedian} s`);
  }

  // Private Darbar Sahib set: aggregate only, no shared cache.
  let darbar: Results['darbar'];
  const privDir = resolve(arg('private', join(data, 'darbar')));
  if (existsSync(join(privDir, 'gt'))) {
    const tmpCache = mkdtempSync(join(tmpdir(), 'ks-private-asr-'));
    let pc = 0, pt = 0, pw = 0, seconds = 0;
    const plocks: number[] = [];
    const files = readdirSync(join(privDir, 'gt')).filter((x) => x.endsWith('.json')).sort();
    for (const f of files) {
      const gt = normalizeGt(corpus, JSON.parse(readFileSync(join(privDir, 'gt', f), 'utf8')) as GtCase);
      const run = await runCase(corpus, retriever, model, gt, f.replace(/\.json$/, ''), join(privDir, 'audio'), tmpCache, {}, false);
      const sc = scoreCase(gt, { segments: run.segments });
      pc += sc.correct;
      pt += sc.total;
      pw += run.wrongShabadSec;
      seconds += gt.total_duration;
      plocks.push(run.firstCorrectLockSec ?? 999);
    }
    rmSync(tmpCache, { recursive: true, force: true });
    plocks.sort((a, b) => a - b);
    if (files.length) {
      darbar = {
        recordings: files.length,
        minutes: Math.round(seconds / 6) / 10,
        frameAccuracy: Math.round((10000 * pc) / Math.max(1, pt)) / 100,
        wrongShabadSec: Math.round(pw),
        medianFirstLockSec: plocks[plocks.length >> 1],
      };
      console.log(`darbar (private, ${darbar.recordings} recordings, ${darbar.minutes} min): ${darbar.frameAccuracy}%`);
    }
  }

  const results: Results = {
    commit: process.env.GITHUB_SHA ?? 'local',
    kirtan: {
      frameAccuracy: Math.round((10000 * correct) / total) / 100,
      wrongShabadSec: Math.round(wrong),
      medianFirstLockSec: locks[locks.length >> 1],
      cases,
    },
    paath,
    ...(darbar ? { darbar } : {}),
  };
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));

  // Gates.
  const failures: string[] = [];
  if (results.kirtan.frameAccuracy < thresholds.kirtanFrameAccuracyMin) {
    failures.push(`kirtan frame accuracy ${results.kirtan.frameAccuracy}% < ${thresholds.kirtanFrameAccuracyMin}%`);
  }
  if (results.kirtan.wrongShabadSec > thresholds.kirtanWrongShabadSecMax) {
    failures.push(`kirtan wrong-shabad time ${results.kirtan.wrongShabadSec} s > ${thresholds.kirtanWrongShabadSecMax} s`);
  }
  if (darbar && typeof thresholds.darbarFrameAccuracyMin === 'number' && darbar.frameAccuracy < thresholds.darbarFrameAccuracyMin) {
    failures.push(`Darbar Sahib frame accuracy ${darbar.frameAccuracy}% < ${thresholds.darbarFrameAccuracyMin}%`);
  }
  if (darbar && typeof thresholds.darbarWrongShabadSecMax === 'number' && darbar.wrongShabadSec > thresholds.darbarWrongShabadSecMax) {
    failures.push(`Darbar Sahib wrong-shabad time ${darbar.wrongShabadSec} s > ${thresholds.darbarWrongShabadSecMax} s`);
  }
  for (const m of paath) {
    if (m.within1 < thresholds.paathWithin1Min) failures.push(`paath ${m.name} within-1 ${m.within1}% < ${thresholds.paathWithin1Min}%`);
    if (m.lagMedian > thresholds.paathLagMedianMax) failures.push(`paath ${m.name} median lag ${m.lagMedian} s > ${thresholds.paathLagMedianMax} s`);
  }

  // Summary (GitHub step summary / PR check).
  const b = baseline;
  const md: string[] = [];
  md.push(`## Benchmark ${failures.length ? '❌ regression' : '✅ passed'}`);
  md.push('');
  md.push('| Kirtan (benchmark v1, live, blind) | Result | Gate |');
  md.push('|---|---|---|');
  md.push(`| Frame accuracy | **${results.kirtan.frameAccuracy}%**${delta(results.kirtan.frameAccuracy, b?.kirtan.frameAccuracy)} | ≥ ${thresholds.kirtanFrameAccuracyMin}% |`);
  md.push(`| Time on a wrong shabad | ${results.kirtan.wrongShabadSec} s${delta(results.kirtan.wrongShabadSec, b?.kirtan.wrongShabadSec, 0, false)} | ≤ ${thresholds.kirtanWrongShabadSecMax} s |`);
  md.push(`| Median first correct lock | ${results.kirtan.medianFirstLockSec} s${delta(results.kirtan.medianFirstLockSec, b?.kirtan.medianFirstLockSec, 0, false)} | — |`);
  md.push('');
  md.push('| Paath stream | Mode | Within 1 line | Exact | Median lag | Missed lines | Gate |');
  md.push('|---|---|---|---|---|---|---|');
  for (const m of paath) {
    const bm = b?.paath.find((x) => x.name === m.name && x.mode === m.mode);
    md.push(
      `| ${m.name} (${m.minutes} min) | ${m.mode} | **${m.within1}%**${delta(m.within1, bm?.within1)} | ${m.exact}%${delta(m.exact, bm?.exact)} | ` +
        `${m.lagMedian} s${delta(m.lagMedian, bm?.lagMedian, 2, false)} | ${m.missed}/${m.lines} | ≥ ${thresholds.paathWithin1Min}%, ≤ ${thresholds.paathLagMedianMax} s |`,
    );
  }
  md.push('');
  if (darbar) {
    const bd = b?.darbar;
    const gate = (v: number | null | undefined, unit: string, op: string) => (typeof v === 'number' ? `${op} ${v}${unit}` : 'report only');
    md.push(`| Darbar Sahib kirtan (private, ${darbar.recordings} recordings, ${darbar.minutes} min) | Result | Gate |`);
    md.push('|---|---|---|');
    md.push(`| Frame accuracy | **${darbar.frameAccuracy}%**${delta(darbar.frameAccuracy, bd?.frameAccuracy)} | ${gate(thresholds.darbarFrameAccuracyMin, '%', '≥')} |`);
    md.push(`| Time on a wrong shabad | ${darbar.wrongShabadSec} s${delta(darbar.wrongShabadSec, bd?.wrongShabadSec, 0, false)} | ${gate(thresholds.darbarWrongShabadSecMax, ' s', '≤')} |`);
    md.push(`| Median first correct lock | ${darbar.medianFirstLockSec} s${delta(darbar.medianFirstLockSec, bd?.medianFirstLockSec, 0, false)} | — |`);
    md.push('');
  }
  md.push('<details><summary>Kirtan cases</summary>');
  md.push('');
  md.push('| Case | Accuracy | First correct lock | Wrong shabad |');
  md.push('|---|---|---|---|');
  for (const c of cases) {
    const bc = b?.kirtan.cases.find((x) => x.id === c.id);
    md.push(`| ${c.id} | ${c.accuracy}%${delta(c.accuracy, bc?.accuracy)} | ${c.firstCorrectLockSec ?? 'never'} s | ${c.wrongShabadSec} s |`);
  }
  md.push('');
  md.push('</details>');
  if (failures.length) {
    md.push('');
    md.push('**Failed gates:**');
    for (const f of failures) md.push(`- ${f}`);
  }
  md.push('');
  md.push(`Deltas are against \`ci/baseline.json\`. Update it in the same PR when a change is an intended improvement.`);
  writeFileSync(join(out, 'summary.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
