import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Corpus } from '../engine/corpus';
import { PaathFollower, baniStream, sourceStream } from '../engine/paath';
import { Retriever } from '../engine/retrieval';

let corpus: Corpus;
let retriever: Retriever;

function findLine(text: string): number {
  for (let i = 0; i < corpus.lineCount; i++) if (corpus.plain[i] === text) return i;
  throw new Error(`line not found: ${text}`);
}

before(() => {
  corpus = Corpus.load(join(__dirname, '..', '..', 'resources', 'corpus.json.gz'));
  retriever = new Retriever(corpus);
});

test('source stream covers the whole source in reading order', () => {
  const first = findLine('ਸੋਚੈ ਸੋਚਿ ਨ ਹੋਵਈ ਜੇ ਸੋਚੀ ਲਖ ਵਾਰ ॥');
  const s = sourceStream(corpus, first);
  assert.equal(s.name, 'Sri Guru Granth Sahib');
  assert.equal(s.lines.length, 60555);
  for (let i = 1; i < 100; i++) assert.equal(s.lines[i], s.lines[i - 1] + 1);
});

test('follower advances line by line, across shabad boundaries', () => {
  const start = findLine('ਸੋਚੈ ਸੋਚਿ ਨ ਹੋਵਈ ਜੇ ਸੋਚੀ ਲਖ ਵਾਰ ॥');
  const stream = sourceStream(corpus, start);
  const f = new PaathFollower(corpus, retriever, stream, start - stream.lines[0]);
  for (let k = 1; k <= 40; k++) {
    // Window = end of the previous line + start of the next one, like 4 s of paath.
    const prev = corpus.key[start + k - 1];
    const cur = corpus.key[start + k];
    const upd = f.update(prev.slice(-12) + cur.slice(0, Math.max(6, Math.floor(cur.length / 2))));
    assert.equal(upd.line, start + k, `step ${k}: ${corpus.plain[start + k]}`);
  }
});

test('pauses hold, going back needs repeated evidence, unrelated audio loses the lock', () => {
  const start = findLine('ਸੋਚੈ ਸੋਚਿ ਨ ਹੋਵਈ ਜੇ ਸੋਚੀ ਲਖ ਵਾਰ ॥');
  const stream = sourceStream(corpus, start);
  const f = new PaathFollower(corpus, retriever, stream, start - stream.lines[0] + 3);
  assert.equal(f.update('').held, true);
  // Re-reading the previous line (mid-line, as the paathi goes back over it):
  // the first update holds, the second moves back.
  const reread = corpus.key[start + 2].slice(0, Math.floor(corpus.key[start + 2].length * 0.7));
  assert.equal(f.update(reread).line, start + 3);
  assert.equal(f.update(reread).line, start + 2);
  // Text from far away in the corpus: no match nearby, eventually lost.
  const far = corpus.key[findLine('ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥')];
  let lost = false;
  for (let i = 0; i < 10 && !lost; i++) lost = f.update(far + far).lost;
  assert.equal(lost, true);
});

test('follower moves the displayed line only at 60% or more', () => {
  const start = findLine('ਸੋਚੈ ਸੋਚਿ ਨ ਹੋਵਈ ਜੇ ਸੋਚੀ ਲਖ ਵਾਰ ॥');
  const stream = sourceStream(corpus, start);
  const f = new PaathFollower(corpus, retriever, stream, start - stream.lines[0]);
  let shown = f.line, changes = 0, unsure = 0, s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 1; k <= 40; k++) {
    // Each window: end of one line and start of the next, with recognizer errors.
    const prev = corpus.key[start + k - 1];
    const cur = corpus.key[start + k];
    for (const rate of [0.5, 0.3, 0.1]) {
      let key = '';
      for (const ch of prev.slice(-12) + cur.slice(0, Math.max(6, Math.floor(cur.length / 2)))) {
        const r = rnd();
        if (r >= rate) key += ch;
        else if (r < rate / 2) key += 'shkgcjtdqxnpbmyrlv'[Math.floor(rnd() * 18)];
      }
      const upd = f.update(key);
      if (upd.score > 0 && upd.score < 0.6) unsure++;
      if (upd.line !== shown) {
        changes++;
        assert.ok(upd.score >= 0.6, `line ${k}: moved at ${(upd.score * 100).toFixed(0)}%`);
        shown = upd.line;
      }
    }
  }
  assert.ok(changes >= 30, `followed ${changes} of 40 lines`);
  assert.ok(unsure > 0, 'some windows were unsure');
});

test('locate finds a position inside a bani', () => {
  const japji = baniStream(corpus, 'JAPJ');
  assert.ok(japji.lines.length > 300);
  const target = japji.lines[150];
  const loc = PaathFollower.locate(retriever, japji, corpus.key[target] + corpus.key[japji.lines[151]]);
  assert.ok(Math.abs(loc.index - 151) <= 1, `index ${loc.index}`);
  assert.ok(loc.score > 0.8);
});
