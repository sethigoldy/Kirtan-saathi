/**
 * Gurbani line formatting shared by every display: vishraam markers become
 * styling, larivaar joins the words. Pure functions (no DOM) so they are
 * unit-tested in Node and reused by the presentation page.
 *
 * Shabad OS marks pauses after a word: ';' main, ',' medium, '.' short.
 */
export type Pause = 'main' | 'medium' | 'short' | null;

export interface Token {
  text: string;
  pause: Pause;
  /** Separator before this token: '' (first token or larivaar join) or ' '. */
  gap: string;
  /** ॥, । and verse numbers: never joined in larivaar. */
  mark: boolean;
}

const PAUSES: Record<string, Pause> = { ';': 'main', ',': 'medium', '.': 'short' };
const MARK = /^[॥।੦-੯0-9]+$/;

export function tokens(text: string, opts: { larivaar: boolean; vishraam: boolean }): Token[] {
  const out: Token[] = [];
  for (const raw of text.trim().split(/\s+/)) {
    if (!raw) continue;
    const pause = PAUSES[raw[raw.length - 1]] ?? null;
    const word = pause ? raw.slice(0, -1) : raw;
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
