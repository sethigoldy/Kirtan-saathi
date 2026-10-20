/**
 * Frame-accuracy scorer for the Live Gurbani Captioning benchmark v1.
 *
 * TypeScript port of eval.py from
 * https://github.com/karanbirsingh/live-gurbani-captioning-benchmark-v1
 * (MIT License, Copyright (c) 2026 Karanbir Singh). Same rules: 1 s frames,
 * collar around segment boundaries, gaps accept the neighbouring lines or
 * null, a prediction naming the wrong shabad is always wrong.
 *
 * Usage: node dist/cli/score.js <pred_dir> <gt_dir> [--collar 1]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface GtSegment { start: number; end: number; line_idx: number; shabad_id?: number; verse_id?: number; banidb_gurmukhi?: string; line_id?: string }
export interface GtCase {
  video_id: string;
  shabad_id?: number;
  total_duration: number;
  uem?: { start: number; end: number };
  segments: GtSegment[];
  lines?: { line_idx: number; text: string; shabad_id?: number }[];
  /** 'corpus': line_idx values are global corpus line indices (caption labels). */
  line_space?: 'corpus';
}
export interface PredSegment { start: number; end: number; line_idx?: number | null; shabad_id?: number; verse_id?: number; banidb_gurmukhi?: string }
export interface PredCase { video_id?: string; shabad_id?: number; segments: PredSegment[] }

const NO_MATCH = -999999;

function segmentsToFrames(segments: { start: number; end: number; line_idx?: number | null }[], total: number): (number | null)[] {
  const frames: (number | null)[] = new Array(total).fill(null);
  for (const seg of segments) {
    if (seg.line_idx === undefined || seg.line_idx === null) continue;
    const s = Math.trunc(seg.start), e = Math.trunc(seg.end);
    for (let t = s; t < Math.min(e, total); t++) if (t >= 0) frames[t] = seg.line_idx;
  }
  return frames;
}

function resolve(seg: PredSegment, gt: GtCase): number | null {
  const byShabadLine = new Set<string>();
  const byVerse = new Map<number, number>();
  const byText = new Map<string, number>();
  const byLine = new Set<number>();
  for (const entry of [...(gt.lines ?? []), ...gt.segments] as GtSegment[]) {
    const li = entry.line_idx;
    if (li === undefined || li === null) continue;
    byLine.add(li);
    if (entry.shabad_id !== undefined && entry.shabad_id !== null) byShabadLine.add(`${entry.shabad_id}:${li}`);
    if (entry.verse_id !== undefined && entry.verse_id !== null) byVerse.set(entry.verse_id, li);
    if (entry.banidb_gurmukhi) byText.set(entry.banidb_gurmukhi, li);
  }
  if (seg.shabad_id !== undefined && seg.line_idx !== undefined && seg.line_idx !== null && byShabadLine.has(`${seg.shabad_id}:${seg.line_idx}`)) {
    return seg.line_idx;
  }
  if (seg.verse_id !== undefined && byVerse.has(seg.verse_id)) return byVerse.get(seg.verse_id)!;
  if (seg.banidb_gurmukhi && byText.has(seg.banidb_gurmukhi)) return byText.get(seg.banidb_gurmukhi)!;
  if (seg.shabad_id === undefined && seg.line_idx !== undefined && seg.line_idx !== null && byLine.has(seg.line_idx)) return seg.line_idx;
  return NO_MATCH;
}

export interface CaseScore {
  video_id: string;
  frame_accuracy: number;
  correct: number;
  total: number;
  frames: { t: number; gt: number | null; pred: number | null; ok: boolean }[];
}

export function scoreCase(gt: GtCase, pred: PredCase, collar = 1): CaseScore {
  const uemStart = Math.trunc(gt.uem?.start ?? 0);
  const uemEnd = Math.trunc(gt.uem?.end ?? gt.total_duration);
  const total = Math.trunc(gt.total_duration);
  const gtFrames = segmentsToFrames(gt.segments, total);
  const resolved = pred.segments.map((s) => {
    const seg = { ...s, shabad_id: s.shabad_id ?? pred.shabad_id };
    return { start: s.start, end: s.end, line_idx: resolve(seg, gt) };
  });
  const predFrames = segmentsToFrames(resolved, total);

  const segs = [...gt.segments].sort((a, b) => a.start - b.start);
  const acceptable = new Map<number, Set<number | null>>();
  for (let gi = 0; gi < segs.length; gi++) {
    const seg = segs[gi];
    const s = Math.trunc(seg.start), e = Math.trunc(seg.end);
    const before = gi > 0 ? segs[gi - 1].line_idx : null;
    const after = gi < segs.length - 1 ? segs[gi + 1].line_idx : null;
    for (let t = Math.max(0, s - collar); t < s + collar; t++) {
      const a = new Set<number | null>([seg.line_idx, null]);
      if (before !== null) a.add(before);
      acceptable.set(t, a);
    }
    for (let t = Math.max(0, e - collar); t < e + collar; t++) {
      const a = new Set<number | null>([seg.line_idx, null]);
      if (after !== null) a.add(after);
      acceptable.set(t, a);
    }
  }
  for (let gi = 0; gi < segs.length - 1; gi++) {
    const gs = Math.trunc(segs[gi].end), ge = Math.trunc(segs[gi + 1].start);
    if (ge <= gs) continue;
    for (let t = gs; t < ge; t++) acceptable.set(t, new Set([segs[gi].line_idx, segs[gi + 1].line_idx, null]));
  }

  let correct = 0, count = 0;
  const frames: CaseScore['frames'] = [];
  for (let t = uemStart; t < Math.min(uemEnd, total); t++) {
    const g = gtFrames[t];
    const p = t < predFrames.length ? predFrames[t] : null;
    count++;
    let ok: boolean;
    if (g !== null && p === g) ok = true;
    else if (acceptable.has(t)) ok = acceptable.get(t)!.has(p);
    else ok = g === null;
    if (ok) correct++;
    frames.push({ t, gt: g, pred: p, ok });
  }
  return {
    video_id: gt.video_id,
    frame_accuracy: count ? Math.round((correct / count) * 10000) / 100 : 0,
    correct,
    total: count,
    frames,
  };
}

export function scoreDir(predDir: string, gtDir: string, collar = 1): { cases: CaseScore[]; overall: number } {
  const cases: CaseScore[] = [];
  let correct = 0, total = 0;
  for (const f of readdirSync(gtDir).filter((x) => x.endsWith('.json')).sort()) {
    const gt = JSON.parse(readFileSync(join(gtDir, f), 'utf8')) as GtCase;
    let pred: PredCase = { segments: [] };
    try {
      pred = JSON.parse(readFileSync(join(predDir, f), 'utf8')) as PredCase;
    } catch {
      /* missing prediction = empty */
    }
    const s = scoreCase(gt, pred, collar);
    s.video_id = basename(f, '.json');
    cases.push(s);
    correct += s.correct;
    total += s.total;
  }
  return { cases, overall: total ? Math.round((correct / total) * 10000) / 100 : 0 };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--collar');
  const collar = ci >= 0 ? Number(args[ci + 1]) : 1;
  const [predDir, gtDir] = args.filter((a, i) => !a.startsWith('--') && (ci < 0 || i !== ci + 1));
  const { cases, overall } = scoreDir(predDir, gtDir, collar);
  for (const c of cases) console.log(`${c.video_id.padEnd(22)} ${c.frame_accuracy.toFixed(1).padStart(6)}%  (${c.correct}/${c.total})`);
  console.log(`OVERALL frame accuracy @ collar=${collar}s: ${overall.toFixed(1)}%`);
}
