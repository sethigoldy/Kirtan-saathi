/**
 * Adds a labelled recording to the private data repository.
 *
 *   node dist/cli/caption-pack.js <labelled/<id>> <data-repo> --split test|train
 *        [--title "…"] [--source "…"] [--date YYYY-MM-DD] [--min-confidence 0.72]
 *
 * Encodes the 16 kHz audio as Opus (about 10 MB per hour), copies the labels
 * (dropping low-confidence segments), and records the recording in
 * manifest.json. Nothing is written to the public repository.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ManifestEntry {
  id: string;
  split: 'test' | 'train';
  title: string;
  source: string;
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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function filterLabels(labels: Labels, minConfidence: number): Labels {
  return { ...labels, segments: labels.segments.filter((s) => s.confidence >= minConfidence) };
}

async function main(): Promise<void> {
  const [src, repo] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
  const split = arg('split');
  if (!src || !repo || (split !== 'test' && split !== 'train')) {
    console.error('usage: caption-pack <labelled/<id>> <data-repo> --split test|train [--title …] [--source …] [--date …]');
    process.exit(2);
  }
  const id = basename(resolve(src));
  const labelsPath = join(src, `${id}.json`);
  const wav = join(src, `${id}_16k.wav`);
  if (!existsSync(labelsPath) || !existsSync(wav)) throw new Error(`${src} has no ${id}.json / ${id}_16k.wav (run caption-label first)`);
  const manifestPath = join(repo, 'manifest.json');
  const manifest = (existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : []) as ManifestEntry[];
  const other = manifest.find((m) => m.id === id && m.split !== split);
  if (other) throw new Error(`${id} is already in ${other.split}/; a recording must not be in both splits`);

  const labels = filterLabels(JSON.parse(readFileSync(labelsPath, 'utf8')) as Labels, Number(arg('min-confidence') ?? 0.72));
  const dir = join(repo, split);
  mkdirSync(dir, { recursive: true });
  await run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', join(dir, `${id}.opus`)]);
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(labels, null, 1));

  const entry: ManifestEntry = {
    id,
    split,
    title: arg('title') ?? id,
    source: arg('source') ?? '',
    date: arg('date') ?? null,
    durationSec: Math.round(labels.total_duration),
    labelledSec: Math.round(labels.segments.reduce((s, x) => s + x.end - x.start, 0)),
    segments: labels.segments.length,
    labelledBy: 'caption-label',
    addedAt: new Date().toISOString().slice(0, 10),
  };
  const next = manifest.filter((m) => m.id !== id).concat(entry).sort((a, b) => a.split.localeCompare(b.split) || a.id.localeCompare(b.id));
  writeFileSync(manifestPath, JSON.stringify(next, null, 1) + '\n');
  const testMin = next.filter((m) => m.split === 'test').reduce((s, m) => s + m.durationSec, 0) / 60;
  console.log(`added ${split}/${id} (${(entry.durationSec / 60).toFixed(1)} min, ${entry.segments} segments); test set is now ${testMin.toFixed(0)} min`);
  if (testMin > 60) console.warn('warning: the test set is over 60 minutes; every pull request decodes it in full');
}

if (require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
