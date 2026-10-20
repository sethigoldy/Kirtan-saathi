/**
 * Gurmukhi normalization for matching noisy ASR output against canonical text.
 *
 * Canonical text is never altered for display. Matching uses a reduced
 * "key" alphabet that keeps consonants and vowel classes and drops marks
 * that ASR and singers realize inconsistently (tippi, bindi, adhak, nukta,
 * halant, vishraam, dandas, digits, spaces).
 *
 * Key alphabet (one JS char per unit):
 *   consonants  s h k K g G c C j J t T d D q Q x X n p f b B m y r l v R
 *   vowel signs a (ਾ)  i (ਿ ੀ)  u (ੁ ੂ)  e (ੇ)  E (ੈ)  o (ੋ)  O (ੌ)
 *   carriers    A (ਅ)  Y (ੲ)  W (ੳ)
 */

const CONSONANTS: Record<string, string> = {
  'ਸ': 's', 'ਹ': 'h', 'ਕ': 'k', 'ਖ': 'K', 'ਗ': 'g', 'ਘ': 'G', 'ਙ': 'n',
  'ਚ': 'c', 'ਛ': 'C', 'ਜ': 'j', 'ਝ': 'J', 'ਞ': 'n', 'ਟ': 't', 'ਠ': 'T',
  'ਡ': 'd', 'ਢ': 'D', 'ਣ': 'n', 'ਤ': 'q', 'ਥ': 'Q', 'ਦ': 'x', 'ਧ': 'X',
  'ਨ': 'n', 'ਪ': 'p', 'ਫ': 'f', 'ਬ': 'b', 'ਭ': 'B', 'ਮ': 'm', 'ਯ': 'y',
  'ਰ': 'r', 'ਲ': 'l', 'ਵ': 'v', 'ੜ': 'R',
  // Precomposed nukta letters (NFD normally splits these; kept as a fallback).
  'ਸ਼': 's', 'ਖ਼': 'K', 'ਗ਼': 'g', 'ਜ਼': 'j', 'ਫ਼': 'f', 'ਲ਼': 'l',
};

const VOWEL_SIGNS: Record<string, string> = {
  'ਾ': 'a', 'ਿ': 'i', 'ੀ': 'i', 'ੁ': 'u', 'ੂ': 'u', 'ੇ': 'e', 'ੈ': 'E',
  'ੋ': 'o', 'ੌ': 'O',
};

const INDEPENDENT: Record<string, string> = {
  'ਅ': 'A', 'ਆ': 'Aa', 'ਇ': 'Yi', 'ਈ': 'Yi', 'ਉ': 'Wu', 'ਊ': 'Wu',
  'ਏ': 'Ye', 'ਐ': 'AE', 'ਓ': 'Wo', 'ਔ': 'AO', 'ੲ': 'Y', 'ੳ': 'W',
  // Ik Oankar is sung as "ik oankaar".
  'ੴ': 'YikWoAkar',
  // Yakash (subscript ya, e.g. ਤ੍ਵ / ਸ੍ਯ forms in Dasam bani).
  'ੵ': 'y',
};

/** Characters that are dropped silently. Everything not mapped is dropped. */

export const KEY_ALPHABET = 'shkKgGcCjJtTdDqQxXnpfbBmyrlvRaiueEoOAYW';
const CODE_OF = new Map<string, number>();
for (let i = 0; i < KEY_ALPHABET.length; i++) CODE_OF.set(KEY_ALPHABET[i], i);
export const ALPHABET_SIZE = KEY_ALPHABET.length;

export const VOWEL_CODES = new Set<number>('aiueEoO'.split('').map((c) => CODE_OF.get(c)!));
export const CARRIER_CODES = new Set<number>('AYW'.split('').map((c) => CODE_OF.get(c)!));

export function codeOf(ch: string): number {
  const c = CODE_OF.get(ch);
  if (c === undefined) throw new Error(`not a key char: ${ch}`);
  return c;
}

/** Map one Gurmukhi code point to its key units ('' when dropped). */
function mapChar(ch: string): string {
  return CONSONANTS[ch] ?? VOWEL_SIGNS[ch] ?? INDEPENDENT[ch] ?? '';
}

/** Matching key for a piece of Gurmukhi text. */
export function toKey(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFD')) out += mapChar(ch);
  return out;
}

