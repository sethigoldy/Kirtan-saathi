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
export function creditText(credits: { arth: string; translation: string }, langs: MeaningLang[], language: UiLanguage = 'en'): string {
  const pa = language === 'pa';
  const name = (n: string) => (pa ? NAMES_PA[n] ?? n : n);
  const parts: string[] = [];
  if ((langs.includes('pa') || langs.includes('hi')) && credits.arth) parts.push(`${pa ? 'ਅਰਥ' : 'Arth'}: ${name(credits.arth)}`);
  if (langs.includes('en') && credits.translation) parts.push(`${pa ? 'ਅਨੁਵਾਦ' : 'Translation'}: ${name(credits.translation)}`);
  return parts.join(' · ');
}

// ---------- Punjabi names (Punjabi app) ----------

/** Language of the app's own words (not Gurbani): English or Punjabi. */
export type UiLanguage = 'en' | 'pa';

export function gurmukhiDigits(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => '੦੧੨੩੪੫੬੭੮੯'[Number(d)]);
}

/** Credit names as written in Gurmukhi. */
export const NAMES_PA: Record<string, string> = {
  'Prof. Sahib Singh': 'ਪ੍ਰੋ. ਸਾਹਿਬ ਸਿੰਘ',
  'Dr. Ratan Singh Jaggi': 'ਡਾ. ਰਤਨ ਸਿੰਘ ਜੱਗੀ',
  'Bhai Vir Singh': 'ਭਾਈ ਵੀਰ ਸਿੰਘ',
  'Sampuran Singh': 'ਸੰਪੂਰਨ ਸਿੰਘ',
  'Ganda Singh': 'ਗੰਡਾ ਸਿੰਘ',
  'Manmohan Singh': 'ਮਨਮੋਹਨ ਸਿੰਘ',
  'Faridkot Wala Teeka': 'ਫ਼ਰੀਦਕੋਟ ਵਾਲਾ ਟੀਕਾ',
  'Dr. Sant Singh Khalsa': 'ਡਾ. ਸੰਤ ਸਿੰਘ ਖ਼ਾਲਸਾ',
  'Dr. Surinder Singh Kohli': 'ਡਾ. ਸੁਰਿੰਦਰ ਸਿੰਘ ਕੋਹਲੀ',
  'Jodh Singh': 'ਜੋਧ ਸਿੰਘ',
  'Shamsher Singh Puri': 'ਸ਼ਮਸ਼ੇਰ ਸਿੰਘ ਪੁਰੀ',
  'Pritpal Singh Bindra': 'ਪ੍ਰਿਤਪਾਲ ਸਿੰਘ ਬਿੰਦਰਾ',
};

