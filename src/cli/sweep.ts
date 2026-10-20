/**
 * Parameter sweep over the benchmark from the decode cache (no model needed).
 *
 * Usage: node dist/cli/sweep.js '<json array of partial EngineOptions>' [--gt dir] [--audio dir]
 * Prints overall frame accuracy, wrong-shabad seconds and median first-lock time per option set.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Corpus } from '../engine/corpus';
import type { EngineOptions } from '../engine/engine';
import { Retriever } from '../engine/retrieval';
import { runCase } from './bench';
import { scoreCase, type GtCase } from './score';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const sets = JSON.parse(process.argv[2] ?? '[{}]') as Partial<EngineOptions>[];
  const gtDir = resolve(arg('gt', '../work/bench/test'));
  const audioDir = resolve(arg('audio', '../work/audio'));
  const corpus = Corpus.load(resolve('resources/corpus.json.gz'));
  const retriever = new Retriever(corpus);
  const cases = readdirSync(gtDir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ id: f.replace(/\.json$/, ''), gt: JSON.parse(readFileSync(join(gtDir, f), 'utf8')) as GtCase }));
  for (const opts of sets) {
    let correct = 0, total = 0, wrong = 0;
    const locks: number[] = [];
    const per: string[] = [];
    for (const c of cases) {
      const run = await runCase(corpus, retriever, null, c.gt, c.id, audioDir, resolve('.cache/asr'), opts, false);
      const s = scoreCase(c.gt, { segments: run.segments });
      correct += s.correct;
      total += s.total;
      wrong += run.wrongShabadSec;
      locks.push(run.firstCorrectLockSec ?? 999);
      per.push(s.frame_accuracy.toFixed(0));
    }
    locks.sort((a, b) => a - b);
    console.log(
      `${((100 * correct) / total).toFixed(1)}%  wrong-shabad ${wrong.toFixed(0)}s  median-lock ${locks[locks.length >> 1].toFixed(0)}s  [${per.join(' ')}]  ${JSON.stringify(opts)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