/**
 * Matching key that keeps, for every key unit, the index of the source
 * element it came from. `items` is a list of text fragments (e.g. decoded
 * CTC tokens), and the returned `src[i]` is the fragment index of key unit i.
 */
export function toKeyTimed(items: readonly string[]): { key: string; src: Int32Array } {
  let key = '';
  const src: number[] = [];
  for (let i = 0; i < items.length; i++) {
    for (const ch of items[i].normalize('NFD')) {
      const k = mapChar(ch);
      for (let j = 0; j < k.length; j++) {
        key += k[j];
        src.push(i);
      }
    }
  }
  return { key, src: Int32Array.from(src) };
}

/** Restart points inside a line's key, where singers commonly repeat from. */
export const enum Boundary {
  None = 0,
  Word = 1,
  /** After a vishraam (';' or '.') — a phrase start. */
  Phrase = 2,
  LineStart = 3,
}

/**
 * Key plus a boundary flag per key unit, derived from the canonical text's
 * word breaks and vishraam markers.
 */
export function toKeyWithBoundaries(text: string): { key: string; flags: Uint8Array } {
  let key = '';
  const flags: number[] = [];
  let afterVishraam = false;
  let first = true;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const k = toKey(word);
    if (k.length) {
      flags.push(first ? Boundary.LineStart : afterVishraam ? Boundary.Phrase : Boundary.Word);
      for (let j = 1; j < k.length; j++) flags.push(Boundary.None);
      key += k;
      first = false;
    }
    afterVishraam = /[;.]$/.test(word) || (afterVishraam && !k.length);
  }
  return { key, flags: Uint8Array.from(flags) };
}

/**
 * Consonant classes for candidate indexing. Vowels and carriers are dropped
 * and consonants that the model or singers routinely confuse share a class
 * (aspiration, voicing, Punjabi tonal devoicing, retroflex/dental, ੜ/ਰ, ਬ/ਵ).
 * Values are small integers; SKELETON_SIZE is the class count.
 */
const SKELETON_CLASS: Record<string, number> = {
  k: 0, K: 0, g: 0, G: 0,
  c: 1, C: 1, j: 1, J: 1, y: 1,
  t: 2, T: 2, d: 2, D: 2, q: 2, Q: 2, x: 2, X: 2,
  p: 3, f: 3, b: 3, B: 3, v: 3,
  s: 4, h: 5, n: 6, m: 7, r: 8, R: 8, l: 9,
};
export const SKELETON_SIZE = 10;
const SKELETON_OF_CODE = new Int8Array(ALPHABET_SIZE).fill(-1);
for (const [ch, cls] of Object.entries(SKELETON_CLASS)) SKELETON_OF_CODE[CODE_OF.get(ch)!] = cls;

/** Consonant-class skeleton of encoded key codes. */
export function skeleton(codes: ArrayLike<number>): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < codes.length; i++) {
    const c = SKELETON_OF_CODE[codes[i]];
    if (c >= 0) out.push(c);
  }
  return Uint8Array.from(out);
}

/** Encode a key string into small integer codes. */
export function encodeKey(key: string): Uint8Array {
  const out = new Uint8Array(key.length);
  for (let i = 0; i < key.length; i++) out[i] = CODE_OF.get(key[i])!;
  return out;
}

/** Display text without vishraam markers (Shabad OS uses ';' and '.'). */
export function stripVishraam(text: string): string {
  return text.replace(/[;.,]/g, '').replace(/\s+/g, ' ').trim();
}

/** Text compared across databases: no vishraam, no spaces, NFC. */
export function canonicalCompareKey(text: string): string {
  return stripVishraam(text).normalize('NFC').replace(/\s+/g, '');
}

export const enum LineRole {
  Verse = 0,
  Rahao = 1,
  Header = 2,
  Mangal = 3,
}

