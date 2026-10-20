/**
 * Scores caption labels against known truth (synthetic broadcasts from
 * scripts/make-caption-video.py).
 *
 *   node dist/cli/caption-eval.js <labels.json> <truth.json> [--min-recall 0.9]
 *
 * Reports caption recall (captions whose line was labelled), precision of
 * labelled time, second-by-second agreement, and boundary error.
 */
import { readFileSync } from 'node:fs';

interface Seg { start: number; end: number; line_id: string }

export function evaluateLabels(labels: Seg[], truth: Seg[]) {
  const total = Math.ceil(Math.max(...truth.map((s) => s.end), ...labels.map((s) => s.end), 0));
  const at = (segs: Seg[], t: number) => segs.find((s) => t >= s.start && t < s.end)?.line_id ?? null;
  let agree = 0, labelled = 0, labelledRight = 0, truthTime = 0;
  for (let t = 0.25; t < total; t += 0.5) {
    const g = at(truth, t), p = at(labels, t);
    if (g) truthTime++;
    if (p) labelled++;
    if (p && p === g) labelledRight++;
    if (g && p === g) agree++;
  }
  let found = 0;
  const startErr: number[] = [];
  for (const g of truth) {
    const hit = labels.find((s) => s.line_id === g.line_id && s.start < g.end && s.end > g.start);
    if (hit) {
      found++;
      startErr.push(Math.abs(hit.start - g.start));
    }
  }
  startErr.sort((a, b) => a - b);
  return {
    captions: truth.length,
    captionRecall: found / Math.max(1, truth.length),
    timeAgreement: agree / Math.max(1, truthTime),
    labelPrecision: labelledRight / Math.max(1, labelled),
    medianStartErrorSec: startErr.length ? startErr[Math.floor(startErr.length / 2)] : null,
    p90StartErrorSec: startErr.length ? startErr[Math.floor(startErr.length * 0.9)] : null,
  };
}

if (require.main === module) {
  const labels = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { segments: Seg[] };
  const truth = JSON.parse(readFileSync(process.argv[3], 'utf8')) as Seg[];
  const r = evaluateLabels(labels.segments, truth);
  console.log(JSON.stringify(r, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 1));
  const i = process.argv.indexOf('--min-recall');
  if (i >= 0 && r.captionRecall < Number(process.argv[i + 1])) {
    console.error(`caption recall ${r.captionRecall.toFixed(3)} is below ${process.argv[i + 1]}`);
    process.exit(1);
  }
}
