import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Corpus } from '../engine/corpus';
import { DisplayState, type DisplayReport } from '../main/display-state';
import { Meanings } from '../main/meanings';
import { creditText, gurmukhiDigits, pageText, sectionPa } from '../present/format';
import { HTML, PA, translate } from '../present/ui-words';

const ROOT = join(__dirname, '..', '..');

/**
 * The English keys of the renderer's t(…) and showError(…) calls (the first
 * argument, or both branches when it is `cond ? 'a' : 'b'`), Words tuples,
 * and the labels passed on to t().
 */
function rendererWords(src: string): string[] {
  const words = new Set<string>();
  const literals = (s: string) => {
    for (const m of s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) words.add((m[1] ?? m[2]).replace(/\\(.)/g, '$1'));
  };
  for (const m of src.matchAll(/(?<![\w.$])(?:t|showError)\(/g)) {
    // Scan the first argument, skipping strings and nested calls; note a top-level '?'.
    let depth = 0;
    let quote = '';
    let branches = -1;
    const start = m.index! + m[0].length;
    let i = start;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
      } else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && depth > 0) depth--;
      else if (depth === 0 && (ch === ')' || ch === ',')) break;
      else if (depth === 0 && ch === '?') branches = i;
    }
    literals(src.slice(branches >= 0 ? branches : start, i));
  }
  // setStatus(state, label, …) and renderCandidates(list, items, emptyText) pass English on to t().
  for (const m of src.matchAll(/setStatus\('\w+', ('[^']*')/g)) literals(m[1]);
  for (const m of src.matchAll(/renderCandidates\([^,]+, [^,]+, ('[^']*'|"[^"]*")\)/g)) literals(m[1]);
  // Words tuples: ['English text', …values], as micHelp returns.
  for (const m of src.matchAll(/(?:Words = |return |\? |: )\[('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g)) literals(m[1]);
  return [...words].filter((w) => /[A-Za-z]/.test(w));
}

test('every word of the operator window has a Punjabi translation', () => {
  const html = readFileSync(join(ROOT, 'static', 'index.html'), 'utf8');
  const marked = [...html.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="([^"]*)"/g)].map((m) => m[1]);
  const markup = [...html.matchAll(/data-i18n-html="([^"]*)"/g)].map((m) => m[1]);
  const words = rendererWords(readFileSync(join(ROOT, 'src', 'renderer', 'renderer.ts'), 'utf8'));
  assert.ok(marked.length > 50 && words.length > 50, `found ${marked.length} marked words and ${words.length} renderer words`);
  assert.deepEqual([...marked, ...words].filter((w) => !(w in PA)), [], 'missing from PA in src/present/ui-words.ts');
  assert.deepEqual(markup.filter((k) => !HTML[k]), [], 'missing from HTML in src/present/ui-words.ts');
  for (const [k, v] of Object.entries(PA)) {
    assert.ok(/[਀-੿]/.test(v) || !/[a-z]{3}/.test(v.replace(/\{\d\}|Esc|OBS|USB|PIN|Wi-Fi|Browser|source/g, '')), `"${k}" is not translated: "${v}"`);
    assert.deepEqual(v.match(/\{\d\}/g)?.sort(), k.match(/\{\d\}/g)?.sort(), `"${k}" keeps its placeholders`);
  }
});

test('translate fills values and falls back to English', () => {
  assert.equal(translate('pa', 'Following ({0}% sure)', 82), 'ਨਾਲ ਚੱਲ ਰਿਹਾ ਹੈ (82% ਯਕੀਨ)');
  assert.equal(translate('en', 'Following ({0}% sure)', 82), 'Following (82% sure)');
  assert.equal(translate('pa', 'Not a known word'), 'Not a known word');
});

test('every scripture section has a Gurmukhi name; angs use Gurmukhi digits', () => {
  const corpus = Corpus.load(join(ROOT, 'resources', 'corpus.json.gz'));
  const sections = new Set(corpus.shabads.map((s) => s.section).filter(Boolean));
  assert.deepEqual([...sections].filter((s) => !sectionPa(s)), []);
  assert.equal(sectionPa('Raag Sorath'), 'ਰਾਗੁ ਸੋਰਠਿ');
  assert.equal(sectionPa('Vaar 12'), 'ਵਾਰ ੧੨');
  assert.equal(gurmukhiDigits(1430), '੧੪੩੦');
  assert.equal(pageText('Sri Guru Granth Sahib', 628, 'pa'), 'ਅੰਗ ੬੨੮');
  assert.equal(pageText('Vaaran Bhai Gurdas', 3, 'pa'), 'ਪੰਨਾ ੩');
  assert.equal(pageText('Sri Guru Granth Sahib', 628), 'Ang 628');
  assert.equal(pageText('Sri Guru Granth Sahib', 0, 'pa'), '');
});

test('the Punjabi app shows the source line and credits in Gurmukhi', () => {
  const shabad = {
    index: 7,
    source: 'Sri Guru Granth Sahib',
    sourcePa: 'ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ',
    section: 'Raag Sorath',
    author: 'Guru Arjan Dev Ji',
    page: 628,
    lines: [{ line: 101, text: 'ਗੁਰਿ ਪੂਰੈ; ਕਿਰਪਾ ਧਾਰੀ ॥', role: 0 }],
  };
  const report: DisplayReport = { mode: 'bani', stream: 'Sukhmani Sahib', streamPa: 'ਸੁਖਮਨੀ ਸਾਹਿਬ', shabad, line: 101, next: null };
  const src = Array<number>(200).fill(-1);
  src[101] = 0;
  const m = Meanings.from({
    sources: [{ id: 'PSST', name: 'Prof. Sahib Singh, Sri Guru Granth Darpan' }],
    pa: Object.assign(Array<string>(200).fill(''), { 101: 'ਪੂਰੇ ਗੁਰੂ ਨੇ ਮੇਹਰ ਕੀਤੀ' }),
    paSource: src,
    enSources: [{ id: 'DSSK', name: 'Dr. Sant Singh Khalsa, Siri Guru Granth Sahib' }],
    en: Object.assign(Array<string>(200).fill(''), { 101: 'The Perfect Guru has shown His Mercy.' }),
    enSource: src,
  });
  const d = new DisplayState({ meaning: ['pa', 'en'] }, m);
  d.update(report);
  assert.equal(d.view().source, 'Sukhmani Sahib · Sri Guru Granth Sahib · Raag Sorath · Ang 628');
  assert.equal(d.view().credit, 'Arth: Prof. Sahib Singh · Translation: Dr. Sant Singh Khalsa');
  d.updateSettings({ language: 'pa' });
  assert.equal(d.view().source, 'ਸੁਖਮਨੀ ਸਾਹਿਬ · ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ · ਰਾਗੁ ਸੋਰਠਿ · ਅੰਗ ੬੨੮');
  assert.equal(d.view().credit, 'ਅਰਥ: ਪ੍ਰੋ. ਸਾਹਿਬ ਸਿੰਘ · ਅਨੁਵਾਦ: ਡਾ. ਸੰਤ ਸਿੰਘ ਖ਼ਾਲਸਾ');
  assert.equal(d.view().current?.text, 'ਗੁਰਿ ਪੂਰੈ; ਕਿਰਪਾ ਧਾਰੀ ॥', 'Gurbani itself is unchanged');
  assert.equal(creditText({ arth: 'Unknown Scholar', translation: '' }, ['hi'], 'pa'), 'ਅਰਥ: Unknown Scholar');
  assert.equal(d.updateSettings({ language: 'xx' as never }).language, 'en', 'unknown languages fall back to English');
});
