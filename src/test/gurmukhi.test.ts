import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Boundary, LineRole, deriveRole, skeleton, encodeKey, stripVishraam, toKey, toKeyWithBoundaries } from '../engine/gurmukhi';

test('toKey drops marks that ASR realizes inconsistently', () => {
  // tippi, adhak, nukta, halant, vishraam, dandas and digits are dropped
  assert.equal(toKey('ਸੰਤ'), toKey('ਸਤ'));
  assert.equal(toKey('ਸ਼ਬਦ'), toKey('ਸਬਦ'));
  assert.equal(toKey('ਇੱਕ'), toKey('ਇਕ'));
  assert.equal(toKey('ਪੋਥੀ; ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥੧॥'), toKey('ਪੋਥੀਪਰਮੇਸਰਕਾਥਾਨੁ'));
  // short and long i / u merge
  assert.equal(toKey('ਕਿ'), toKey('ਕੀ'));
  assert.equal(toKey('ਕੁ'), toKey('ਕੂ'));
  // subjoined letters keep the consonant
  assert.equal(toKey('ਪ੍ਰਭ'), toKey('ਪਰਭ'));
});

test('toKeyWithBoundaries marks line, phrase and word starts', () => {
  const { key, flags } = toKeyWithBoundaries('ਜਾ ਕੈ ਰਿਦੈ ਵਸੈ. ਭੈ ਭੰਜਨੁ; ਤਿਸੁ ਜਾਨੈ');
  assert.equal(key.length, flags.length);
  assert.equal(flags[0], Boundary.LineStart);
  const starts = [...flags].map((f, i) => [f, i]).filter(([f]) => f !== Boundary.None);
  // ਭੈ follows a minor vishraam, ਤਿਸੁ follows a major one
  const phraseStarts = starts.filter(([f]) => f === Boundary.Phrase).length;
  assert.equal(phraseStarts, 2);
  assert.equal(starts.length, 8);
});

test('deriveRole finds headings, refrains and invocations', () => {
  assert.equal(deriveRole('ਸਾਰਗ ਮਹਲਾ ੫ ॥'), LineRole.Header);
  assert.equal(deriveRole('ਗਉੜੀ ॥'), LineRole.Header);
  assert.equal(deriveRole('ਭੁਜੰਗ ਪ੍ਰਯਾਤ ਛੰਦ ॥'), LineRole.Header);
  assert.equal(deriveRole('ਰਾਜਾ ਬਾਚ ॥'), LineRole.Header);
  assert.equal(deriveRole('ਸਾਧਸੰਗਿ ਗਾਵਹਿ ਗੁਣ ਗੋਬਿੰਦ; ਪੂਰਨ ਬ੍ਰਹਮ ਗਿਆਨੁ ॥੧॥ ਰਹਾਉ ॥'), LineRole.Rahao);
  assert.equal(deriveRole('ੴ ਸਤਿਗੁਰ ਪ੍ਰਸਾਦਿ ॥'), LineRole.Mangal);
  // The full Mool Mantar is sung and stays a verse.
  assert.equal(deriveRole('ੴ ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ ਨਿਰਭਉ ਨਿਰਵੈਰੁ; ਅਕਾਲ ਮੂਰਤਿ ਅਜੂਨੀ ਸੈਭੰ ਗੁਰ ਪ੍ਰਸਾਦਿ ॥'), LineRole.Verse);
  // A verse that merely contains a heading-like substring is not a heading.
  assert.equal(deriveRole('ਬਿਖੈ ਬਾਚੁ ਹਰਿ ਰਾਚੁ; ਸਮਝੁ ਮਨ ਬਉਰਾ ਰੇ ॥'), LineRole.Verse);
  // Short Dasam verse lines are content.
  assert.equal(deriveRole('ਨਮਸਤੰ ਅਕਾਲੇ ॥'), LineRole.Verse);
});

test('skeleton merges consonants the model confuses', () => {
  // ਭ is spoken like ਪ in Punjabi; ਬ and ਪ differ only in voicing
  assert.deepEqual(skeleton(encodeKey(toKey('ਭੈ ਭੰਜਨੁ'))), skeleton(encodeKey(toKey('ਪੈ ਪੰਜਨ'))));
  assert.deepEqual(skeleton(encodeKey(toKey('ਬਉਰਾ'))), skeleton(encodeKey(toKey('ਪਉਰਾ'))));
});

test('stripVishraam keeps text otherwise verbatim', () => {
  assert.equal(stripVishraam('ਪੋਥੀ; ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥'), 'ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥');
});
