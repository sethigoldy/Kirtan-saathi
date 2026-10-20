import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCase, type GtCase } from '../cli/score';

const gt: GtCase = {
  video_id: 'x',
  total_duration: 30,
  uem: { start: 0, end: 30 },
  segments: [
    { start: 2, end: 10, line_idx: 1, shabad_id: 7 },
    { start: 14, end: 24, line_idx: 2, shabad_id: 7 },
  ],
};

test('perfect prediction scores 100', () => {
  const s = scoreCase(gt, { segments: gt.segments.map((x) => ({ ...x })) });
  assert.equal(s.frame_accuracy, 100);
});

test('empty prediction is only right in gaps, collars and unlabelled frames', () => {
  const s = scoreCase(gt, { segments: [] });
  assert.ok(s.frame_accuracy > 0 && s.frame_accuracy < 60, String(s.frame_accuracy));
});

test('naming the wrong shabad is always wrong', () => {
  const s = scoreCase(gt, { segments: gt.segments.map((x) => ({ ...x, shabad_id: 99 })) });
  const empty = scoreCase(gt, { segments: [] });
  assert.ok(s.frame_accuracy <= empty.frame_accuracy);
});
