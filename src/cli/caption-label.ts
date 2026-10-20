/**
 * Labels broadcast recordings that show the Gurbani line as an on-screen
 * caption (Darbar Sahib kirtan, used with SGPC's permission): reads the
 * caption, matches it to a corpus line, and writes time-aligned labels.
 *
 *   node dist/cli/caption-label.js <video|dir> [options]
 *
 *   --out <dir>          output root (default darbar-data/labelled)
 *   --region x,y,w,h     caption band as fractions of the frame (default 0,0.68,1,0.32)
 *   --fps <n>            frames examined per second (default 2)
 *   --tessdata <dir>     Tesseract models with pan.traineddata (default $TESSDATA_PREFIX)
 *   --lang <l>           Tesseract languages (default pan)
 *   --start <s> --duration <s>   label only part of the video
 *   --jobs <n>           parallel OCR processes (default: CPUs)
 *
 * Writes <out>/<id>/:
 *   <id>_16k.wav     16 kHz mono audio
 *   <id>.json        labels in the benchmark's ground-truth format (corpus line space)
 *   captions.json    every caption: time, OCR text, matched line, confidence
 *   review.html      contact sheet for checking the labels by eye
 *   frames/          caption images used by review.html
 *
 * Needs ffmpeg, ffprobe and tesseract on PATH.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Corpus } from '../engine/corpus';
import { stripVishraam, toKey } from '../engine/gurmukhi';
import { Retriever } from '../engine/retrieval';

const run = promisify(execFile);

export interface CaptionOptions {
  region: [number, number, number, number];
  fps: number;
  tessdata: string | null;
  lang: string;
  start: number;
  duration: number | null;
  jobs: number;
}

export const DEFAULT_CAPTION_OPTIONS: CaptionOptions = {
  region: [0, 0.68, 1, 0.32],
  fps: 2,
  tessdata: process.env.TESSDATA_PREFIX ?? null,
  lang: 'pan',
  start: 0,
  duration: null,
  jobs: availableParallelism(),
};

/** A run of frames where the caption band did not change. */
export interface CaptionRun {
  index: number;
  start: number;
  end: number;
  /** Representative frame (grayscale), kept until OCR. */
  frame?: Buffer;
  hasText: boolean;
  ocr?: string;
  match?: CaptionMatch | null;
}

export interface CaptionMatch {
  line: number;
  score: number;
  /** OCR text that matched. */
  query: string;
  how: 'global' | 'context';
}

// ---------------------------------------------------------------------------
// Change detection

const SIG_W = 48;
const SIG_H = 12;

/**
 * Coarse signature of the caption's text pixels. Text is the extreme tone of
 * the band (white or yellow on a dark band, or dark on a light band), so the
 * signature follows the caption, not the video behind a translucent band.
 */
export function signature(frame: Uint8Array, w: number, h: number): { sig: Float32Array; ink: number; light: boolean } {
  const hist = new Uint32Array(256);
  for (let i = 0; i < frame.length; i++) hist[frame[i]]++;
  let acc = 0;
  let median = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= frame.length / 2) {
      median = v;
      break;
    }
  }
  const light = median >= 128; // light band: text is dark
  const sig = new Float32Array(SIG_W * SIG_H);
  let ink = 0;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(SIG_H - 1, Math.floor((y * SIG_H) / h));
    for (let x = 0; x < w; x++) {
      const v = frame[y * w + x];
      const on = light ? v < 80 : v > 185;
      if (on) {
        ink++;
        sig[sy * SIG_W + Math.min(SIG_W - 1, Math.floor((x * SIG_W) / w))]++;
      }
    }
  }
  const cell = (w / SIG_W) * (h / SIG_H);
  for (let i = 0; i < sig.length; i++) sig[i] /= cell;
  return { sig, ink: ink / frame.length, light };
}

export function sigDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

/**
 * Text mask at half resolution: 1 where a pixel is caption ink. Two masks of
 * the same caption differ only by compression noise; a new caption moves
 * most of the ink, even when it has the same length and layout.
 */
export function inkMask(frame: Uint8Array, w: number, h: number, light: boolean): Uint8Array {
  const mw = w >> 1, mh = h >> 1;
  const m = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const v = frame[(y << 1) * w + (x << 1)];
      m[y * mw + x] = (light ? v < 80 : v > 185) ? 1 : 0;
    }
  }
  return m;
}