/** Section (raag, bani, vaar) names as headed in the scriptures. */
const SECTIONS_PA: Record<string, string> = {
  // Sri Guru Granth Sahib
  Jap: 'ਜਪੁ',
  'So Dar': 'ਸੋ ਦਰੁ',
  'So Purakh': 'ਸੋ ਪੁਰਖੁ',
  Sohila: 'ਸੋਹਿਲਾ',
  'Siree Raag': 'ਸਿਰੀਰਾਗੁ',
  'Raag Maajh': 'ਰਾਗੁ ਮਾਝ',
  'Raag Gauree': 'ਰਾਗੁ ਗਉੜੀ',
  'Raag Aasaa': 'ਰਾਗੁ ਆਸਾ',
  'Raag Gujri': 'ਰਾਗੁ ਗੂਜਰੀ',
  'Raag Dayv Gandhaaree': 'ਰਾਗੁ ਦੇਵਗੰਧਾਰੀ',
  'Raag Bihaagraa': 'ਰਾਗੁ ਬਿਹਾਗੜਾ',
  'Raag Vadhans': 'ਰਾਗੁ ਵਡਹੰਸੁ',
  'Raag Sorath': 'ਰਾਗੁ ਸੋਰਠਿ',
  'Raag Dhanaasree': 'ਰਾਗੁ ਧਨਾਸਰੀ',
  'Raag Jaithsree': 'ਰਾਗੁ ਜੈਤਸਰੀ',
  'Raag Todee': 'ਰਾਗੁ ਟੋਡੀ',
  'Raag Bairaaree': 'ਰਾਗੁ ਬੈਰਾੜੀ',
  'Raag Tilang': 'ਰਾਗੁ ਤਿਲੰਗ',
  'Raag Soohee': 'ਰਾਗੁ ਸੂਹੀ',
  'Raag Bilaaval': 'ਰਾਗੁ ਬਿਲਾਵਲੁ',
  'Raag Gond': 'ਰਾਗੁ ਗੋਂਡ',
  'Raag Raamkalee': 'ਰਾਗੁ ਰਾਮਕਲੀ',
  'Raag Nat Naaraayan': 'ਰਾਗੁ ਨਟ ਨਾਰਾਇਨ',
  'Raag Maalee Gauraa': 'ਰਾਗੁ ਮਾਲੀ ਗਉੜਾ',
  'Raag Maaroo': 'ਰਾਗੁ ਮਾਰੂ',
  'Raag Tukhaari': 'ਰਾਗੁ ਤੁਖਾਰੀ',
  'Raag Kaydaaraa': 'ਰਾਗੁ ਕੇਦਾਰਾ',
  'Raag Bhairao': 'ਰਾਗੁ ਭੈਰਉ',
  'Raag Basant': 'ਰਾਗੁ ਬਸੰਤੁ',
  'Raag Saarang': 'ਰਾਗੁ ਸਾਰਗ',
  'Raag Malaar': 'ਰਾਗੁ ਮਲਾਰ',
  'Raag Kaanraa': 'ਰਾਗੁ ਕਾਨੜਾ',
  'Raag Kalyaan': 'ਰਾਗੁ ਕਲਿਆਨ',
  'Raag Prabhaatee': 'ਰਾਗੁ ਪ੍ਰਭਾਤੀ',
  'Raag Jaijaavantee': 'ਰਾਗੁ ਜੈਜਾਵੰਤੀ',
  'Salok Sehshkritee': 'ਸਲੋਕ ਸਹਸਕ੍ਰਿਤੀ',
  'Gaathaa Fifth Mehl': 'ਗਾਥਾ ਮਹਲਾ ੫',
  'Phunhay Fifth Mehl': 'ਫੁਨਹੇ ਮਹਲਾ ੫',
  'Chaubolas Fifth Mehl': 'ਚਉਬੋਲੇ ਮਹਲਾ ੫',
  'Salok Kabeer Jee': 'ਸਲੋਕ ਕਬੀਰ ਜੀ',
  'Salok Fareed Jee': 'ਸਲੋਕ ਫਰੀਦ ਜੀ',
  'Svaiyay Sri Mukhbak Mehl 5': 'ਸਵਯੇ ਸ੍ਰੀ ਮੁਖਬਾਕ੍ਯ੍ਯ ਮਹਲਾ ੫',
  'Svaiyay First Mehl': 'ਸਵਈਏ ਮਹਲੇ ਪਹਿਲੇ ਕੇ',
  'Svaiyay Second Mehl': 'ਸਵਈਏ ਮਹਲੇ ਦੂਜੇ ਕੇ',
  'Svaiyay Third Mehl': 'ਸਵਈਏ ਮਹਲੇ ਤੀਜੇ ਕੇ',
  'Svaiyay Fourth Mehl': 'ਸਵਈਏ ਮਹਲੇ ਚਉਥੇ ਕੇ',
  'Svaiyay Fifth Mehl': 'ਸਵਈਏ ਮਹਲੇ ਪੰਜਵੇ ਕੇ',
  'Salok Vaaran Thay Vadheek': 'ਸਲੋਕ ਵਾਰਾਂ ਤੇ ਵਧੀਕ',
  'Salok Ninth Mehl': 'ਸਲੋਕ ਮਹਲਾ ੯',
  'Mundhaavanee Fifth Mehl': 'ਮੁੰਦਾਵਣੀ ਮਹਲਾ ੫',
  Raagmala: 'ਰਾਗਮਾਲਾ',
  // Sri Dasam Granth
  Jaap: 'ਜਾਪੁ',
  'Akal Ustat': 'ਅਕਾਲ ਉਸਤਤਿ',
  'Bachittar Natak': 'ਬਚਿਤ੍ਰ ਨਾਟਕ',
  'Chandi Charittar Ukat Bilas': 'ਚੰਡੀ ਚਰਿਤ੍ਰ ਉਕਤਿ ਬਿਲਾਸ',
  'Chandi Charittar': 'ਚੰਡੀ ਚਰਿਤ੍ਰ',
  'Vaar Sri Bhagauti Ji Ki': 'ਵਾਰ ਸ੍ਰੀ ਭਗਉਤੀ ਜੀ ਕੀ',
  'Gyan Prabodh': 'ਗਿਆਨ ਪ੍ਰਬੋਧ',
  'Chaubees Avtaar': 'ਚਉਬੀਸ ਅਵਤਾਰ',
  'Brahma Avtaar': 'ਬ੍ਰਹਮਾ ਅਵਤਾਰ',
  'Rudra Avtaar': 'ਰੁਦ੍ਰ ਅਵਤਾਰ',
  'Shabad Hazare': 'ਸ਼ਬਦ ਹਜ਼ਾਰੇ',
  '33 Svaiyay': '੩੩ ਸਵੈਯੇ',
  'Khalsa Mahima': 'ਖ਼ਾਲਸਾ ਮਹਿਮਾ',
  'Shastar Naam Mala': 'ਸ਼ਸਤ੍ਰ ਨਾਮ ਮਾਲਾ',
  Charitropakhyan: 'ਚਰਿਤ੍ਰੋਪਾਖ੍ਯਾਨ',
  Zafarnama: 'ਜ਼ਫ਼ਰਨਾਮਾ',
  Hikayat: 'ਹਿਕਾਇਤਾਂ',
  // Bhai Gurdas, Bhai Nand Lal, Sarabloh Granth, Ardaas
  'Kabit Savaiye': 'ਕਬਿੱਤ ਸਵੱਯੇ',
  Ghazals: 'ਗ਼ਜ਼ਲਾਂ',
  Rubaiyia: 'ਰੁਬਾਈਆਂ',
  'Zindagi Nama': 'ਜ਼ਿੰਦਗੀ ਨਾਮਾ',
  'First Patishahi': 'ਪਹਿਲੀ ਪਾਤਿਸ਼ਾਹੀ',
  'Second Patishahi': 'ਦੂਜੀ ਪਾਤਿਸ਼ਾਹੀ',
  'Third Patishahi': 'ਤੀਜੀ ਪਾਤਿਸ਼ਾਹੀ',
  'Fourth Patishahi': 'ਚੌਥੀ ਪਾਤਿਸ਼ਾਹੀ',
  'Fifth Patishahi': 'ਪੰਜਵੀਂ ਪਾਤਿਸ਼ਾਹੀ',
  'Sixth Patishahi': 'ਛੇਵੀਂ ਪਾਤਿਸ਼ਾਹੀ',
  'Seventh Patishahi': 'ਸੱਤਵੀਂ ਪਾਤਿਸ਼ਾਹੀ',
  'Eighth Patishahi': 'ਅੱਠਵੀਂ ਪਾਤਿਸ਼ਾਹੀ',
  'Ninth Patishahi': 'ਨੌਵੀਂ ਪਾਤਿਸ਼ਾਹੀ',
  'Tenth Patishahi': 'ਦਸਵੀਂ ਪਾਤਿਸ਼ਾਹੀ',
  Farsi: 'ਫ਼ਾਰਸੀ',
  'Khalsa Mahima (Sarabloh Granth)': 'ਖ਼ਾਲਸਾ ਮਹਿਮਾ (ਸਰਬਲੋਹ ਗ੍ਰੰਥ)',
  'Furmaan Dasmesh Jee Daa': 'ਫ਼ੁਰਮਾਨ ਦਸਮੇਸ਼ ਜੀ ਦਾ',
  Ardaas: 'ਅਰਦਾਸ',
};

/** A section name in Gurmukhi ('' when there is none). */
export function sectionPa(name: string): string {
  const vaar = name.match(/^Vaar (\d+)$/);
  if (vaar) return `ਵਾਰ ${gurmukhiDigits(vaar[1])}`;
  return SECTIONS_PA[name] ?? '';
}

/** "Ang 1226" / "ਅੰਗ ੧੨੨੬" for the Granths, page for the other sources ('' without a page). */
export function pageText(source: string, page: number, language: UiLanguage = 'en'): string {
  if (page <= 0) return '';
  const granth = /Granth/.test(source);
  return language === 'pa' ? `${granth ? 'ਅੰਗ' : 'ਪੰਨਾ'} ${gurmukhiDigits(page)}` : `${granth ? 'Ang' : 'page'} ${page}`;
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
