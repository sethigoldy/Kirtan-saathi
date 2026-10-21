import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DisplayState, type DisplayReport, type DisplayView } from '../main/display-state';
import { controlAllowed, PresentationServer, type ControlAction } from '../main/server';
import { parseSettings, SettingsStore } from '../main/settings';
import { plainText, toDevanagari, tokens } from '../present/format';
import { Meanings } from '../main/meanings';

const SHABAD = {
  index: 7,
  source: 'Sri Guru Granth Sahib',
  section: 'Raag Sorath',
  author: 'Guru Arjan Dev Ji',
  page: 628,
  lines: [
    { line: 100, text: 'ਸੋਰਠਿ ਮਹਲਾ ੫ ॥', role: 2 },
    { line: 101, text: 'ਗੁਰਿ ਪੂਰੈ; ਕਿਰਪਾ ਧਾਰੀ ॥', role: 0 },
    { line: 102, text: 'ਪ੍ਰਭਿ ਪੂਰੀ, ਲੋਚ ਹਮਾਰੀ ॥', role: 0 },
  ],
};

function report(line: number | null, mode: DisplayReport['mode'] = 'kirtan'): DisplayReport {
  return { mode, stream: null, shabad: SHABAD, line, next: null };
}

test('vishraam markers become pause levels and are removed from the text', () => {
  const t = tokens('ਗੁਰਿ ਪੂਰੈ; ਕਿਰਪਾ, ਧਾਰੀ. ॥ ੧ ॥', { larivaar: false, vishraam: true });
  assert.deepEqual(
    t.map((x) => [x.text, x.pause]),
    [['ਗੁਰਿ', null], ['ਪੂਰੈ', 'main'], ['ਕਿਰਪਾ', 'medium'], ['ਧਾਰੀ', 'short'], ['॥', null], ['੧', null], ['॥', null]],
  );
  assert.equal(tokens('ਗੁਰਿ ਪੂਰੈ;', { larivaar: false, vishraam: false })[1].pause, null);
});

test('larivaar joins words but keeps ॥ and verse numbers apart', () => {
  assert.equal(plainText('ਗੁਰਿ ਪੂਰੈ; ਕਿਰਪਾ ਧਾਰੀ ॥ ੧ ॥', { larivaar: true }), 'ਗੁਰਿਪੂਰੈਕਿਰਪਾਧਾਰੀ ॥ ੧ ॥');
  assert.equal(plainText('ਗੁਰਿ ਪੂਰੈ; ਕਿਰਪਾ ਧਾਰੀ ॥', { larivaar: false }), 'ਗੁਰਿ ਪੂਰੈ ਕਿਰਪਾ ਧਾਰੀ ॥');
});

test('display state emits only on real changes and hides next in kirtan', () => {
  const d = new DisplayState();
  const seen: DisplayView[] = [];
  d.on('change', (v) => seen.push(v));
  d.update(report(101));
  d.update(report(101)); // unchanged
  assert.equal(seen.length, 1);
  assert.equal(seen[0].current?.line, 101);
  assert.equal(seen[0].next, null, 'kirtan never previews a next line');
  assert.equal(seen[0].source, 'Sri Guru Granth Sahib · Raag Sorath · Ang 628', 'no author name with the tuk');

  d.update(report(101, 'paath'));
  assert.equal(seen.at(-1)!.next?.line, 102, 'paath falls back to the next line in the shabad');

  d.setBlank(true);
  d.setBlank(true);
  assert.equal(seen.length, 3);
  assert.equal(seen.at(-1)!.blank, true);

  assert.equal(d.settings.waheguru, true, 'ਵਾਹਿਗੁਰੂ shows while searching by default');
  assert.equal(d.updateSettings({ waheguru: false }).waheguru, false);

  const s = d.updateSettings({ fontScale: 9, theme: 'nope' as never, hindi: 'x' as never, meaning: 'y' as never });
  assert.equal(s.fontScale, 2.5);
  assert.equal(s.theme, 'khanda', 'invalid theme falls back to the default');
  assert.equal(s.hindi, 'off');
  assert.equal(s.meaning, 'off');
});

test('Gurmukhi to Devanagari follows Hindi gutka conventions', () => {
  assert.equal(toDevanagari('ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ ਨਿਰਭਉ ਨਿਰਵੈਰੁ'), 'सति नामु करता पुरखु निरभउ निरवैरु');
  assert.equal(toDevanagari('ਸੱਚ ਅੱਖਰ ਪੱਥਰ'), 'सच्च अक्खर पत्थर', 'addak doubles; aspirates pair with the plain letter');
  assert.equal(toDevanagari('ਸ਼ਬਦ ਖ਼ਾਲਸਾ ਗੋਬਿੰਦ ਆਂਗਨ'), 'शबद ख़ालसा गोबिंद आंगन');
  assert.equal(toDevanagari('ਐਸਾ ਔਰ ਉਤਮੁ ॥੧॥'), 'ऐसा और उतमु ॥१॥');
  assert.equal(toDevanagari('ੴ'), 'ੴ');
  const hi = tokens('ਗੁਰਿ ਪੂਰੈ; ਕਿਰਪਾ ਧਾਰੀ ॥', { larivaar: false, vishraam: true, hindi: true });
  assert.deepEqual(hi.map((t) => [t.text, t.pause]), [['गुरि', null], ['पूरै', 'main'], ['किरपा', null], ['धारी', null], ['॥', null]]);
});

