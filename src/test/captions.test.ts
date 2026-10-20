import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Corpus } from '../engine/corpus';
import { Retriever } from '../engine/retrieval';
import { CaptionMatcher, inkMask, maskChange, matchRuns, toSegments, type CaptionRun } from '../cli/caption-label';
import { normalizeGt } from '../cli/bench';
import { filterLabels } from '../cli/caption-pack';
import type { GtCase } from '../cli/score';

const corpus = Corpus.load(resolve(__dirname, '../../resources/corpus.json.gz'));
const matcher = new CaptionMatcher(corpus, new Retriever(corpus));
const lineOf = (text: string) => corpus.text.findIndex((t) => t.replace(/[;.,]/g, '') === text);

test('ink mask change separates a new caption from compression noise', () => {
  const w = 40, h = 10;
  const a = new Uint8Array(w * h).fill(20);
  for (let x = 4; x < 20; x++) a[2 * w + x] = 230; // a white "word" on a dark band
  const noisy = a.map((v) => (v > 128 ? v - 10 : v + 5));
  const moved = new Uint8Array(w * h).fill(20);
  for (let x = 22; x < 38; x++) moved[2 * w + x] = 230;
  const m = (f: Uint8Array) => inkMask(f, w, h, false);
  assert.equal(maskChange(m(a), m(noisy)), 0);
  assert.ok(maskChange(m(a), m(moved)) > 0.9);
});

test('OCR with errors still finds the right line; translations do not', () => {
  const ocr = 'ਸੋਚੈ ਸੋਚਿ ਨ ਹੋਵਈ ਜੇ ਸੋਚੀ ਲਖ ਵਾਰ ॥\nਜੇ ਮੈਂ ਲੱਖ ਵਾਰੀ 1ਭੀ(! ਇਸ਼ਨਾਨ ਕਰਾਂ';
  const best = matcher.matchGlobal(ocr)[0];
  assert.equal(best.line, lineOf('ਸੋਚੈ ਸੋਚਿ ਨ ਹੋਵਈ ਜੇ ਸੋਚੀ ਲਖ ਵਾਰ ॥'));
  assert.ok(best.score > 0.9);
  const prose = matcher.matchGlobal('ਜਿਹੜੇ ਮਨੁੱਖ ਗੁਰੂ ਦੀ ਸੰਗਤ ਵਿਚ ਰਹਿ ਕੇ ਗੁਣ ਗਾਂਦੇ ਹਨ')[0];
  assert.ok(!prose || prose.score < 0.72, 'a Punjabi translation line is not taken for Gurbani');
});

test('repeated lines go to the copy after the previous caption; short headings match in context', () => {
  const runs: CaptionRun[] = [
    { index: 0, start: 0, end: 5, hasText: true, ocr: 'ਤੀਰਥਿ ਨਾਵਾ ਜੇ ਤਿਸੁ ਭਾਵਾ ਵਿਣੁ ਭਾਣੇ ਕਿ ਨਾਇ ਕਰੀ ॥' },
    { index: 1, start: 5, end: 9, hasText: true, ocr: 'ਗੁਰਾ ਇਕ ਦੇਹਿ ਬੁਝਾਈ ॥' },
  ];
  matchRuns(matcher, corpus, runs);
  const first = runs[0].match!.line;
  const second = runs[1].match!.line;
  assert.equal(corpus.text[second].replace(/[;.,]/g, ''), 'ਗੁਰਾ ਇਕ ਦੇਹਿ ਬੁਝਾਈ ॥');
  assert.ok(second > first && second - first < 10, 'the refrain is taken from the same pauri');

  const heading: CaptionRun[] = [
    { index: 0, start: 0, end: 10, hasText: true, ocr: 'ੴ ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ ਨਿਰਭਉ ਨਿਰਵੈਰੁ ਅਕਾਲ ਮੂਰਤਿ ਅਜੂਨੀ ਸੈਭੰ ਗੁਰ ਪ੍ਰਸਾਦਿ ॥' },
    { index: 1, start: 10, end: 12, hasText: true, ocr: '|॥ ਜਪੁ ॥' },
    { index: 2, start: 12, end: 15, hasText: true, ocr: 'ਆਦਿ ਸਚੁ ਜੁਗਾਦਿ ਸਚੁ ॥' },
  ];
  matchRuns(matcher, corpus, heading);
  assert.equal(heading[1].match?.how, 'context');
  const segs = toSegments(corpus, heading);
  assert.deepEqual(segs.map((s) => s.line_idx), [0, 1, 2]);
});

test('corpus-space labels map line ids and drop headings; low-confidence labels are not packed', () => {
  const heading = corpus.role.findIndex((r) => r === 2); // a raag heading, e.g. "ਸਿਰੀਰਾਗੁ ਮਹਲਾ ੧ ॥"
  const gt: GtCase = {
    video_id: 'x',
    total_duration: 30,
    line_space: 'corpus',
    segments: [
      { start: 0, end: 10, line_idx: 999999, line_id: corpus.lineId[0] },
      { start: 10, end: 12, line_idx: 999999, line_id: corpus.lineId[heading] },
      { start: 12, end: 20, line_idx: 999999, line_id: corpus.lineId[2] },
      { start: 20, end: 30, line_idx: 5, line_id: 'NOPE' },
    ],
  };
  const n = normalizeGt(corpus, gt);
  assert.deepEqual(n.segments.map((s) => s.line_idx), [0, 2], 'ids remapped, heading and unknown id dropped');
  const packed = filterLabels({ video_id: 'x', total_duration: 30, segments: [{ start: 0, end: 5, confidence: 0.9 }, { start: 5, end: 9, confidence: 0.6 }] }, 0.72);
  assert.equal(packed.segments.length, 1);
});
