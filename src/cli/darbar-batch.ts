/**
 * Builds the Darbar Sahib dataset in bulk: lists SGPC's archived kirtan
 * streams, and runs several workers in parallel that each download part of a
 * stream, read its captions, label it and pack it into the private data
 * repository. Used with SGPC's permission; run it on your own computer
 * (YouTube refuses cloud servers).
 *
 *   node dist/cli/darbar-batch.js --data ../kirtan-saathi-data --count 100 [options]
 *
 *   --count <n>            target number of recordings from this source (default 100)
 *   --workers <n>          videos processed at the same time (default 3)
 *   --shard <i>/<n>        this computer's share when several computers help (default 1/1)
 *   --source <url>         channel tab or playlist (default: SGPC live-stream archive)
 *   --local <dir>          use video files from a folder instead of YouTube
 *   --train-minutes <m>    minutes taken from each training stream (default 60)
 *   --test-minutes <m>     minutes taken from each test stream (default 8)
 *   --test-every <k>       about one stream in k goes to test/ (default 14)
 *   --min-coverage <f>     reject a recording when captions cover less than this (default 0.25)
 *   --push                 commit and push the data repository every 5 recordings
 *   --recalibrate          find the caption area again
 *   --keep-review          keep review pages for training recordings too
 *   --cookies-from-browser <b>   passed to yt-dlp if YouTube asks you to sign in
 *   --dry-run              only list what would be processed
 *
 * Needs yt-dlp (for YouTube), ffmpeg and tesseract on PATH. The Gurmukhi
 * OCR model is downloaded on first use. Stop it at any time; finished and
 * rejected streams are skipped on the next run.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Corpus } from '../engine/corpus';
import { Retriever } from '../engine/retrieval';
import { CaptionMatcher, DEFAULT_CAPTION_OPTIONS, labelVideo, type CaptionOptions } from './caption-label';
import { listRecordings, packRecording, type Split } from './caption-pack';

const run = promisify(execFile);

export const SGPC_STREAMS = 'https://www.youtube.com/c/SGPCAmritsar-official/streams';
const PAN_MODEL = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/pan.traineddata';

export interface Candidate {
  /** Recording id in the data repository. */
  id: string;
  url: string;
  title: string;
  duration: number;
  date: string | null;
  local?: string;
}

// ---------------------------------------------------------------------------
// Selection (pure, unit-tested)

/** Captioned kirtan streams only: no audio-only streams, katha or hukamnama. */
export function isKirtanStream(title: string, liveStatus = 'was_live'): boolean {
  if (liveStatus === 'is_live' || liveStatus === 'is_upcoming') return false;
  return /gurbani\s+kirtan/i.test(title) && !/\(audio\)|katha|hukamnama/i.test(title);
}