test('meanings attach to every line only when switched on, with a credit', () => {
  const pa = Array<string>(200).fill('');
  const src = Array<number>(200).fill(-1);
  pa[101] = 'ਪੂਰੇ ਗੁਰੂ ਨੇ ਮੇਹਰ ਕੀਤੀ';
  src[101] = 0;
  const m = Meanings.from({ sources: [{ id: 'PSST', name: 'Prof. Sahib Singh, Sri Guru Granth Darpan' }], pa, paSource: src });
  const d = new DisplayState({}, m);
  d.update(report(101));
  assert.equal(d.view().current?.pa, undefined, 'off by default');
  assert.equal(d.view().credit, '');
  d.updateSettings({ meaning: 'both' });
  const v = d.view();
  assert.equal(v.current?.pa, 'ਪੂਰੇ ਗੁਰੂ ਨੇ ਮੇਹਰ ਕੀਤੀ');
  assert.equal(v.lines.find((l) => l.line === 101)?.pa, 'ਪੂਰੇ ਗੁਰੂ ਨੇ ਮੇਹਰ ਕੀਤੀ');
  assert.equal(v.credit, 'Arth: Prof. Sahib Singh');
});

test('control is open on loopback, PIN-gated on the LAN', () => {
  assert.equal(controlAllowed('127.0.0.1', { lan: false, pin: '1234' }, undefined), true);
  assert.equal(controlAllowed('::ffff:127.0.0.1', { lan: true, pin: '1234' }, undefined), true);
  assert.equal(controlAllowed('192.168.1.20', { lan: false, pin: '1234' }, '1234'), false);
  assert.equal(controlAllowed('192.168.1.20', { lan: true, pin: '1234' }, '0000'), false);
  assert.equal(controlAllowed('192.168.1.20', { lan: true, pin: '1234' }, '1234'), true);
});

function http(port: number, method: string, path: string, body?: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Read SSE frames until `count` data frames arrive. */
function events(port: number, count: number, onOpen: () => void): Promise<DisplayView[]> {
  return new Promise((resolve, reject) => {
    const got: DisplayView[] = [];
    const req = request({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (frame.startsWith('data: ')) got.push(JSON.parse(frame.slice(6)));
          if (got.length === 1 && frame.startsWith('data: ')) onOpen();
          if (got.length >= count) {
            req.destroy();
            resolve(got);
            return;
          }
        }
      });
    });
    req.on('error', (e) => (got.length >= count ? undefined : reject(e)));
    req.end();
  });
}

test('presentation server: pages, state, live events and control', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks-static-'));
  mkdirSync(join(dir, 'present'));
  writeFileSync(join(dir, 'present', 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(dir, 'present', 'present.js'), 'export {};');
  const display = new DisplayState();
  const actions: ControlAction[] = [];
  const server = new PresentationServer(display, { port: 0, lan: false, pin: '1234', staticDir: dir }, (a) => actions.push(a));
  const port = await server.start();
  try {
    for (const page of ['/projector', '/overlay', '/follow']) {
      const r = await http(port, 'GET', page);
      assert.equal(r.status, 200, page);
      assert.match(r.type, /text\/html/);
    }
    assert.match((await http(port, 'GET', '/present/present.js')).type, /javascript/);
    assert.equal((await http(port, 'GET', '/present/../../etc/passwd')).status, 404);
    assert.equal((await http(port, 'GET', '/nope')).status, 404);

    const live = events(port, 2, () => display.update(report(102)));
    const [first, second] = await live;
    assert.equal(first.current, null);
    assert.equal(second.current?.line, 102);

    const state = JSON.parse((await http(port, 'GET', '/api/state')).body) as DisplayView;
    assert.equal(state.current?.line, 102);

    assert.equal((await http(port, 'POST', '/api/control', JSON.stringify({ action: 'next' }))).status, 200);
    assert.equal((await http(port, 'POST', '/api/control', JSON.stringify({ action: 'rm -rf' }))).status, 400);
    assert.equal((await http(port, 'POST', '/api/control', '{bad')).status, 400);
    assert.deepEqual(actions, ['next']);
    assert.equal(server.urls().lanFollow.length, 0, 'no LAN addresses unless LAN mode is on');
  } finally {
    await server.stop();
  }
});

test('settings survive a damaged file and keep valid values', () => {
  const s = parseSettings({ server: { port: 80, lan: 'yes', pin: 'abc' }, projector: { enabled: true, displayId: 42 } });
  assert.equal(s.server.port, 7531, 'privileged port rejected');
  assert.equal(s.server.lan, false);
  assert.match(s.server.pin, /^\d{4}$/);
  assert.deepEqual(s.projector, { enabled: true, displayId: 42 });
  assert.equal(parseSettings({ presentation: { theme: 'dark' } }).presentation.waheguru, true, 'settings saved before ਵਾਹਿਗੁਰੂ existed get it on');

  const dir = mkdtempSync(join(tmpdir(), 'ks-settings-'));
  const file = join(dir, 'settings.json');
  writeFileSync(file, '{ not json');
  const store = new SettingsStore(file);
  store.update((x) => (x.presentation.larivaar = true));
  store.flush();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).presentation.larivaar, true);
  assert.equal(new SettingsStore(file).get().presentation.larivaar, true);
});