/** Whole words that mark a heading when they appear in a short, unnumbered line. */
const HEADER_WORDS = new Set([
  'ਮਹਲਾ', 'ਮਃ', 'ਮਹਲੁ', 'ਪਉੜੀ', 'ਸਲੋਕੁ', 'ਸਲੋਕ', 'ਛੰਤ', 'ਡਖਣਾ', 'ਪਾਤਿਸਾਹੀ',
  'ਪਾਤਸ਼ਾਹੀ', 'ਦੋਹਰਾ', 'ਚੌਪਈ', 'ਸ੍ਵੈਯਾ', 'ਸਵੈਯਾ', 'ਸਵਯੇ', 'ਕਬਿੱਤੁ', 'ਭੁਜੰਗ',
  'ਛਪੈ', 'ਰਾਗੁ', 'ਘਰੁ', 'ਅਸਟਪਦੀ', 'ਅਸਟਪਦੀਆ',
  'ਦੁਪਦੇ', 'ਤਿਪਦੇ', 'ਚਉਪਦੇ', 'ਪੰਚਪਦੇ', 'ਸੋਰਠਾ', 'ਅੜਿਲ', 'ਰੂਆਲ', 'ਤੋਟਕ',
  // Dasam Granth meter and narrative headings ("ਭੁਜੰਗ ਪ੍ਰਯਾਤ ਛੰਦ ॥", "ਰਾਜਾ ਬਾਚ ॥").
  'ਛੰਦ', 'ਬਾਚ', 'ਕਬਿਤੁ', 'ਕਥਨੰ', 'ਅੜਿੱਲ', 'ਤੋਮਰ', 'ਰਸਾਵਲ', 'ਨਰਾਜ', 'ਪਾਧੜੀ',
  'ਲਿਖ੍ਯਤੇ', 'ਸਮਾਪਤਮ',
]);

const RAAG_NAMES = new Set([
  'ਸਿਰੀਰਾਗੁ', 'ਸਿਰੀਰਾਗ', 'ਮਾਝ', 'ਗਉੜੀ', 'ਆਸਾ', 'ਗੂਜਰੀ', 'ਦੇਵਗੰਧਾਰੀ', 'ਬਿਹਾਗੜਾ',
  'ਵਡਹੰਸੁ', 'ਸੋਰਠਿ', 'ਧਨਾਸਰੀ', 'ਜੈਤਸਰੀ', 'ਟੋਡੀ', 'ਬੈਰਾੜੀ', 'ਤਿਲੰਗ', 'ਸੂਹੀ',
  'ਬਿਲਾਵਲੁ', 'ਗੋਂਡ', 'ਗੋਂਡੁ', 'ਰਾਮਕਲੀ', 'ਨਟ', 'ਮਾਲੀ', 'ਮਾਰੂ', 'ਤੁਖਾਰੀ', 'ਕੇਦਾਰਾ',
  'ਭੈਰਉ', 'ਬਸੰਤੁ', 'ਬਸੰਤ', 'ਸਾਰਗ', 'ਮਲਾਰ', 'ਕਾਨੜਾ', 'ਕਲਿਆਨ', 'ਕਲਿਆਨੁ',
  'ਪ੍ਰਭਾਤੀ', 'ਜੈਜਾਵੰਤੀ',
]);

/**
 * Derive a line's role from its text. Shabad OS ADR-0005 notes the stored
 * line type was never populated reliably, so roles are recomputed here.
 */
export function deriveRole(text: string): LineRole {
  const plain = stripVishraam(text);
  if (/ਰਹਾਉ/.test(plain)) return LineRole.Rahao;
  const words = plain.replace(/[॥।੦-੯0-9]/g, ' ').split(/\s+/).filter(Boolean);
  // Short invocations ("ੴ ਸਤਿਗੁਰ ਪ੍ਰਸਾਦਿ ॥") recur in hundreds of shabads and
  // identify none of them. The full Mool Mantar is long and stays a verse.
  if (plain.startsWith('ੴ') && words.length <= 6) return LineRole.Mangal;
  // Headers: short, carry no verse number, and contain a heading word.
  const hasVerseNumber = /॥\s*[੦-੯]+\s*॥/.test(plain);
  if (!hasVerseNumber && words.length <= 6 && words.some((w) => HEADER_WORDS.has(w))) {
    return LineRole.Header;
  }
  // Bare raag headings such as "ਗਉੜੀ ॥" or "ਆਸਾ ਸ੍ਰੀ ਕਬੀਰ ਜੀਉ ॥".
  if (!hasVerseNumber && words.length <= 5 && RAAG_NAMES.has(words[0] ?? '')) {
    return LineRole.Header;
  }
  return LineRole.Verse;
}
