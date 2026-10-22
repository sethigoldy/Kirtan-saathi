import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Corpus } from '../engine/corpus';
import { FirstLetterIndex, queryLetters, wordLetters } from '../engine/first-letters';

const corpus = Corpus.load(resolve(__dirname, '../../resources/corpus.json.gz'));
const index = new FirstLetterIndex(corpus);

test('first letters typed in Gurmukhi or with the Gurbani Akhar keys mean the same', () => {
  assert.equal(queryLetters('ppkQ'), 'ppkQ');
  assert.equal(queryLetters('ਪਪਕਥ'), 'ppkQ');
  assert.equal(queryLetters(' ਪ ਪ ਕ ਥ '), 'ppkQ');
  assert.equal(queryLetters('p p k Q'), 'ppkQ');
  // Carriers: ੳ (a), ਅ (A), ੲ (e), and a word starting with ਓ (E) starts with ੳ.
  assert.equal(queryLetters('aAeE'), queryLetters('ੳਅੲੳ'));
  assert.equal(queryLetters('ਇਉ'), queryLetters('ea'));
  // ਸ਼ (S) and ਸ (s), ਣ (x) and ਨ (n) are the same letter.
  assert.equal(queryLetters('Sx'), queryLetters('sn'));
});

test('words are not first letters', () => {
  assert.equal(queryLetters('ਪੋਥੀ'), null, 'vowel signs');
  assert.equal(queryLetters('ਪੋਥੀ ਪਰਮੇਸਰ'), null);
  assert.equal(queryLetters('ਸਚ ਕਰਮ'), null, 'words of more than one letter');
  assert.equal(queryLetters('pothi'), null, 'o and i are vowel keys');
  assert.equal(queryLetters('   '), null);
});

test('a line\'s first letters skip dandas and numbers', () => {
  assert.deepEqual(wordLetters('ੴ ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ ਨਿਰਭਉ ਨਿਰਵੈਰੁ ॥ ੧ ॥'), { letters: 'Ysnkpnn', words: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(wordLetters('ਇਕ ਓਅੰਕਾਰਿ ਉਪਜੈ ਆਪੇ ਐਸਾ').letters, 'YWWAA');
});

test('finds a shabad by the first letters of a line', () => {
  const [hit] = index.search(queryLetters('ppkQ')!, 8);
  assert.equal(corpus.plain[hit.line], 'ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥');
  assert.deepEqual(hit.words, [0, 4]);
  const [mool] = index.search(queryLetters('<snkp')!, 8);
  assert.match(corpus.plain[mool.line], /^ੴ ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ/);
});

test('lines that start with the letters come first, one per shabad', () => {
  const letters = queryLetters('spnh')!;
  const hits = index.search(letters, 8);
  assert.equal(hits.length, 8);
  assert.match(corpus.plain[hits[0].line], /^ਸੋ ਪੁਰਖੁ ਨਿਰੰਜਨੁ ਹਰਿ/);
  assert.equal(new Set(hits.map((h) => h.shabad)).size, hits.length);
  const starts = hits.map((h) => h.words![0] === 0);
  assert.deepEqual(starts, [...starts].sort((a, b) => Number(b) - Number(a)), 'line starts before matches later in a line');
  // A match later in a line names the matched words.
  const [mid] = index.search(queryLetters('hkjp')!, 1);
  const words = corpus.plain[mid.line].split(/\s+/).slice(...mid.words!);
  assert.equal(words.map((w) => wordLetters(w).letters).join(''), 'hkjp');
});