/** Changed ink as a fraction of the ink present (0 = same caption). */
export function maskChange(a: Uint8Array, b: Uint8Array): number {
  let xor = 0, inkA = 0, inkB = 0;
  for (let i = 0; i < a.length; i++) {
    inkA += a[i];
    inkB += b[i];
    xor += a[i] ^ b[i];
  }
  const ink = Math.max(inkA, inkB);
  return ink === 0 ? 0 : xor / ink;
}

/** A caption counts as changed when this share of its ink moved. */
const CHANGE = 0.3;
const MIN_INK = 0.004;

/** Split frames into runs of an unchanged caption. */
export class RunSplitter {
  readonly runs: CaptionRun[] = [];
  private prev: Uint8Array | null = null;
  private cur: CaptionRun | null = null;
  private frames = 0;

  constructor(private readonly fps: number, private readonly offset: number) {}

  push(frame: Uint8Array, w: number, h: number): void {
    const t = this.offset + this.frames / this.fps;
    this.frames++;
    const { ink, light } = signature(frame, w, h);
    const mask = inkMask(frame, w, h, light);
    const changed = !this.prev || maskChange(mask, this.prev) > CHANGE;
    this.prev = mask;
    if (changed || !this.cur) {
      if (this.cur) this.cur.end = t;
      this.cur = { index: this.runs.length, start: t, end: t, hasText: ink > MIN_INK };
      this.runs.push(this.cur);
      return;
    }
    // Second unchanged frame: the caption has settled; keep it for OCR.
    if (!this.cur.frame && this.cur.hasText) this.cur.frame = Buffer.from(frame);
  }

  finish(): CaptionRun[] {
    if (this.cur) this.cur.end = this.offset + this.frames / this.fps;
    // Single-frame runs are transitions (fades, wipes); drop them.
    return this.runs.filter((r) => r.frame || !r.hasText);
  }
}

// ---------------------------------------------------------------------------
// Matching OCR text to corpus lines

const GURMUKHI = /[਀-੿]/g;

export class CaptionMatcher {
  private selfCache = new Map<number, number>();

  constructor(private readonly corpus: Corpus, private readonly retriever: Retriever) {}

  /** Alignment of `key` against one line, normalised both ways (F1-like). */
  scoreLine(key: string, line: number): number {
    const r = this.retriever.alignLines(key, [line], 1);
    if (r.querySelf <= 0) return 0;
    const sw = r.score * r.querySelf;
    let self = this.selfCache.get(line);
    if (self === undefined) {
      self = this.retriever.alignLines(this.corpus.key[line], [line], 1).querySelf;
      this.selfCache.set(line, self);
    }
    const p = sw / r.querySelf;
    const q = self > 0 ? sw / self : 0;
    return p + q > 0 ? (2 * p * q) / (p + q) : 0;
  }

