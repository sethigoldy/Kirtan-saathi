/**
 * End-to-end checks of every operator feature, run against the real app
 * (see harness.ts). The checks share one running app and run in order,
 * the way an operator would use it: listen, steer, find, style, present,
 * share, restart.
 *
 *   npm run e2e                                         this checkout
 *   KIRTAN_APP="C:\...\Kirtan Saathi.exe" npm run e2e   an installed or packaged app
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright-core';
import type { UpdateStatus } from '../main/update-check';
import { gurmukhiDigits } from '../present/format';
import { translate } from '../present/ui-words';
import { JAPJI_WAV, launch, launchSecond, plain, releases, sleep, snap, state, until, VERSION, type App } from './harness';

const LONG = 240_000;
/** Set by the installers workflow when KIRTAN_APP is the installed Microsoft Store package. */
const STORE = process.env.E2E_EXPECT_STORE === '1';
/** Update checks that apply only to copies that do (or do not) come from the Microsoft Store. */
const GITHUB_ONLY = { skip: STORE && 'the Microsoft Store updates this copy' };
const POTHI = 'ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ ॥';

let k: App;
const page = () => k.page;
const now = () => state(k.base);
const text = async (sel: string) => ((await page().textContent(sel)) ?? '').trim();
const level = () => page().$eval('#level', (el) => parseFloat((el as HTMLElement).style.width) || 0);
const preview = () => page().frameLocator('#preview');
const updates = () => page().evaluate(() => (window as unknown as { updates: { status(): Promise<UpdateStatus> } }).updates.status());
/** A newer release as GitHub's API returns it. */
const NEWER = {
  tag_name: 'v99.0.0',
  html_url: 'https://github.com/sethigoldy/Kirtan-saathi/releases/tag/v99.0.0',
  body: "## What's new in 99.0.0\n\n- **English meaning** under the tuk\n- Full Punjabi app\n\n## Download\n\n- an installer",
};

/** A check that saves screenshots of every window when it fails. */
function check(name: string, fn: () => Promise<void>, opts: { timeout?: number; todo?: string; skip?: string | false } = {}): void {
  it(name, { timeout: opts.timeout ?? 120_000, todo: opts.todo, skip: opts.skip }, async () => {
    try {
      await fn();
    } catch (e) {
      await snap(k?.app, name);
      throw e;
    }
  });
}

/** Records each getUserMedia call: the input asked for and the device that answered. */
async function recordCaptures(p: Page): Promise<void> {
  await p.evaluate(() => {
    const w = window as unknown as { __captures: { asked: string; got: string }[] };
    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    w.__captures = [];
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      const stream = await original(c);
      const audio = (c?.audio ?? {}) as MediaTrackConstraints;
      const asked = (audio.deviceId as ConstrainDOMStringParameters | undefined)?.exact;
      w.__captures.push({ asked: String(asked ?? ''), got: stream.getAudioTracks()[0]?.label ?? '' });
      return stream;
    };
  });
}

