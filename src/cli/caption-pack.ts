/**
 * Adds a labelled recording to the private data repository.
 *
 *   node dist/cli/caption-pack.js <labelled/<id>> <data-repo> --split test|train
 *        [--title "…"] [--source "…"] [--date YYYY-MM-DD] [--min-confidence 0.72]
 *
 * Writes <split>/<id>.opus (16 kHz mono Opus, about 10 MB per hour),
 * <split>/<id>.json (labels, low-confidence segments dropped) and
 * <split>/<id>.meta.json (title, source, durations). Each recording is its
 * own set of files, so parallel workers and several computers can add
 * recordings to the same repository without conflicts. Nothing is written
 * to the public repository.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Split = 'test' | 'train';

export interface RecordingMeta {
  id: string;
  split: Split;
  title: string;
  source: string;
  /** Seconds into the source video where this recording starts. */
  sourceStart: number;
  date: string | null;
  durationSec: number;
  labelledSec: number;
  segments: number;
  labelledBy: string;
  addedAt: string;
}

interface Labels {
  video_id: string;
  total_duration: number;
  segments: { start: number; end: number; confidence: number }[];
  [k: string]: unknown;
}

export function filterLabels(labels: Labels, minConfidence: number): Labels {
  return { ...labels, segments: labels.segments.filter((s) => s.confidence >= minConfidence) };
}

/** All recordings in a data repository (test and train). */
export function listRecordings(repo: string): RecordingMeta[] {
  const out: RecordingMeta[] = [];
  for (const split of ['test', 'train'] as Split[]) {
    const dir = join(repo, split);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.meta.json'))) {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as RecordingMeta);
    }
  }
  return out.sort((a, b) => a.split.localeCompare(b.split) || a.id.localeCompare(b.id));
}

export async function packRecording(
  src: string,
  repo: string,
  split: Split,
  info: { title?: string; source?: string; sourceStart?: number; date?: string | null; minConfidence?: number },
): Promise<RecordingMeta> {
  const id = basename(resolve(src));
  const labelsPath = join(src, `${id}.json`);
  const wav = join(src, `${id}_16k.wav`);
  if (!existsSync(labelsPath) || !existsSync(wav)) throw new Error(`${src} has no ${id}.json / ${id}_16k.wav (run caption-label first)`);
  const other = split === 'test' ? 'train' : 'test';
  if (existsSync(join(repo, other, `${id}.meta.json`))) throw new Error(`${id} is already in ${other}/; a recording must not be in both splits`);

  const labels = filterLabels(JSON.parse(readFileSync(labelsPath, 'utf8')) as Labels, info.minConfidence ?? 0.72);
  const dir = join(repo, split);
  mkdirSync(dir, { recursive: true });
  await run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', join(dir, `${id}.opus`)]);
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(labels, null, 1));
  const meta: RecordingMeta = {
    id,
    split,
    title: info.title ?? id,
    source: info.source ?? '',
    sourceStart: info.sourceStart ?? 0,
    date: info.date ?? null,
    durationSec: Math.round(labels.total_duration),
    labelledSec: Math.round(labels.segments.reduce((s, x) => s + x.end - x.start, 0)),
    segments: labels.segments.length,
    labelledBy: 'caption-label',
    addedAt: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 1) + '\n');
  return meta;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [src, repo] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
  const split = arg('split');
  if (!src || !repo || (split !== 'test' && split !== 'train')) {
    console.error('usage: caption-pack <labelled/<id>> <data-repo> --split test|train [--title …] [--source …] [--date …]');
    process.exit(2);
  }
  const meta = await packRecording(src, repo, split, {
    title: arg('title'),
    source: arg('source'),
    date: arg('date') ?? null,
    minConfidence: Number(arg('min-confidence') ?? 0.72),
  });
  const testMin = listRecordings(repo).filter((m) => m.split === 'test').reduce((s, m) => s + m.durationSec, 0) / 60;
  console.log(`added ${split}/${meta.id} (${(meta.durationSec / 60).toFixed(1)} min, ${meta.segments} segments); test set is now ${testMin.toFixed(0)} min`);
  if (testMin > 60) console.warn('warning: the test set is over 60 minutes; every pull request decodes it in full');
}

if (require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