  /** Candidate OCR queries: each Gurmukhi line, and adjacent pairs (wrapped captions). */
  static queries(ocr: string): string[] {
    const lines = ocr
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => (l.match(GURMUKHI)?.length ?? 0) >= 2);
    const out = [...lines];
    for (let i = 0; i + 1 < lines.length; i++) out.push(`${lines[i]} ${lines[i + 1]}`);
    return out;
  }

  /**
   * Candidate lines anywhere in the corpus, best first. Lines with the same
   * text (refrains, repeated tuks) tie; matchRuns breaks ties by position.
   */
  matchGlobal(ocr: string): CaptionMatch[] {
    const best = new Map<number, CaptionMatch>();
    for (const q of CaptionMatcher.queries(ocr)) {
      const key = toKey(q);
      if (key.length < 6) continue;
      const res = this.retriever.search(key);
      for (const hit of res.shabads.slice(0, 8)) {
        const s = this.corpus.shabads[hit.shabad];
        for (let l = Math.max(s.start, hit.line - 2); l <= Math.min(s.start + s.count - 1, hit.line + 2); l++) {
          const score = this.scoreLine(key, l);
          const cur = best.get(l);
          if (!cur || score > cur.score) best.set(l, { line: l, score, query: q, how: 'global' });
        }
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  }

  /** Best line within given shabads (neighbouring captions' shabads). */
  matchWithin(ocr: string, shabads: Iterable<number>): CaptionMatch | null {
    let best: CaptionMatch | null = null;
    for (const q of CaptionMatcher.queries(ocr)) {
      const key = toKey(q);
      // Short captions (headings such as "॥ ਜਪੁ ॥") are only matched here,
      // inside a known shabad, where they are unambiguous.
      if (key.length < 2) continue;
      for (const s of shabads) {
        for (const l of this.corpus.linesOf(s)) {
          const score = this.scoreLine(key, l);
          // A short query must match almost exactly to count.
          if (key.length < 6 && score < 0.9) continue;
          if (!best || score > best.score) best = { line: l, score, query: q, how: 'context' };
        }
      }
    }
    return best;
  }
}

/** Accept thresholds: a confident global match, or a weaker one inside the neighbours' shabad. */
export const ACCEPT_GLOBAL = 0.72;
export const ACCEPT_CONTEXT = 0.5;

/**
 * Match every caption, then use shabad continuity: captions follow one
 * shabad for minutes, so a weak OCR result is re-scored against the shabads
 * of the nearest confident captions before and after it.
 */
export function matchRuns(matcher: CaptionMatcher, corpus: Corpus, runs: CaptionRun[]): void {
  // Global pass. Identical lines tie on score: take the one nearest after
  // the previous caption's line (captions move forward through a shabad).
  let prevLine: number | null = null;
  for (const r of runs) {
    const cands = r.ocr ? matcher.matchGlobal(r.ocr) : [];
    const top = cands[0];
    if (!top) {
      r.match = null;
      continue;
    }
    const ties = cands.filter((c) => c.score >= top.score - 0.02);
    const dist = (l: number) => (prevLine === null ? 0 : l > prevLine ? l - prevLine : 10_000 + prevLine - l);
    r.match = ties.reduce((a, b) => (dist(b.line) < dist(a.line) ? b : a));
    if (r.match.score >= ACCEPT_GLOBAL) prevLine = r.match.line;
  }
  const confident = (r: CaptionRun) => !!r.match && r.match.how === 'global' && r.match.score >= ACCEPT_GLOBAL;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (!r.ocr || confident(r)) continue;
    const near = new Set<number>();
    for (let j = i - 1; j >= 0 && near.size < 1; j--) if (confident(runs[j])) near.add(corpus.shabadOf[runs[j].match!.line]);
    for (let j = i + 1; j < runs.length && near.size < 2; j++) if (confident(runs[j])) near.add(corpus.shabadOf[runs[j].match!.line]);
    const ctx = near.size ? matcher.matchWithin(r.ocr, near) : null;
    r.match = ctx && ctx.score >= ACCEPT_CONTEXT ? ctx : r.match && r.match.score >= ACCEPT_GLOBAL ? r.match : null;
  }
}

// ---------------------------------------------------------------------------
// Labels

export interface LabelSegment {
  start: number;
  end: number;
  line_id: string;
  line_idx: number;
  shabad: string;
  banidb_gurmukhi: string;
  confidence: number;
}