const captures = () => page().evaluate(() => (window as unknown as { __captures: { asked: string; got: string }[] }).__captures);
/** Whether the waveform in the logo moves (it stays still when Windows or macOS asks for reduced motion). */
const logoMoves = () =>
  page().evaluate(() => {
    const bars = Array.from(document.querySelectorAll('.mark .wave line'));
    return { moving: bars.filter((b) => b.getAnimations().length > 0).length, still: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });

describe('Kirtan Saathi app', () => {
  before(async () => {
    k = await launch();
    await recordCaptures(k.page);
  }, { timeout: LONG });

  after(async () => {
    await k?.app.close().catch(() => undefined);
    if (k) rmSync(k.userData, { recursive: true, force: true });
  });

  // ---------- Start-up ----------

  check('opens the operator window with the engine ready', async () => {
    assert.equal(await page().title(), 'Kirtan Saathi');
    assert.equal(await text('#status-text'), 'Ready to listen');
    assert.equal(await text('#mic'), 'Start listening');
    assert.match(k.base, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(await page().getAttribute('[data-mode="kirtan"]', 'aria-checked'), 'true');
    assert.equal(await page().isVisible('#guide'), true, 'the three-step guide shows until a shabad appears');
    const stats = await text('#stats');
    assert.match(stats, /Corpus.*lines.*shabads/s, 'technical details list the Gurbani database');
    const banis = await page().$$eval('#bani option', (o) => o.map((x) => x.textContent ?? ''));
    assert.ok(banis.length > 5, `bani list has ${banis.length} entries`);
    assert.match((await page().$eval('#bani', (s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent)) ?? '', /Jap Ji Sahib/, 'Bani mode starts on Japji Sahib');
    const inputs = await page().$$eval('#device option', (o) => o.length);
    assert.ok(inputs >= 1, 'the input list has at least one entry');
  });

  // ---------- Presentation server (projector, OBS, phones) ----------

  check('serves the projector, overlay and follow pages', async () => {
    for (const path of ['/projector', '/overlay', '/follow']) {
      const res = await fetch(k.base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/, path);
      assert.match(await res.text(), /<title>Kirtan Saathi<\/title>/, path);
    }
    const home = await fetch(`${k.base}/`, { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), '/follow');
    assert.equal((await fetch(`${k.base}/present/present.js`)).status, 200);
    assert.equal((await fetch(`${k.base}/no-such-page`)).status, 404);
    const v = await now();
    assert.equal(v.blank, false);
    assert.equal(v.current, null, 'nothing on screen before listening');
    assert.equal(v.settings.theme, 'khanda', 'default colours');
    assert.equal(v.settings.waheguru, true, 'ਵਾਹਿਗੁਰੂ while searching is on by default');
    // Live updates (Server-Sent Events) start with the current view.
    const ctl = new AbortController();
    const events = await fetch(`${k.base}/events`, { signal: ctl.signal });
    assert.match(events.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = events.body!.getReader();
    let first = '';
    while (!first.includes('data: {')) first += new TextDecoder().decode((await reader.read()).value);
    ctl.abort();
    assert.match(first, /retry: 2000/);
  });

  check('takes screen controls over HTTP and rejects bad requests', async () => {
    const post = (body: string) =>
      fetch(`${k.base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal((await post('{"action":"blank"}')).status, 200);
    await until('the screens to blank', now, (v) => v.blank);
    await page().waitForSelector('#blank-badge:not([hidden])');
    assert.equal((await post('{"action":"unblank"}')).status, 200);
    await until('the screens to show again', now, (v) => !v.blank);
    await page().waitForSelector('#blank-badge', { state: 'hidden' });
    assert.equal((await post('{"action":"explode"}')).status, 400, 'unknown action');
    assert.equal((await post('not json')).status, 400, 'invalid JSON');
    assert.equal((await post(JSON.stringify({ action: 'blank', pad: 'x'.repeat(5000) }))).status, 413, 'oversized body');
    assert.equal((await now()).blank, false);
  });

  // ---------- Listening ----------

  check('follows paath from the microphone', async () => {
    await page().click('[data-mode="paath"]');
    assert.equal(await page().getAttribute('[data-mode="paath"]', 'aria-checked'), 'true');
    await page().click('#mic');
    await until('the button to read Stop listening', () => text('#mic'), (t) => t === 'Stop listening');
    await until('the input level meter to move', level, (l) => l > 0, 10_000);
    await until('the logo waveform to move while listening', logoMoves, (m) => m.moving === (m.still ? 0 : 5));
    await page().waitForSelector('#lines li.current', { timeout: 150_000 });
    assert.match(await text('#status-text'), /^Following/);
    const v = await until('the screens to show a line', now, (x) => x.current !== null);
    assert.equal(v.mode, 'paath');
    assert.match(v.source, /Sri Guru Granth Sahib.*Ang 1/, 'Japji Sahib is on Ang 1');
    // Operator window: the shabad, the current line and where it is from.
    assert.ok((await page().$$('#lines li')).length > 3);
    assert.equal(await page().isHidden('#guide'), true);
    assert.match(await text('#now-meta'), /Sri Guru Granth Sahib/);
    // Live preview of the projector: current line, next line and source.
    await until('the preview to show the current line', async () => plain(await preview().locator('#current .gu').textContent()), (t) => t.length > 0);
    assert.notEqual(plain(await preview().locator('#next').textContent()), '', 'paath shows the next line by default');
    assert.match((await preview().locator('#source').textContent()) ?? '', /Ang 1/);
    // Technical details: decoding stats and what the recognizer heard.
    assert.match(await text('#stats'), /Decode/);
    assert.notEqual(await text('#asr'), '');
  }, { timeout: LONG });

  check('shows a confidence of at most 100% while following', async () => {
    const pct = Number((await text('#status-text')).match(/(\d+)% sure/)?.[1]);
    assert.ok(pct >= 0 && pct <= 100, `status shows ${pct}% sure`);
  });

  check('switches the input while listening', async () => {
    const options = await page().$$eval('#device option', (o) => o.map((x) => ({ value: (x as HTMLOptionElement).value, label: x.textContent ?? '' })));
    const current = await page().$eval('#device', (s) => (s as HTMLSelectElement).value);
    const other = options.find((o) => o.value && o.value !== current && o.value !== 'default');
    assert.ok(other, `needs a second input; found ${JSON.stringify(options)}`);
    const before = (await captures()).length;
    await page().selectOption('#device', other.value);
    const got = await until('capture to restart on the chosen input', captures, (c) => c.length > before && c[c.length - 1].asked === other.value);
    assert.equal(got[got.length - 1].got, other.label, 'audio comes from the chosen input');
    assert.equal(await text('#mic'), 'Stop listening');
    assert.equal(await page().isHidden('#error'), true);
    await page().$eval('#level', (el) => ((el as HTMLElement).style.width = '0'));
    await until('the level meter to move on the new input', level, (l) => l > 0, 10_000);
  });

  check('stops listening', async () => {
    await page().click('#mic');
    await until('the button to read Start listening', () => text('#mic'), (t) => t === 'Start listening');
    assert.equal(await text('#status-text'), 'Not listening');
    assert.equal(await level(), 0);
    assert.equal((await logoMoves()).moving, 0, 'the logo is still when not listening');
    assert.ok((await page().$$('#lines li')).length > 0, 'the shabad stays on screen');
  });

  check('puts a clicked line on every screen', async () => {
    const lines = await page().$$eval('#lines li:not(.header):not(.current)', (l) => l.map((x) => Number((x as HTMLElement).dataset.line)));
    const target = lines[lines.length - 1];
    assert.ok(target, 'a line to click');
    await page().click(`#lines li[data-line="${target}"]`);
    const v = await until('the clicked line on screen', now, (x) => x.current?.line === target);
    await until('the preview to show it', async () => plain(await preview().locator('#current .gu').textContent()), (t) => t === plain(v.current!.text));
  });

  check('explains when the chosen input is missing', async () => {
    await page().click('#mic');
    await until('the button to read Stop listening', () => text('#mic'), (t) => t === 'Stop listening');
    await page().$eval('#device', (s) => {
      const o = document.createElement('option');
      o.value = 'unplugged-mixer';
      o.textContent = 'Unplugged mixer';
      s.append(o);
    });
    await page().selectOption('#device', 'unplugged-mixer');
    await page().waitForSelector('#error:not([hidden])');
    assert.match(await text('#error'), /No microphone was found/);
    await until('the button to read Start listening', () => text('#mic'), (t) => t === 'Start listening');
    await page().$eval('#device option[value="unplugged-mixer"]', (o) => o.remove());
  });

  // ---------- Modes ----------

  check('switches between kirtan, paath and bani', async () => {
    await page().click('[data-mode="bani"]');
    assert.equal(await page().getAttribute('[data-mode="bani"]', 'aria-checked'), 'true');
    assert.equal(await page().isVisible('#bani'), true, 'the bani picker appears');
    await until('bani mode on the screens', now, (v) => v.mode === 'bani');
    const second = await page().$eval('#bani', (s) => (s as HTMLSelectElement).options[1].value);
    await page().selectOption('#bani', second);
    await until('bani mode to stay on after picking a bani', now, (v) => v.mode === 'bani');
    await page().click('[data-mode="kirtan"]');
    assert.equal(await page().isHidden('#bani'), true);
    assert.equal(await page().getAttribute('[data-mode="paath"]', 'aria-checked'), 'false');
    const v = await until('kirtan mode on the screens', now, (x) => x.mode === 'kirtan');
    assert.equal(v.current, null, 'changing mode starts a new search');
    assert.equal((await page().$$('#lines li')).length, 0);
  });

  // ---------- Find ----------

  check('finds a shabad by Gurmukhi text and shows it', async () => {
    await page().click('[data-tab="find"]');
    assert.equal(await page().isVisible('#search'), true);
    assert.equal(await page().isHidden('[data-panel="screen"]'), true);
    await page().fill('#search', 'ਪੋਥੀ ਪਰਮੇਸਰ');
    await page().press('#search', 'Enter');
    await page().waitForSelector('#results li button');
    const results = await page().$$eval('#results li', (l) => l.map((x) => x.textContent ?? ''));
    const i = results.findIndex((r) => r.includes(POTHI));
    assert.ok(i >= 0, `"${POTHI}" in the results: ${results.join(' | ')}`);
    assert.match(results[i], /% match/);
    await page().locator('#results li').nth(i).locator('button', { hasText: 'Show this' }).click();
    const v = await until('the shabad on screen', now, (x) => plain(x.current?.text) === plain(POTHI));
    assert.ok(v.lines.length >= 5, 'the whole shabad is sent to phones');
    await until('the preview to show it', async () => plain(await preview().locator('#current .gu').textContent()), (t) => t === plain(POTHI));
  });

  check('lists the shabad chosen in Find in the operator window and follows Next and clicks', async () => {
    const v = await now();
    const chosen = v.current!.line;
    await until('the operator shabad list', async () => (await page().$$('#lines li')).length, (n) => n === v.lines.length, 5_000);
    assert.equal(await page().isHidden('#guide'), true);
    const highlighted = () => page().$eval('#lines li.current', (l) => Number((l as HTMLElement).dataset.line)).catch(() => null);
    await until('the chosen line highlighted', highlighted, (l) => l === chosen);
    await page().click('#next');
    const next = (await until('the next line', now, (x) => x.current?.line !== chosen)).current!.line;
    await until('Next to move the highlight', highlighted, (l) => l === next);
    const lines = await page().$$eval('#lines li:not(.header):not(.current)', (l) => l.map((x) => Number((x as HTMLElement).dataset.line)));
    const other = lines[lines.length - 1];
    await page().click(`#lines li[data-line="${other}"]`);
    await until('the clicked line on screen', now, (x) => x.current?.line === other);
    await until('the click to move the highlight', highlighted, (l) => l === other);
    await page().click(`#lines li[data-line="${chosen}"]`);
    await until('back to the chosen line', now, (x) => x.current?.line === chosen);
  });

  check('moves between lines with the buttons and arrow keys', async () => {
    const start = (await now()).current!.line;
    await page().click('#next');
    const next = (await until('the next line', now, (v) => v.current?.line !== start)).current!.line;
    assert.ok(next > start, 'Next moves forward');
    await page().click('#prev');
    await until('the previous line', now, (v) => v.current?.line === start);
    await page().click('#status');
    await page().keyboard.press('ArrowRight');
    await until('Right arrow to move forward', now, (v) => v.current?.line === next);
    await page().keyboard.press('ArrowLeft');
    await until('Left arrow to move back', now, (v) => v.current?.line === start);
    // Typing in the search box must not move the screens.
    await page().focus('#search');
    await page().keyboard.press('ArrowRight');
    await sleep(1000);
    assert.equal((await now()).current?.line, start, 'arrow keys in the search box are for typing');
  });

  check('blanks and restores every screen', async () => {
    await page().click('[data-tab="screen"]');
    await page().click('#blank');
    await until('the screens to blank', now, (v) => v.blank);
    await page().waitForSelector('#blank-badge:not([hidden])');
    assert.match(await text('#blank'), /Show again/);
    await until('the preview to blank', () => preview().locator('html').getAttribute('class'), (c) => /\bblank\b/.test(c ?? ''));
    await page().click('#blank');
    await until('the screens to show again', now, (v) => !v.blank);
    assert.match(await text('#blank'), /Blank/);
    await page().click('#status');
    await page().keyboard.press('b');
    await until('B to blank', now, (v) => v.blank);
    await page().keyboard.press('B');
    await until('B to show again', now, (v) => !v.blank);
    await page().click('[data-tab="find"]');
    await page().focus('#search');
    await page().keyboard.type('b');
    await sleep(1000);
    assert.equal((await now()).blank, false, 'typing b in the search box does not blank');
    await page().fill('#search', '');
    await page().click('[data-tab="screen"]');
  });

  // ---------- Look ----------

  check('changes text size, colours, script and meaning on every screen', async () => {
    const cur = preview().locator('#current');
    const root = preview().locator('html');
    const settings = async () => (await now()).settings;

    await page().fill('#font-scale', '1.5');
    await until('text size 1.5', settings, (s) => s.fontScale === 1.5);

    for (const theme of ['dark', 'saffron', 'light', 'khanda', 'dark'] as const) {
      await page().click(`label.sw-${theme}`);
      await until(`the ${theme} colours`, settings, (s) => s.theme === theme);
      await until(`the preview in ${theme}`, () => root.getAttribute('data-theme'), (t) => t === theme);
    }

    const pick = (name: string, value: string) => page().click(`label:has(input[name="${name}"][value="${value}"])`);
    await pick('hindi', 'below');
    await until('Hindi under the tuk', async () => (await cur.locator('.hi').textContent()) ?? '', (t) => /[\u0900-\u097F]/.test(t));
    assert.equal(await cur.locator('.gu').count(), 1, 'Gurmukhi stays');
    await pick('hindi', 'only');
    await until('Hindi only', () => cur.locator('.gu').count(), (n) => n === 0);
    assert.equal(await cur.locator('.hi.solo').count(), 1);
    await pick('hindi', 'off');
    await until('Gurmukhi only', () => cur.locator('.hi').count(), (n) => n === 0);

    // Meanings: any of Punjabi, Hindi and English, in that order.
    const meaning = (lang: string) => page().click(`label:has(input[name="meaning"][value="${lang}"])`);
    const shown = () => cur.locator('.arth > div').evaluateAll((d) => d.map((x) => x.className));
    await meaning('pa');
    const v = await until('the Punjabi arth', now, (x) => !!x.current?.pa);
    assert.equal(v.credit, 'Arth: Prof. Sahib Singh');
    await until('the arth under the tuk', async () => (await cur.locator('.arth-pa').textContent()) ?? '', (t) => t.length > 0);
    await meaning('en');
    const ve = await until('Punjabi and English', now, (x) => x.settings.meaning.join() === 'pa,en');
    assert.match(ve.current?.en ?? '', /[A-Za-z]{3}/, 'an English translation for this Sri Guru Granth Sahib line');
    assert.equal(ve.credit, 'Arth: Prof. Sahib Singh · Translation: Dr. Sant Singh Khalsa');
    await until('English under the Punjabi arth', shown, (c) => c.join() === 'arth-pa,arth-en');
    assert.equal(((await cur.locator('.arth-en').textContent()) ?? '').trim(), ve.current?.en);
    await until('both credits on the source line', async () => (await preview().locator('#source').textContent()) ?? '', (t) => t.endsWith('Arth: Prof. Sahib Singh · Translation: Dr. Sant Singh Khalsa'));
    await meaning('pa');
    await until('English only', shown, (c) => c.join() === 'arth-en');
    assert.equal((await now()).credit, 'Translation: Dr. Sant Singh Khalsa');
    await meaning('hi');
    await until('Hindi before English', shown, (c) => c.join() === 'arth-hi,arth-en');
    assert.match((await cur.locator('.arth-hi').textContent()) ?? '', /[\u0900-\u097F]/);
    await meaning('hi');
    await meaning('en');
    await until('no meaning', () => cur.locator('.arth').count(), (n) => n === 0);
    assert.deepEqual((await now()).settings.meaning, []);

    const toggle = (id: string) => page().click(`label:has(#${id})`);
    const spaces = async () => ((await cur.locator('.gu').textContent()) ?? '').trim().split(' ').length - 1;
    await until('vishraam colours (on by default)', () => cur.locator('.gu [class^="v-"]').count(), (n) => n > 0);
    await toggle('opt-vishraam');
    await until('vishraam off', settings, (s) => !s.vishraam);
    await until('no vishraam colours', () => cur.locator('.gu [class^="v-"]').count(), (n) => n === 0);
    await toggle('opt-vishraam');
    await until('vishraam on', settings, (s) => s.vishraam);

    const spaced = await spaces();
    await toggle('opt-larivaar');
    await until('larivaar on', settings, (s) => s.larivaar);
    await until('joined words', spaces, (n) => n < spaced);
    await toggle('opt-larivaar');
    await until('larivaar off', settings, (s) => !s.larivaar);

    await toggle('opt-next');
    await until('next line off', settings, (s) => !s.nextLine);
    await toggle('opt-next');
    await until('next line on', settings, (s) => s.nextLine);

    await toggle('opt-source');
    await until('source off', settings, (s) => !s.showSource);
    await until('no source line', async () => (await preview().locator('#source').textContent()) ?? '', (t) => t === '');
    await toggle('opt-source');
    await until('source line back', async () => (await preview().locator('#source').textContent()) ?? '', (t) => /Sri Guru Granth Sahib/.test(t));
  });

  // ---------- Projector ----------

  check('opens the projector window and closes it with Esc or Hide', async () => {
    const displays = await page().$$eval('#proj-display option', (o) => o.map((x) => x.textContent ?? ''));
    assert.equal(displays[0], 'Second screen (automatic)');
    assert.ok(displays.length >= 2, 'connected displays are listed');

    const opened = k.app.waitForEvent('window');
    await page().click('#proj-toggle');
    const proj = await opened;
    assert.match(proj.url(), /\/projector$/);
    await until('the toggle to read Hide', () => text('#proj-toggle'), (t) => t === 'Hide');
    assert.match(await text('#proj-status'), /^Showing on|^Waiting/);
    const v = await now();
    await until('the projector to show the current line', async () => plain(await proj.locator('#current .gu').textContent()), (t) => t === plain(v.current!.text));
    assert.equal(await proj.locator('html').getAttribute('data-theme'), 'dark');

    // A real key press (before-input-event), not a page-level key event.
    await k.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('/projector'));
      w?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    });
    await until('Esc to close the projector', async () => proj.isClosed(), (c) => c);
    await until('the toggle to read Show', () => text('#proj-toggle'), (t) => t === 'Show');

    const again = k.app.waitForEvent('window');
    await page().click('#proj-toggle');
    const proj2 = await again;
    await until('the toggle to read Hide', () => text('#proj-toggle'), (t) => t === 'Hide');
    await page().click('#proj-toggle');
    await until('Hide to close the projector', async () => proj2.isClosed(), (c) => c);
  });

  // ---------- Phones and OBS ----------

  check('phones follow the whole shabad live', async () => {
    const opened = k.app.waitForEvent('window');
    await k.app.evaluate(({ BrowserWindow }, url) => {
      const w = new BrowserWindow({ width: 420, height: 800, show: false });
      void w.loadURL(url);
    }, `${k.base}/follow`);
    const phone = await opened;
    try {
      let v = await now();
      await until('every line of the shabad', () => phone.locator('#lines li').count(), (n) => n === v.lines.length);
      await until('the live line highlighted', () => phone.locator('#lines li.current').getAttribute('data-line'), (l) => l === String(v.current!.line));
      assert.match((await phone.locator('#follow-source').textContent()) ?? '', /Sri Guru Granth Sahib/);

      const shown = v.current!.line;
      await page().click('#next');
      v = await until('the next line', now, (x) => x.current?.line !== shown);
      await until('the phone to follow', () => phone.locator('#lines li.current').getAttribute('data-line'), (l) => l === String(v.current!.line));
      await page().click('#prev');

      // Each reader's own controls.
      await phone.click('#larger');
      await until('larger text', () => phone.evaluate(() => document.documentElement.style.getPropertyValue('--follow-scale')), (s) => s === '1.1');
      await phone.click('#smaller');
      await until('smaller text', () => phone.evaluate(() => document.documentElement.style.getPropertyValue('--follow-scale')), (s) => s === '1');
      await phone.click('#script');
      assert.equal((await phone.locator('#script').textContent())?.trim(), 'ਗੁ + हि');
      await until('Hindi on the phone', async () => (await phone.locator('#lines').textContent()) ?? '', (t) => /[\u0900-\u097F]/.test(t));
      // The reader's own meaning, even with the projector's meanings off.
      const arth = async () => (await phone.locator('#arth').textContent())?.trim();
      await phone.click('#arth');
      assert.equal(await arth(), 'ਅਰਥ');
      await until('the Punjabi arth on the phone', () => phone.locator('#lines li.current .arth-pa').count(), (n) => n === 1);
      await phone.click('#arth');
      await phone.click('#arth');
      assert.equal(await arth(), 'EN');
      await until('English on the phone', async () => (await phone.locator('#lines li.current .arth-en').textContent()) ?? '', (t) => /[A-Za-z]{3}/.test(t));
      assert.match((await phone.locator('#follow-source').textContent()) ?? '', /Translation: Dr\. Sant Singh Khalsa$/);
      assert.deepEqual((await now()).settings.meaning, [], "a phone's choices do not change the projector");
      assert.equal(await preview().locator('#current .arth').count(), 0, 'the projector shows no meaning');

      // OBS overlay: same view, overlay layout.
      await phone.goto(`${k.base}/overlay`);
      assert.equal(await phone.locator('html').getAttribute('data-layout'), 'overlay');
      await until('the overlay line', async () => plain(await phone.locator('#current .gu').textContent()), (t) => t.length > 0);
    } finally {
      await phone.close();
    }
  });

  check('copies the OBS overlay address', async () => {
    await page().click('[data-tab="share"]');
    assert.equal(await text('#url-overlay'), `${k.base}/overlay`);
    await page().click('button[data-copy="url-overlay"]');
    await until('the address on the clipboard', () => k.app.evaluate(({ clipboard }) => clipboard.readText()), (t) => t === `${k.base}/overlay`);
  });

  check('lets phones on the Wi-Fi follow along', async () => {
    await page().click('label:has(#opt-lan)');
    await until('the Wi-Fi addresses', () => text('#lan-urls'), (t) => /Open this address in the phone browser/.test(t));
    const urls = await page().$$eval('#lan-urls code', (c) => c.map((x) => x.textContent ?? ''));
    for (const u of urls) assert.match(u, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/follow$/);
    if (urls.length) {
      const res = await until('the follow page on the Wi-Fi address', () => fetch(urls[0]), (r) => r.status === 200);
      assert.equal(res.status, 200);
    } else {
      assert.match(await text('#lan-urls'), /No Wi-Fi or network connection/);
    }
    await until('the server on this computer', () => fetch(`${k.base}/api/state`), (r) => r.status === 200);
    await page().click('label:has(#opt-lan)');
    await until('Wi-Fi sharing off', () => text('#lan-urls'), (t) => t === '');
    assert.equal(await page().isChecked('#opt-lan'), false);
    await until('the server on this computer', () => fetch(`${k.base}/api/state`), (r) => r.status === 200);
    await page().click('[data-tab="screen"]');
  });

  // ---------- Punjabi app ----------

  check('switches the whole app to Punjabi and back', async () => {
    const language = (value: string) => page().click(`label:has(input[name="language"][value="${value}"])`);
    const previewSource = async () => ((await preview().locator('#source').textContent()) ?? '').trim();
    const gurmukhiOnly = (t: string) => /[\u0A00-\u0A7F]/.test(t) && !/[A-Za-z]/.test(t);
    const v = await now();
    assert.match(v.source, /^Sri Guru Granth Sahib · .+ · Ang \d+$/, 'a Sri Guru Granth Sahib shabad is shown');

    await page().click('[data-tab="app"]');
    await language('pa');
    try {
      await until('the Punjabi app', now, (x) => x.settings.language === 'pa');
      await until('Punjabi tabs', () => text('[data-tab="screen"]'), (t) => t === 'ਸਕਰੀਨ');
      assert.equal(await text('[data-tab="app"]'), 'ਐਪ');
      assert.equal(await text('#mic'), 'ਸੁਣਨਾ ਸ਼ੁਰੂ ਕਰੋ');
      assert.ok(gurmukhiOnly(await text('#status-text')), `status in Punjabi: ${await text('#status-text')}`);
      assert.equal(await page().getAttribute('#prev', 'title'), 'ਪਿਛਲੀ ਤੁਕ (ਖੱਬਾ ਤੀਰ)', 'tooltips too');
      assert.equal(await text('#app-version'), `ਕੀਰਤਨ ਸਾਥੀ ${gurmukhiDigits(VERSION)}`);
      assert.equal(await page().locator('[data-mode="kirtan"] .en-only').isVisible(), false, 'no English beside ਕੀਰਤਨ');
      assert.ok(await page().isVisible('#error'), 'the missing-input message from earlier is still shown');
      assert.equal(await text('#error'), translate('pa', "No microphone was found. Plug in a microphone or the mixer's USB / line input, choose it in the input list, then press Start listening."));
      await until('the shabad heading in Punjabi', () => text('#now-meta'), (t) => /^ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ .+, ਅੰਗ [੦-੯]+$/.test(t));

      // Every screen: the source line in Gurmukhi, Gurbani unchanged.
      const pa = await until('the source line in Gurmukhi', now, (x) => /^ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ · .+ · ਅੰਗ [੦-੯]+$/.test(x.source));
      assert.ok(gurmukhiOnly(pa.source), pa.source);
      assert.equal(pa.current?.text, v.current?.text, 'Gurbani is unchanged');
      await until('the preview source line', previewSource, (t) => t === pa.source);

      const opened = k.app.waitForEvent('window');
      await k.app.evaluate(({ BrowserWindow }, url) => {
        const w = new BrowserWindow({ width: 420, height: 800, show: false });
        void w.loadURL(url);
      }, `${k.base}/follow`);
      const phone = await opened;
      try {
        const followSource = async () => ((await phone.locator('#follow-source').textContent()) ?? '').trim();
        const arth = async () => ((await phone.locator('#arth').textContent()) ?? '').trim();
        await until('the phone title in Punjabi', async () => ((await phone.locator('.follow-title strong').textContent()) ?? '').trim(), (t) => t === 'ਕੀਰਤਨ ਸਾਥੀ');
        await until('the phone source line', followSource, (t) => t.startsWith(pa.source));
        // The reader's own meaning choice is remembered on the phone: step to Punjabi + English, then back.
        const was = await arth();
        for (let i = 0; i < 6 && (await arth()) !== 'ਅਰਥ+EN'; i++) await phone.click('#arth');
        await until('both credits in Gurmukhi', followSource, (t) => t === `${pa.source} · ਅਰਥ: ਪ੍ਰੋ. ਸਾਹਿਬ ਸਿੰਘ · ਅਨੁਵਾਦ: ਡਾ. ਸੰਤ ਸਿੰਘ ਖ਼ਾਲਸਾ`);
        for (let i = 0; i < 6 && (await arth()) !== was; i++) await phone.click('#arth');
      } finally {
        await phone.close();
      }
    } finally {
      await language('en');
    }

    await until('the English app', now, (x) => x.settings.language === 'en');
    await until('English tabs', () => text('[data-tab="screen"]'), (t) => t === 'Screen');
    assert.equal(await text('#mic'), 'Start listening');
    assert.equal(await page().locator('[data-mode="kirtan"] .en-only').isVisible(), true);
    await until('the English source line', previewSource, (t) => t === v.source);
    assert.equal(await text('#app-version'), `Kirtan Saathi ${VERSION}`);
    await page().click('[data-tab="screen"]');
  });

  // ---------- Search again, recordings ----------

  check('Search again clears the line and shows ਵਾਹਿਗੁਰੂ while searching', async () => {
    await page().click('#reset');
    await until('the screens to clear', now, (v) => v.current === null);
    const shown = async () => ((await preview().locator('#current').textContent()) ?? '').trim();
    await until('ਵਾਹਿਗੁਰੂ on the preview', shown, (t) => t === 'ਵਾਹਿਗੁਰੂ');
    assert.equal(((await preview().locator('#source').textContent()) ?? '').trim(), '', 'no source line under ਵਾਹਿਗੁਰੂ');
    await page().click('label:has(#opt-waheguru)');
    await until('the switch off', async () => (await now()).settings.waheguru, (w) => !w);
    await until('an empty preview', () => preview().locator('#stage').getAttribute('class'), (c) => /\bempty\b/.test(c ?? ''));
    await page().click('label:has(#opt-waheguru)');
    await until('ਵਾਹਿਗੁਰੂ back', shown, (t) => t === 'ਵਾਹਿਗੁਰੂ');
    await page().click('#blank');
    await until('Blank to hide ਵਾਹਿਗੁਰੂ too', () => preview().locator('html').getAttribute('class'), (c) => /\bblank\b/.test(c ?? ''));
    await page().click('#blank');
    await until('the screens to show again', now, (v) => !v.blank);
  });

  check('follows a recording file', async () => {
    await page().click('[data-mode="paath"]');
    await page().setInputFiles('#file', JAPJI_WAV);
    await until('the button to read Stop listening', () => text('#mic'), (t) => t === 'Stop listening');
    await until('the input level meter to move', level, (l) => l > 0, 10_000);
    const v = await until('the recording to be followed', now, (x) => x.current !== null, 150_000);
    assert.match(v.source, /Ang 1/);
    await page().waitForSelector('#lines li.current');
    await page().click('#mic');
    await until('the button to read Start listening', () => text('#mic'), (t) => t === 'Start listening');
  }, { timeout: LONG });

  // ---------- Updates ----------

  check('tells the operator about a new release and what changed', async () => {
    await page().click('[data-tab="app"]');
    assert.equal(await text('#app-version'), `Kirtan Saathi ${VERSION}`);
    assert.equal(await page().isChecked('#opt-update-check'), true, 'checks for updates by default');
    assert.equal(await page().isChecked('#opt-update-auto'), false, 'installs only when asked, by default');
    // GitHub's latest release is this version: nothing to offer.
    await page().click('#update-check');
    await until('up to date', () => text('#update-state'), (t) => t === 'You have the latest version.');
    assert.equal(await page().isHidden('#update'), true);
    // A newer release, with its notes.
    releases.answer = NEWER;
    await page().click('#update-check');
    await page().waitForSelector('#update:not([hidden])');
    assert.equal(await text('#update-title'), 'Kirtan Saathi 99.0.0 is available');
    assert.deepEqual(await page().$$eval('#update-notes li', (l) => l.map((x) => x.textContent)), ['English meaning under the tuk', 'Full Punjabi app']);
    const st = await updates();
    assert.equal(st.store, false);
    assert.equal(await page().isVisible('#update-switches'), true);
    assert.equal(await page().isVisible('#update-install'), st.canInstall, 'Update now where the app can update itself');
    assert.equal(await page().isVisible('#update-download'), !st.canInstall, 'otherwise a link to the download');
    assert.equal(await page().isDisabled('#opt-update-auto'), !st.canInstall);
    await page().click('#update-later');
    await until('Later to hide the notice', () => page().isHidden('#update'), (h) => h);
    assert.match(await text('#update-state'), /Version 99\.0\.0 is available/);
  }, GITHUB_ONLY);

  check('leaves updates to the Microsoft Store', async () => {
    await page().click('[data-tab="app"]');
    assert.equal(await text('#app-version'), `Kirtan Saathi ${VERSION}`);
    const st = await updates();
    assert.equal(st.store, true, 'the installed package runs as a Microsoft Store app');
    assert.equal(st.canInstall, false);
    assert.equal(await text('#update-auto-hint'), 'The Microsoft Store keeps Kirtan Saathi up to date.');
    assert.equal(await page().isHidden('#update-switches'), true);
    assert.equal(await page().isHidden('#update-check-row'), true);
    // Neither the connection coming back nor an explicit check asks GitHub.
    releases.answer = NEWER;
    const asked = releases.asked;
    await page().evaluate(() => window.dispatchEvent(new Event('online')));
    await page().evaluate(() => (window as unknown as { updates: { check(manual: boolean): Promise<void> } }).updates.check(true));
    await sleep(2000);
    assert.equal(releases.asked, asked, 'no request for the latest release');
    assert.equal((await updates()).state, 'idle');
    assert.equal(await page().isHidden('#update'), true, 'no update notice');
    releases.answer = { tag_name: `v${VERSION}` };
    await page().click('[data-tab="screen"]');
  }, { skip: !STORE && 'only copies from the Microsoft Store' });

  check('reports a failed check when asked, and stays quiet otherwise', async () => {
    releases.status = 500;
    // Automatic check (the connection coming back): no notice, no message.
    await page().evaluate(() => window.dispatchEvent(new Event('online')));
    await until('the automatic check to finish', async () => (await updates()).state, (s) => s === 'idle');
    assert.equal(await text('#update-state'), '');
    assert.equal(await page().isHidden('#update'), true);
    // Check now: the operator sees why.
    await page().click('#update-check');
    await until('the error', () => text('#update-state'), (t) => t === 'Could not check for updates: GitHub answered HTTP 500');
    assert.equal(await page().isHidden('#update'), true);
    releases.status = 200;
    await page().click('#update-check');
    await page().waitForSelector('#update:not([hidden])', { timeout: 15_000 });
    assert.equal(await text('#update-title'), 'Kirtan Saathi 99.0.0 is available', 'Check now shows a release dismissed with Later again');
  }, GITHUB_ONLY);

  check('downloads the update where the app can update itself', async () => {
    const st = await updates();
    // The installers workflow sets this for the installed Windows app, so self-update cannot quietly turn off.
    if (process.env.E2E_EXPECT_SELF_UPDATE === '1') assert.equal(st.canInstall, true, 'the installed app can update itself');
    if (!st.canInstall) {
      // Development runs, .deb and macOS: the release page instead (opening a browser is not tested).
      assert.equal(await page().isVisible('#update-download'), true);
      assert.equal(await page().isVisible('#update-install'), false);
      return;
    }
    releases.feed = { version: '99.0.0', payload: randomBytes(512 * 1024) };
    assert.equal(await text('#update-install'), 'Update now');
    await page().click('#update-install');
    const done = await until('the download to finish or fail', updates, (s) => s.state === 'ready' || !!s.message, 60_000);
    assert.equal(done.message, '', 'the download did not fail');
    assert.equal(await text('#update-state'), 'Version 99.0.0 is downloaded. It installs when you close Kirtan Saathi.');
    assert.equal(await text('#update-title'), 'Kirtan Saathi 99.0.0 is ready to install');
    assert.equal(await text('#update-install'), 'Restart and update');
    assert.equal(await page().isHidden('#update-download'), true);
    // Test downloads are never installed (KIRTAN_SAATHI_UPDATE_FEED), so the restart below stays on this version.
  }, { timeout: 120_000, ...GITHUB_ONLY });

  check('keeps the update settings', async () => {
    const st = await updates();
    await page().click('label:has(#opt-update-check)');
    await until('checks off', async () => (await updates()).prefs.check, (c) => !c);
    if (st.canInstall) {
      await page().click('label:has(#opt-update-auto)');
      await until('automatic updates on', async () => (await updates()).prefs.auto, (a) => a);
    }
    releases.answer = { tag_name: `v${VERSION}` };
    releases.feed = null;
    await page().click('[data-tab="screen"]');
  }, GITHUB_ONLY);

  // ---------- Restart ----------

  check('remembers settings after a restart', async () => {
    await k.app.close();
    k = await launch(k.userData);
    const s = (await now()).settings;
    assert.equal(s.theme, 'dark');
    assert.equal(s.fontScale, 1.5);
    assert.deepEqual(s.meaning, []);
    assert.equal(await page().isChecked('input[name="theme"][value="dark"]'), true);
    assert.equal(await page().inputValue('#font-scale'), '1.5');
    assert.equal(await page().isChecked('#opt-lan'), false);
    assert.equal(await text('#proj-toggle'), 'Show', 'the projector stays off');
    const up = await updates();
    if (STORE) {
      assert.equal(up.store, true);
      assert.equal(up.state, 'idle', 'no update check in the Store package');
    } else {
      assert.equal(up.prefs.check, false, 'update checks stay off');
      assert.equal(up.prefs.auto, up.canInstall, 'automatic updates stay on where the app can update itself');
      assert.equal(up.state, 'idle', 'no check while checks are off');
      assert.equal(await page().isChecked('#opt-update-check'), false);
      await page().click('[data-tab="app"]');
      await page().click('label:has(#opt-update-check)');
      await until('checks back on', async () => (await updates()).prefs.check, (c) => c);
      await page().click('[data-tab="screen"]');
    }
  }, { timeout: LONG });

  check('a second launch keeps the running app', async () => {
    const code = await launchSecond(k.userData);
    assert.equal(code, 0, 'the second copy hands over and exits');
    assert.equal(k.app.windows().length, 1);
    assert.equal(await page().title(), 'Kirtan Saathi');
    assert.equal((await fetch(`${k.base}/api/state`)).status, 200);
  });
});
