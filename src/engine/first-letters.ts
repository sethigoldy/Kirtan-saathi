/**
 * First-letter search: the operator types the first letter of each word of a
 * line, in Gurmukhi (ਪਪਕਥ) or with the Gurbani Akhar keyboard keys that
 * SikhiToTheMax also uses (ppkQ), and finds "ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ".
 *
 * Letters are compared in the matching key alphabet (gurmukhi.ts), so ਣ and
 * ਨ, or ਸ and ਸ਼, count as the same letter, and a word starting with an
 * independent vowel (ਇਕ, ਉਪਜੈ, ਆਪੇ) starts with its carrier (ੲ, ੳ, ਅ).
 */
import type { Corpus } from './corpus';
import { toKey } from './gurmukhi';

/** Gurbani Akhar (AnmolLipi) keys for the letters a word can start with. */
const AKHAR_KEYS: Record<string, string> = {
  a: 'ੳ', A: 'ਅ', e: 'ੲ', E: 'ਓ', s: 'ਸ', h: 'ਹ', k: 'ਕ', K: 'ਖ', g: 'ਗ', G: 'ਘ', '|': 'ਙ',
  c: 'ਚ', C: 'ਛ', j: 'ਜ', J: 'ਝ', '\\': 'ਞ', t: 'ਟ', T: 'ਠ', f: 'ਡ', F: 'ਢ', x: 'ਣ',
  q: 'ਤ', Q: 'ਥ', d: 'ਦ', D: 'ਧ', n: 'ਨ', p: 'ਪ', P: 'ਫ', b: 'ਬ', B: 'ਭ', m: 'ਮ',
  X: 'ਯ', r: 'ਰ', l: 'ਲ', v: 'ਵ', V: 'ੜ', S: 'ਸ਼', '^': 'ਖ਼', Z: 'ਗ਼', z: 'ਜ਼', '&': 'ਫ਼',
  L: 'ਲ਼', '<': 'ੴ',
};

/**
 * Gurmukhi letters a word can start with: independent vowels (U+0A05–0A14),
 * consonants (U+0A15–0A39, nukta U+0A3C, U+0A59–0A5E), ੲ ੳ ੴ (U+0A72–0A74).
 */
const GURMUKHI_LETTER = /^[ਅ-ਔਕ-ਹ਼ਖ਼-ਫ਼ੲ-ੴ]$/;
const NUKTA = '਼'; // U+0A3C

/** The first letter (one key unit) of each word, and which word it came from. */
export function wordLetters(text: string): { letters: string; words: number[] } {
  const words: number[] = [];
  let letters = '';
  text
    .trim()
    .split(/\s+/)
    .forEach((word, i) => {
      const key = toKey(word);
      if (!key) return; // dandas, digits
      letters += key[0];
      words.push(i);
    });
  return { letters, words };
}

/**
 * The first letters a search query stands for, in key units, or null when the
 * query is words (it has vowel signs, or a word of more than one letter).
 */
export function queryLetters(query: string): string | null {
  const parts = query.trim().split(/\s+/).filter(Boolean);
  const chars = [...parts.join('')];
  if (!chars.length) return null;
  // Any character of the Gurmukhi block (U+0A00–0A7F): Gurmukhi letters.
  if (chars.some((c) => c >= '਀' && c <= '੿')) {
    if (!chars.every((c) => GURMUKHI_LETTER.test(c))) return null;
    if (parts.length > 1 && parts.some((p) => [...p].filter((c) => c !== NUKTA).length > 1)) return null;
    return chars.map((c) => toKey(c)[0] ?? '').join('');
  }
  if (!chars.every((c) => c in AKHAR_KEYS)) return null;
  return chars.map((c) => toKey(AKHAR_KEYS[c])[0]).join('');
}

export interface LetterHit {
  line: number;
  shabad: number;
  /** Matched words: [first, end) indices into the line's display text split on spaces. */
  words?: [number, number];
}

/** First letters of every corpus line, searched by substring. */
export class FirstLetterIndex {
  private readonly letters: string[];

  constructor(private readonly corpus: Corpus) {
    // Each word's first key unit carries a boundary flag (gurmukhi.ts).
    this.letters = corpus.key.map((key, i) => {
      const flags = corpus.keyFlags[i];
      let out = '';
      for (let j = 0; j < key.length; j++) if (flags[j]) out += key[j];
      return out;
    });
  }

  /**
   * Lines containing the letters, best first: a match at the start of a line,
   * then sung lines before headings, then by scripture and page order. One
   * line per shabad.
   */
  search(letters: string, limit: number): LetterHit[] {
    if (!letters) return [];
    const c = this.corpus;
    const found: { line: number; start: boolean; sung: boolean; source: number }[] = [];
    for (let line = 0; line < this.letters.length; line++) {
      const at = this.letters[line].indexOf(letters);
      if (at < 0) continue;
      found.push({ line, start: at === 0, sung: c.isSingable(line), source: c.shabads[c.shabadOf[line]].source });
    }
    found.sort((a, b) => Number(b.start) - Number(a.start) || Number(b.sung) - Number(a.sung) || a.source - b.source || a.line - b.line);
    const hits: LetterHit[] = [];
    const seen = new Set<number>();
    for (const f of found) {
      const shabad = c.shabadOf[f.line];
      if (seen.has(shabad)) continue;
      seen.add(shabad);
      const w = wordLetters(c.plain[f.line]);
      const at = w.letters.indexOf(letters);
      hits.push({ line: f.line, shabad, words: at < 0 ? undefined : [w.words[at], w.words[at + letters.length - 1] + 1] });
      if (hits.length === limit) break;
    }
    return hits;
  }
}