/** Caption runs → label segments; consecutive runs of the same line merge. */
export function toSegments(corpus: Corpus, runs: CaptionRun[]): LabelSegment[] {
  const out: LabelSegment[] = [];
  for (const r of runs) {
    if (!r.match) continue;
    const line = r.match.line;
    const last = out[out.length - 1];
    if (last && last.line_idx === line && r.start - last.end < 1.5) {
      last.end = r.end;
      last.confidence = Math.max(last.confidence, r.match.score);
      continue;
    }
    out.push({
      start: Math.round(r.start * 100) / 100,
      end: Math.round(r.end * 100) / 100,
      line_id: corpus.lineId[line],
      line_idx: line,
      shabad: corpus.shabads[corpus.shabadOf[line]].id,
      banidb_gurmukhi: stripVishraam(corpus.text[line]),
      confidence: Math.round(r.match.score * 1000) / 1000,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Video I/O

async function probe(video: string): Promise<{ width: number; height: number; duration: number }> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', video,
  ]);
  const j = JSON.parse(stdout) as { streams: { width: number; height: number }[]; format: { duration: string } };
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
}

function crop(info: { width: number; height: number }, region: CaptionOptions['region']) {
  const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
  const cw = even(info.width * region[2]);
  const ch = even(info.height * region[3]);
  const cx = Math.min(info.width - cw, Math.floor(info.width * region[0]));
  const cy = Math.min(info.height - ch, Math.floor(info.height * region[1]));
  // OCR likes ~1600 px wide text lines; upscale small sources, cap large ones.
  const ow = even(Math.min(2400, Math.max(1600, cw)));
  const oh = even((ch * ow) / cw);
  return { cw, ch, cx, cy, ow, oh };
}

function trimArgs(o: CaptionOptions): string[] {
  const a: string[] = [];
  if (o.start > 0) a.push('-ss', String(o.start));
  if (o.duration !== null) a.push('-t', String(o.duration));
  return a;
}

async function extractAudio(video: string, out: string, o: CaptionOptions): Promise<void> {
  await run('ffmpeg', ['-y', '-v', 'error', ...trimArgs(o), '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], {
    maxBuffer: 1 << 20,
  });
}

/** Stream caption-band frames through the run splitter. */
function scanFrames(video: string, o: CaptionOptions, c: ReturnType<typeof crop>): Promise<CaptionRun[]> {
  return new Promise((resolvePromise, reject) => {
    const vf = `fps=${o.fps},crop=${c.cw}:${c.ch}:${c.cx}:${c.cy},scale=${c.ow}:${c.oh}:flags=bicubic,format=gray`;
    const ff = spawn('ffmpeg', ['-v', 'error', ...trimArgs(o), '-i', video, '-an', '-vf', vf, '-f', 'rawvideo', '-'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const size = c.ow * c.oh;
    const splitter = new RunSplitter(o.fps, 0);
    let pending: Buffer = Buffer.alloc(0);
    let err = '';
    ff.stdout.on('data', (d: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d;
      while (pending.length >= size) {
        splitter.push(pending.subarray(0, size), c.ow, c.oh);
        pending = pending.subarray(size);
      }
    });
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolvePromise(splitter.finish()) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))));
  });
}

/** Text as dark-on-light, the way Tesseract reads best. */
function toPgm(frame: Buffer, w: number, h: number): Buffer {
  const { light } = signature(frame, w, h);
  const px = Buffer.from(frame);
  if (!light) for (let i = 0; i < px.length; i++) px[i] = 255 - px[i];
  return Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), px]);
}

async function ocrAll(runs: CaptionRun[], dir: string, o: CaptionOptions, c: ReturnType<typeof crop>): Promise<void> {
  const todo = runs.filter((r) => r.frame);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const r = todo[next++];
      const file = join(dir, `${String(r.index).padStart(5, '0')}.pgm`);
      writeFileSync(file, toPgm(r.frame!, c.ow, c.oh));
      r.frame = undefined;
      const args = [file, 'stdout', '-l', o.lang, '--psm', '6'];
      if (o.tessdata) args.push('--tessdata-dir', o.tessdata);
      const { stdout } = await run('tesseract', args, { maxBuffer: 1 << 20 });
      r.ocr = stdout.trim();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.jobs) }, worker));
}

