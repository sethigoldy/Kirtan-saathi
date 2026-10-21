/**
 * Gurbani line formatting shared by every display: vishraam markers become
 * styling, larivaar joins the words. Pure functions (no DOM) so they are
 * unit-tested in Node and reused by the presentation page.
 *
 * Shabad OS marks pauses after a word: ';' main, ',' medium, '.' short.
 */
import type { MeaningLang } from '../main/display-types';

export type Pause = 'main' | 'medium' | 'short' | null;

export const MEANING_LANGS: MeaningLang[] = ['pa', 'hi', 'en'];

/**
 * Meaning setting from current or older values: a list, a comma list
 * ("pa,en"), "off", or the older single choices "pa", "hi" and "both" (pa + hi).
 */
export function parseMeaning(v: unknown): MeaningLang[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? (v === 'both' ? ['pa', 'hi'] : v.split(',')) : [];
  return MEANING_LANGS.filter((l) => list.includes(l));
}

/** "Arth: … · Translation: …" for the meanings shown (Hindi shows the Punjabi arth). */
export function creditText(credits: { arth: string; translation: string }, langs: MeaningLang[]): string {
  const parts: string[] = [];
  if ((langs.includes('pa') || langs.includes('hi')) && credits.arth) parts.push(`Arth: ${credits.arth}`);
  if (langs.includes('en') && credits.translation) parts.push(`Translation: ${credits.translation}`);
  return parts.join(' · ');
}

export interface Token {
  text: string;
  pause: Pause;
  /** Separator before this token: '' (first token or larivaar join) or ' '. */
  gap: string;
  /** ॥, । and verse numbers: never joined in larivaar. */
  mark: boolean;
}

const PAUSES: Record<string, Pause> = { ';': 'main', ',': 'medium', '.': 'short' };
const MARK = /^[॥।੦-੯०-९0-9]+$/;

export function tokens(text: string, opts: { larivaar: boolean; vishraam: boolean; hindi?: boolean }): Token[] {
  const out: Token[] = [];
  for (const raw of text.trim().split(/\s+/)) {
    if (!raw) continue;
    const pause = PAUSES[raw[raw.length - 1]] ?? null;
    const bare = pause ? raw.slice(0, -1) : raw;
    const word = opts.hindi ? toDevanagari(bare) : bare;
    if (!word) {
      // A detached marker (" ; ") belongs to the previous word.
      if (pause && out.length) out[out.length - 1].pause = opts.vishraam ? pause : null;
      continue;
    }
    const mark = MARK.test(word);
    const prev = out[out.length - 1];
    const gap = !prev ? '' : opts.larivaar && !mark && !prev.mark ? '' : ' ';
    out.push({ text: word, pause: opts.vishraam ? pause : null, gap, mark });
  }
  return out;
}

/** Plain text as displayed (markers removed, larivaar applied). */
export function plainText(text: string, opts: { larivaar: boolean }): string {
  return tokens(text, { larivaar: opts.larivaar, vishraam: false })
    .map((t) => t.gap + t.text)
    .join('');
}

/**
 * Gurmukhi → Devanagari (Hindi script) transliteration, as printed in Hindi
 * gutkas: letters map one-to-one (the Unicode blocks are parallel, 0x100
 * apart), Gurbani's word-final aunkar / sihari are kept, and
 *   ੱ addak  doubles the next consonant   ਸੱਚ → सच्च
 *   ੰ tippi, ਂ bindi → ं                    ਸੰਤ → संत
 *   ੲ / ੳ carriers + vowel sign → vowel    ੳੁ → उ
 *   ੵ yakash → ्य; ੑ udaat is dropped; ੴ stays as is.
 */
/** Addak before an aspirate doubles with the plain consonant: ਅੱਖਰ → अक्खर. */
const UNASPIRATED: Record<string, string> = {
  'ਖ': 'क', 'ਘ': 'ग', 'ਛ': 'च', 'ਝ': 'ज', 'ਠ': 'ट', 'ਢ': 'ड', 'ਥ': 'त', 'ਧ': 'द', 'ਫ': 'प', 'ਭ': 'ब',
};

export function toDevanagari(text: string): string {
  let out = '';
  const chars = Array.from(text.normalize('NFC'));
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const code = c.codePointAt(0)!;
    if (code < 0x0a00 || code > 0x0a7f) {
      out += c;
      continue;
    }
    const next = chars[i + 1];
    switch (c) {
      case 'ੱ': {
        const n = next?.codePointAt(0) ?? 0;
        if (n >= 0x0a15 && n <= 0x0a5e) out += (UNASPIRATED[next] ?? String.fromCodePoint(n - 0x100)) + '्';
        continue;
      }
      case 'ਸ':
      case 'ਲ':
        // NFC stores ਸ਼ / ਲ਼ as letter + nukta; Hindi has its own letters.
        if (next === '਼') {
          out += c === 'ਸ' ? 'श' : 'ळ';
          i++;
          continue;
        }
        break;
      case 'ੰ':
      case 'ਂ':
        out += 'ं';
        continue;
      case 'ੵ':
        out += '्य';
        continue;
      case 'ੑ':
        continue;
      case 'ੴ':
        out += c;
        continue;
      case 'ੳ': {
        const v: Record<string, string> = { 'ੁ': 'उ', 'ੂ': 'ऊ', 'ੋ': 'ओ' };
        if (next && v[next]) {
          out += v[next];
          i++;
        } else out += 'उ';
        continue;
      }
      case 'ੲ': {
        const v: Record<string, string> = { 'ਿ': 'इ', 'ੀ': 'ई', 'ੇ': 'ए' };
        if (next && v[next]) {
          out += v[next];
          i++;
        } else out += 'इ';
        continue;
      }
      case 'ਅ': {
        // ਅ + ਾ / ੈ / ੌ are written as independent vowels in Devanagari.
        const v: Record<string, string> = { 'ਾ': 'आ', 'ੈ': 'ऐ', 'ੌ': 'औ' };
        if (next && v[next]) {
          out += v[next];
          i++;
        } else out += 'अ';
        continue;
      }
    }
    out += String.fromCodePoint(code - 0x100);
  }
  return out;
}