/** "… | 20.10.2026" → "2026-10-20". */
export function dateFromTitle(title: string): string | null {
  const m = title.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** FNV-1a: stable across computers, so shards and splits agree. */
export function hash(s: string, salt = ''): number {
  let h = 0x811c9dc5;
  for (const ch of salt + s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function inShard(id: string, shard: [number, number]): boolean {
  return hash(id, 'shard') % shard[1] === shard[0] - 1;
}

export function splitFor(id: string, testEvery: number): Split {
  return hash(id, 'split') % testEvery === 0 ? 'test' : 'train';
}

/** A window inside the stream: avoids the first and last 10% (ardas, announcements). */
export function windowFor(id: string, duration: number, minutes: number): { start: number; length: number } {
  const length = Math.min(duration * 0.8, minutes * 60);
  const lo = duration * 0.1;
  const hi = Math.max(lo, duration * 0.9 - length);
  const start = lo + ((hash(id, 'window') % 10_000) / 10_000) * (hi - lo);
  return { start: Math.round(start / 10) * 10, length: Math.round(length) };
}

// ---------------------------------------------------------------------------
// Tools

async function need(cmd: string, args: string[], hint: string): Promise<void> {
  try {
    await run(cmd, args);
  } catch {
    throw new Error(`${cmd} not found. ${hint}`);
  }
}

async function tessdata(): Promise<string> {
  const dir = process.env.TESSDATA_PREFIX ?? join(homedir(), '.cache', 'kirtan-saathi', 'tessdata');
  const file = join(dir, 'pan.traineddata');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    console.log(`downloading the Gurmukhi OCR model to ${dir}`);
    const res = await fetch(PAN_MODEL);
    if (!res.ok) throw new Error(`could not download ${PAN_MODEL}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return dir;
}

async function listYoutube(source: string, ytArgs: string[]): Promise<Candidate[]> {
  const { stdout } = await run(
    'yt-dlp',
    [...ytArgs, '--flat-playlist', '--playlist-end', '1500', '--print', '%(id)s\t%(duration)s\t%(live_status)s\t%(title)s', source],
    { maxBuffer: 64 << 20 },
  );
  const out: Candidate[] = [];
  for (const line of stdout.split('\n')) {
    const [vid, dur, live, ...rest] = line.split('\t');
    const title = rest.join('\t');
    const duration = Number(dur);
    if (!vid || !Number.isFinite(duration) || duration < 1800 || !isKirtanStream(title, live)) continue;
    out.push({ id: `sgpc-${vid}`, url: `https://www.youtube.com/watch?v=${vid}`, title, duration, date: dateFromTitle(title) });
  }
  return out;
}

async function listLocal(dir: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const f of readdirSync(dir).filter((x) => /\.(mp4|mkv|webm|mov|ts|m4v)$/i.test(x)).sort()) {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, f)]);
    const id = f.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
    out.push({ id, url: join(dir, f), title: f, duration: Number(stdout.trim()), date: dateFromTitle(f), local: join(dir, f) });
  }
  return out;
}

/** Download only the part of the stream we label (720p is enough for captions). */
async function fetchWindow(c: Candidate, start: number, length: number, out: string, ytArgs: string[]): Promise<{ file: string; start: number; duration: number | null }> {
  if (c.local) return { file: c.local, start, duration: length };
  await run(
    'yt-dlp',
    [...ytArgs, '-f', 'bv*[height<=720]+ba/b[height<=720]', '--merge-output-format', 'mp4', '--download-sections', `*${start}-${start + length}`,
      '-o', out, '--no-progress', '--quiet', '--no-warnings', c.url],
    { maxBuffer: 16 << 20 },
  );
  return { file: out, start: 0, duration: null };
}

// ---------------------------------------------------------------------------
// Caption area

const REGIONS: { name: string; region: CaptionOptions['region'] }[] = [
  { name: 'bottom third', region: [0, 0.68, 1, 0.32] },
  { name: 'bottom quarter', region: [0, 0.75, 1, 0.25] },
  { name: 'bottom half', region: [0, 0.5, 1, 0.5] },
  { name: 'lower middle', region: [0, 0.55, 1, 0.3] },
  { name: 'top quarter', region: [0, 0, 1, 0.25] },
];

interface Calibration {
  source: string;
  region: CaptionOptions['region'];
  name: string;
  coverage: number;
  calibratedOn: string;
  at: string;
}

const coverageOf = (segments: { start: number; end: number }[], duration: number) =>
  segments.reduce((s, x) => s + x.end - x.start, 0) / Math.max(1, duration);

/** Try each candidate caption area on a few minutes of one stream; keep the one that reads Gurbani. */
async function calibrate(
  corpus: Corpus,
  matcher: CaptionMatcher,
  c: Candidate,
  work: string,
  base: CaptionOptions,
  ytArgs: string[],
): Promise<Calibration> {
  const { start } = windowFor(c.id, c.duration, 3);
  const clip = await fetchWindow(c, start, 180, join(work, 'videos', `calibrate-${c.id}.mp4`), ytArgs);
  let best: Calibration | null = null;
  for (const r of REGIONS) {
    const o = { ...base, region: r.region, start: clip.start, duration: clip.duration };
    const res = await labelVideo(corpus, matcher, clip.file, join(work, 'calibrate', r.name.replace(/\s+/g, '-')), o);
    const cov = coverageOf(res.segments, 180);
    console.log(`  caption area "${r.name}": ${(cov * 100).toFixed(0)}% of the clip labelled`);
    if (!best || cov > best.coverage) {
      best = { source: c.url, region: r.region, name: r.name, coverage: cov, calibratedOn: c.id, at: new Date().toISOString() };
    }
  }
  if (!c.local) rmSync(clip.file, { force: true });
  return best!;
}

// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const repo = resolve(arg('data') ?? '../kirtan-saathi-data');
  const count = Number(arg('count') ?? 100);
  const workers = Math.max(1, Number(arg('workers') ?? 3));
  const shardArg = (arg('shard') ?? '1/1').split('/').map(Number) as [number, number];
  const trainMin = Number(arg('train-minutes') ?? 60);
  const testMin = Number(arg('test-minutes') ?? 8);
  const testEvery = Number(arg('test-every') ?? 14);
  const minCoverage = Number(arg('min-coverage') ?? 0.25);
  const ytArgs = arg('cookies-from-browser') ? ['--cookies-from-browser', arg('cookies-from-browser')!] : [];
  const local = arg('local');
  const source = local ?? arg('source') ?? SGPC_STREAMS;
  if (!existsSync(join(repo, '.git'))) throw new Error(`clone the private data repository to ${repo} first (or pass --data)`);
  if (!(shardArg[0] >= 1 && shardArg[0] <= shardArg[1])) throw new Error('--shard must look like 1/3');

  await need('ffmpeg', ['-version'], 'Install ffmpeg (macOS: brew install ffmpeg; Windows: winget install ffmpeg).');
  await need('tesseract', ['--version'], 'Install Tesseract (macOS: brew install tesseract; Windows: winget install UB-Mannheim.TesseractOCR).');
  if (!local) await need('yt-dlp', ['--version'], 'Install yt-dlp (macOS: brew install yt-dlp; Windows: winget install yt-dlp).');
  const tess = await tessdata();

  const work = resolve('darbar-data');
  mkdirSync(join(work, 'videos'), { recursive: true });
  mkdirSync(join(repo, 'rejected'), { recursive: true });

  console.log(`listing ${source}`);
  const all = local ? await listLocal(local) : await listYoutube(source, ytArgs);
  const done = new Set(listRecordings(repo).map((m) => m.id));
  const rejected = new Set(readdirSync(join(repo, 'rejected')).map((f) => f.replace(/\.json$/, '')));
  const fromSource = all.filter((c) => done.has(c.id)).length;
  const todo = all.filter((c) => !done.has(c.id) && !rejected.has(c.id) && inShard(c.id, shardArg));
  const wanted = Math.max(0, Math.ceil((count - fromSource) / shardArg[1]));
  console.log(
    `${all.length} kirtan streams listed; ${fromSource} already in the data repository, ${rejected.size} rejected; ` +
      `this computer (shard ${shardArg.join('/')}) will add up to ${wanted} from ${todo.length} remaining`,
  );
  if (flag('dry-run')) {
    for (const c of todo.slice(0, wanted)) console.log(`  ${c.id}  ${(c.duration / 3600).toFixed(1)} h  ${splitFor(c.id, testEvery)}  ${c.title}`);
    return;
  }
  if (!wanted || !todo.length) return;

  const corpus = Corpus.load(resolve('resources/corpus.json.gz'));
  const matcher = new CaptionMatcher(corpus, new Retriever(corpus));
  const ocrJobs = Math.max(1, Math.floor(availableParallelism() / workers));
  const base: CaptionOptions = { ...DEFAULT_CAPTION_OPTIONS, tessdata: tess, jobs: ocrJobs };

  // Caption area: shared by every computer through the data repository.
  const calFile = join(repo, 'caption-region.json');
  let cal: Calibration | null = existsSync(calFile) && !flag('recalibrate') ? (JSON.parse(readFileSync(calFile, 'utf8')) as Calibration) : null;
  if (!cal) {
    console.log(`finding the caption area on ${todo[0].id}`);
    cal = await calibrate(corpus, matcher, todo[0], work, base, ytArgs);
    if (cal.coverage < 0.15) {
      throw new Error(
        `could not read Gurbani captions in any caption area (best: ${cal.name}, ${(cal.coverage * 100).toFixed(0)}%). ` +
          `Open ${join(work, 'calibrate')} and share a review.html or a screenshot of the video.`,
      );
    }
    writeFileSync(calFile, JSON.stringify(cal, null, 1) + '\n');
    console.log(`caption area: ${cal.name} (${(cal.coverage * 100).toFixed(0)}% of the test clip labelled)`);
  }
  const options: CaptionOptions = { ...base, region: cal.region };

  // Commits are serialized; pushes rebase first so several computers can share the repository.
  let sincePush = 0;
  let gitChain: Promise<void> = Promise.resolve();
  const commit = (message: string, force = false) => {
    if (!flag('push')) return gitChain;
    sincePush++;
    if (sincePush < 5 && !force) return gitChain;
    sincePush = 0;
    gitChain = gitChain.then(async () => {
      const g = (...a: string[]) => run('git', ['-C', repo, ...a], { maxBuffer: 16 << 20 });
      await g('add', '-A');
      const { stdout } = await g('status', '--porcelain');
      if (!stdout.trim()) return;
      await g('commit', '-q', '-m', message);
      await g('pull', '-q', '--rebase');
      await g('push', '-q');
      console.log(`  pushed: ${message}`);
    });
    return gitChain;
  };

  let next = 0;
  let added = 0;
  let failed = 0;
  const t0 = Date.now();
  const worker = async (w: number) => {
    while (added < wanted && next < todo.length) {
      const c = todo[next++];
      const split = splitFor(c.id, testEvery);
      const win = windowFor(c.id, c.duration, split === 'test' ? testMin : trainMin);
      const label = `[w${w}] ${c.id} (${c.date ?? '?'}, ${Math.round(win.length / 60)} min from ${Math.round(win.start / 60)} min)`;
      const video = join(work, 'videos', `${c.id}.mp4`);
      try {
        const clip = await fetchWindow(c, win.start, win.length, video, ytArgs);
        const res = await labelVideo(corpus, matcher, clip.file, join(work, 'labelled'), { ...options, start: clip.start, duration: clip.duration });
        const coverage = coverageOf(res.segments, win.length);
        if (coverage < minCoverage) {
          writeFileSync(
            join(repo, 'rejected', `${c.id}.json`),
            JSON.stringify({ id: c.id, url: c.url, title: c.title, reason: 'few readable captions', coverage: Math.round(coverage * 100) / 100 }, null, 1) + '\n',
          );
          console.log(`${label}: only ${(coverage * 100).toFixed(0)}% labelled, rejected`);
        } else {
          const labelledDir = join(work, 'labelled', res.id);
          const meta = await packRecording(labelledDir, repo, split, {
            title: c.title,
            source: c.url,
            sourceStart: win.start,
            date: c.date,
          });
          added++;
          console.log(`${label}: ${meta.segments} segments, ${(coverage * 100).toFixed(0)}% labelled → ${split}/ (${added}/${wanted})`);
          if (split === 'train' && !flag('keep-review')) rmSync(labelledDir, { recursive: true, force: true });
          else rmSync(join(labelledDir, `${res.id}_16k.wav`), { force: true });
        }
        await commit(`Add ${added} recording(s) from SGPC streams`);
      } catch (e) {
        failed++;
        console.error(`${label}: failed: ${String((e as Error).message ?? e).split('\n')[0]}`);
        if (failed >= 5 && added === 0) throw new Error('the first five streams all failed; stopping (see the errors above)');
      } finally {
        if (!c.local) rmSync(video, { force: true });
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, (_, i) => worker(i + 1)));
  await commit('Add recordings from SGPC streams', true);
  const hours = (Date.now() - t0) / 3.6e6;
  console.log(`\nadded ${added} recordings in ${hours.toFixed(1)} h (${failed} failed). Test set: ${listRecordings(repo).filter((m) => m.split === 'test').reduce((s, m) => s + m.durationSec, 0) / 60} min.`);
  if (!flag('push')) console.log(`commit the data repository:  git -C "${repo}" add -A && git -C "${repo}" commit -m "Add SGPC recordings" && git -C "${repo}" push`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
