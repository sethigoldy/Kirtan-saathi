/**
 * A new shabad takes over on its own, without Search again. The fake
 * microphone plays one shabad, then another (test/fixtures/two-shabads.wav),
 * in kirtan mode: once at this computer's own pace, and once with the engine
 * held at 3× pace, as on a slow computer (KIRTAN_SAATHI_MIN_PACE), where the
 * switch used to stall.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DisplayView } from '../main/display-types';
import { launch, plain, snap, state, TWO_SHABADS_WAV, until } from './harness';

/** Opening words of the two shabads in the recording, and where the second one starts. */
const A = 'ਮੋਤੀ ਤ ਮੰਦਰ ਊਸਰਹਿ';
const B = 'ਕੋਟਿ ਕੋਟੀ ਮੇਰੀ ਆਰਜਾ';
const B_STARTS_SEC = 38.4;
/** How long after the second shabad starts it must be on screen. */
const WITHIN_SEC = 60;

/** Which of the two shabads the screens show (null: none, or searching). */
function onScreen(v: DisplayView): 'A' | 'B' | null {
  if (!v.current) return null;
  const first = v.lines.map((l) => plain(l.text));
  if (first.some((t) => t.startsWith(A))) return 'A';
  if (first.some((t) => t.startsWith(B))) return 'B';
  return null;
}

describe('Kirtan: a new shabad', () => {
  for (const [label, env] of [
    ['', {}],
    [' on a slow computer', { KIRTAN_SAATHI_MIN_PACE: '3' }],
  ] as const) {
    const name = `is found without Search again${label}`;
    it(name, { timeout: 360_000 }, async (t) => {
      const k = await launch(undefined, { audio: TWO_SHABADS_WAV, env });
      try {
        const shown = async () => onScreen(await state(k.base));
        // Kirtan is the default mode; the recording starts when listening does.
        await k.page.click('#mic');
        await until('listening', async () => ((await k.page.textContent('#mic')) ?? '').trim(), (text) => text === 'Stop listening');
        const started = Date.now();
        await until('the first shabad on screen', shown, (s) => s === 'A', B_STARTS_SEC * 1000);
        await until('the second shabad on screen, without Search again', shown, (s) => s === 'B', (B_STARTS_SEC + WITHIN_SEC) * 1000 - (Date.now() - started));
        const late = (Date.now() - started) / 1000 - B_STARTS_SEC;
        assert.ok(late <= WITHIN_SEC, `the second shabad came ${late.toFixed(0)} s after it started`);
        t.diagnostic(`the second shabad was on screen ${late.toFixed(0)} s after it started`);
        // The operator window follows too.
        await until('the operator list on the second shabad', async () => plain(await k.page.textContent('#lines')), (text) => text.includes(B));
      } catch (e) {
        await snap(k.app, name);
        throw e;
      } finally {
        await k.app.close();
      }
    });
  }
});
