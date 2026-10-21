import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateFromTitle, inShard, isKirtanStream, splitFor, windowFor } from '../cli/darbar-batch';

test('only captioned kirtan streams are taken', () => {
  assert.equal(isKirtanStream('Official SGPC LIVE | Gurbani Kirtan | Sachkhand Sri Harmandir Sahib, Sri Amritsar | 20.10.2026'), true);
  assert.equal(isKirtanStream('Official SGPC LIVE (Audio) | Gurbani Kirtan | Sachkhand Sri Harmandir Sahib, Sri Amritsar 20.10.2026'), false);
  assert.equal(isKirtanStream('Hukamnama Katha (discourse) Gurdwara Sri Manji Sahib Diwan Hall, Sri Amritsar | Tuesday 20.10.2026'), false);
  assert.equal(isKirtanStream('Hukamnama Sachkhand Sri Harmandir Sahib Sri Darbar Sahib, Sri Amritsar | Tuesday 20.10.2026'), false);
  assert.equal(isKirtanStream('Official SGPC LIVE | Gurbani Kirtan | 21.10.2026', 'is_live'), false, 'a stream still live is not finished');
  assert.equal(dateFromTitle('Official SGPC LIVE | Gurbani Kirtan | Sri Amritsar | 20.10.2026'), '2026-10-20');
  assert.equal(dateFromTitle('no date'), null);
});

test('shards split the work without overlap, the same way on every computer', () => {
  const ids = Array.from({ length: 300 }, (_, i) => `sgpc-video${i}`);
  const parts = [1, 2, 3].map((s) => ids.filter((id) => inShard(id, [s, 3])));
  assert.equal(parts.reduce((n, p) => n + p.length, 0), ids.length, 'every stream belongs to exactly one shard');
  for (const p of parts) assert.ok(p.length > 70 && p.length < 130, `balanced: ${p.length}`);
  assert.deepEqual(ids.filter((id) => inShard(id, [2, 3])), parts[1], 'deterministic');
});

test('about one stream in k goes to test; windows stay inside the stream', () => {
  const ids = Array.from({ length: 1400 }, (_, i) => `sgpc-v${i}`);
  const tests = ids.filter((id) => splitFor(id, 14) === 'test').length;
  assert.ok(tests > 70 && tests < 130, `~100 of 1400 in test, got ${tests}`);
  for (const id of ids.slice(0, 200)) {
    const d = 3600 + (id.length % 7) * 1800;
    const w = windowFor(id, d, 60);
    assert.ok(w.start >= d * 0.1 - 10 && w.start + w.length <= d * 0.9 + 10, `${id}: ${w.start}+${w.length} in ${d}`);
    assert.equal(w.length, Math.min(3600, d * 0.8));
  }
  const short = windowFor('x', 1800, 60);
  assert.equal(short.length, 1440, 'a short stream gives at most 80% of its length');
});