async function thumbnails(dir: string): Promise<void> {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.pgm'))) {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', join(dir, f), '-vf', 'scale=640:-2', '-q:v', '5', join(dir, f.replace('.pgm', '.jpg'))]);
    rmSync(join(dir, f));
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function reviewHtml(id: string, corpus: Corpus, runs: CaptionRun[], segments: LabelSegment[]): string {
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const rows = runs
    .filter((r) => r.ocr !== undefined)
    .map((r) => {
      const m = r.match;
      const cls = !m ? 'none' : m.score >= ACCEPT_GLOBAL ? 'good' : 'weak';
      const img = `frames/${String(r.index).padStart(5, '0')}.jpg`;
      const line = m ? `${esc(stripVishraam(corpus.text[m.line]))}<small>${esc(corpus.shabads[corpus.shabadOf[m.line]].id)} · ${m.how} · ${m.score.toFixed(2)}</small>` : '<em>no match</em>';
      return `<tr class="${cls}"><td>${fmt(r.start)}–${fmt(r.end)}</td><td><img src="${img}" loading="lazy" alt=""></td><td lang="pa">${line}</td><td lang="pa" class="ocr">${esc(r.ocr ?? '')}</td></tr>`;
    })
    .join('\n');
  const labelled = segments.reduce((s, x) => s + (x.end - x.start), 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(id)} captions</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px;background:#f7f5f0;color:#1d1a16}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:6px 8px;vertical-align:top}
img{width:320px;display:block}td[lang=pa]{font-size:18px}small{display:block;color:#777;font-size:12px}
.ocr{color:#888;font-size:13px!important;white-space:pre-wrap;max-width:320px}
tr.weak{background:#fff6dd}tr.none{background:#fde8e6}
</style></head><body><h1>${esc(id)}</h1>
<p>${segments.length} labelled segments covering ${fmt(labelled)}. Yellow rows matched only through neighbouring captions; red rows did not match.</p>
<table><tr><th>Time</th><th>Caption</th><th>Matched line</th><th>OCR</th></tr>
${rows}</table></body></html>`;
}

// ---------------------------------------------------------------------------

export async function labelVideo(
  corpus: Corpus,
  matcher: CaptionMatcher,
  video: string,
  outRoot: string,
  o: CaptionOptions,
): Promise<{ id: string; segments: LabelSegment[]; runs: CaptionRun[] }> {
  const id = basename(video, extname(video)).replace(/[^\w.-]+/g, '_');
  const dir = join(outRoot, id);
  const frames = join(dir, 'frames');
  mkdirSync(frames, { recursive: true });
  const info = await probe(video);
  const c = crop(info, o.region);
  const t0 = Date.now();
  await extractAudio(video, join(dir, `${id}_16k.wav`), o);
  const runs = await scanFrames(video, o, c);
  await ocrAll(runs, frames, o, c);
  matchRuns(matcher, corpus, runs);
  const segments = toSegments(corpus, runs);
  const duration = Math.max(0, (o.duration ?? info.duration - o.start));
  const gt = {
    video_id: id,
    total_duration: Math.round(duration * 100) / 100,
    uem: { start: 0, end: Math.round(duration * 100) / 100 },
    line_space: 'corpus',
    source: { video: basename(video), start: o.start, labelled_by: 'caption-label', corpus: `${corpus.provenance.name} ${corpus.provenance.version}` },
    segments,
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(gt, null, 1));
  writeFileSync(
    join(dir, 'captions.json'),
    JSON.stringify(
      runs.map((r) => ({
        start: r.start,
        end: r.end,
        text: r.hasText,
        ocr: r.ocr,
        line_id: r.match ? corpus.lineId[r.match.line] : null,
        score: r.match ? Math.round(r.match.score * 1000) / 1000 : null,
        how: r.match?.how ?? null,
      })),
      null,
      1,
    ),
  );
  await thumbnails(frames);
  writeFileSync(join(dir, 'review.html'), reviewHtml(id, corpus, runs, segments));
  const ocrd = runs.filter((r) => r.ocr !== undefined).length;
  const matched = runs.filter((r) => r.match).length;
  const covered = segments.reduce((s, x) => s + x.end - x.start, 0);
  console.log(
    `${id}: ${(duration / 60).toFixed(1)} min, ${ocrd} captions read, ${matched} matched, ` +
      `${segments.length} segments covering ${((100 * covered) / Math.max(1, duration)).toFixed(0)}% ` +
      `(${((Date.now() - t0) / 1000).toFixed(0)} s) → ${dir}`,
  );
  return { id, segments, runs };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) {
    console.error('usage: caption-label <video|dir> [--out dir] [--region x,y,w,h] [--fps n] [--tessdata dir] [--start s] [--duration s]');
    process.exit(2);
  }
  const o: CaptionOptions = { ...DEFAULT_CAPTION_OPTIONS };
  if (arg('region')) o.region = arg('region')!.split(',').map(Number) as CaptionOptions['region'];
  if (arg('fps')) o.fps = Number(arg('fps'));
  if (arg('tessdata')) o.tessdata = resolve(arg('tessdata')!);
  if (arg('lang')) o.lang = arg('lang')!;
  if (arg('start')) o.start = Number(arg('start'));
  if (arg('duration')) o.duration = Number(arg('duration'));
  if (arg('jobs')) o.jobs = Number(arg('jobs'));
  const outRoot = resolve(arg('out') ?? 'darbar-data/labelled');
  const corpus = Corpus.load(resolve(arg('corpus') ?? 'resources/corpus.json.gz'));
  const matcher = new CaptionMatcher(corpus, new Retriever(corpus));
  const videos = statSync(input).isDirectory()
    ? readdirSync(input)
        .filter((f) => /\.(mp4|mkv|webm|mov|ts|m4v)$/i.test(f))
        .sort()
        .map((f) => join(input, f))
    : [input];
  if (!existsSync(videos[0] ?? '')) throw new Error(`no videos found at ${input}`);
  for (const v of videos) await labelVideo(corpus, matcher, v, outRoot, o);
}

if (require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
