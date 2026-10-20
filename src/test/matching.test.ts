import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Aligner, RepeatAligner, selfScore } from '../engine/align';
import { Corpus } from '../engine/corpus';
import { encodeKey, toKey } from '../engine/gurmukhi';
import { Retriever } from '../engine/retrieval';
import { LineTracker } from '../engine/tracker';

const CORPUS = join(__dirname, '..', '..', 'resources', 'corpus.json.gz');
let corpus: Corpus;
let retriever: Retriever;

function findLine(text: string): number {
  for (let i = 0; i < corpus.lineCount; i++) if (corpus.plain[i] === text) return i;
  throw new Error(`line not found: ${text}`);
}

/** Deterministic noise: drop / substitute characters, like a weak recognizer. */
function corrupt(key: string, rate: number, seed: number): string {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const alphabet = 'shkgcjtdqxnpbmyrlvaiueo';
  let out = '';
  for (const ch of key) {
    const r = rnd();
    if (r < rate / 2) continue;
    out += r < rate ? alphabet[Math.floor(rnd() * alphabet.length)] : ch;
  }
  return out;
}

before(() => {
  if (!existsSync(CORPUS)) throw new Error('resources/corpus.json.gz missing; run npm run build-corpus');
  corpus = Corpus.load(CORPUS);
  retriever = new Retriever(corpus);
});

test('repeat-tolerant alignment explains repeated phrases', () => {
  const line = findLine('ਬਿਖੈ ਬਾਚੁ ਹਰਿ ਰਾਚੁ ਸਮਝੁ ਮਨ ਬਉਰਾ ਰੇ ॥');
  const q = encodeKey(toKey('ਸਮਝੁ ਮਨੁ ਬਉਰਾ ਸਮਝੁ ਮਨੁ ਬਉਰਾ'));
  const plain = new Aligner().local(q, retriever.codes[line]).score;
  const flags = corpus.keyFlags[line];
  const restart = Float32Array.from(flags, (f) => (f ? 1 : Infinity));
  const rep = new RepeatAligner().align(q, retriever.codes[line], restart).score;
  assert.ok(rep > plain * 1.6, `repeat ${rep} vs plain ${plain}`);
  assert.ok(rep / selfScore(q) > 0.8);
});

test('exact text finds its shabad first', () => {
  for (const text of [
    'ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥',
    'ਕਾਲਬੂਤ ਕੀ ਹਸਤਨੀ ਮਨ ਬਉਰਾ ਰੇ ਚਲਤੁ ਰਚਿਓ ਜਗਦੀਸ ॥',
    'ਨਾਭਿ ਕਮਲ ਤੇ ਬ੍ਰਹਮਾ ਉਪਜੇ ਬੇਦ ਪੜਹਿ ਮੁਖਿ ਕੰਠਿ ਸਵਾਰਿ ॥',
  ]) {
    const line = findLine(text);
    const res = retriever.search(corpus.key[line]);
    assert.equal(res.shabads[0].shabad, corpus.shabadOf[line], text);
  }
});

test('noisy text (25% character errors) still ranks its shabad in the top 3', () => {
  let ok = 0, n = 0;
  for (let i = 1000; i < corpus.lineCount && n < 40; i += 3517) {
    if (!corpus.isSingable(i) || corpus.key[i].length < 25) continue;
    // Two consecutive lines, as a 10 s window of paath would contain.
    const next = i + 1 < corpus.lineCount && corpus.shabadOf[i + 1] === corpus.shabadOf[i] ? corpus.key[i + 1] : '';
    const q = corrupt(corpus.key[i] + next, 0.25, i);
    const res = retriever.search(q);
    n++;
    if (res.shabads.slice(0, 3).some((h) => h.shabad === corpus.shabadOf[i])) ok++;
  }
  assert.ok(ok / n >= 0.85, `top-3 ${ok}/${n}`);
});

test('tracker follows lines in order and returns to the rahao', () => {
  const first = findLine('ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥');
  const shabad = corpus.shabadOf[first];
  const tracker = new LineTracker(corpus, retriever, shabad, null);
  const lines = tracker.lines;
  const feed = (line: number, hops: number) => {
    let out: number | null = null;
    for (let h = 0; h < hops; h++) out = tracker.update(corpus.key[line]).line;
    return out;
  };
  assert.equal(feed(lines[0], 3), lines[0]);
  assert.equal(feed(lines[1], 4), lines[1]);
  assert.equal(feed(lines[2], 4), lines[2]);
  assert.equal(feed(lines[3], 4), lines[3]);
  // Back to the refrain.
  assert.equal(feed(lines[0], 4), lines[0]);
});

test('tracker holds the display during instrumental passages', () => {
  const first = findLine('ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥');
  const tracker = new LineTracker(corpus, retriever, corpus.shabadOf[first], first);
  const upd = tracker.update('');
  assert.equal(upd.held, true);
  assert.equal(upd.line, first);
});
