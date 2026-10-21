/**
 * Operator / follow-along view (Phase 1).
 * Captures 16 kHz mono audio, streams it to the engine, renders canonical
 * Gurbani for the line the engine reports. Raw ASR text is debug-only.
 */
import type { FromEngine, ToEngine, UiCandidate, UiEvent, UiShabad } from '../main/protocol';
import type { DisplayView, MeaningLang, PresentationSettings } from '../main/display-types';
import type { UpdatePrefs, UpdateStatus } from '../main/update-check';
import { gurmukhiDigits, pageText, sectionPa, type UiLanguage } from '../present/format.js';
import { HTML, translate } from '../present/ui-words.js';

interface PresentStatus {
  projector: {
    enabled: boolean;
    displayId: number | null;
    showing: boolean;
    targetId: number | null;
    displays: { id: number; label: string; primary: boolean; width: number; height: number }[];
  };
  server: { port: number; lan: boolean; urls: { projector: string; overlay: string; follow: string; lanFollow: string[] } };
}

/** Exposed by preload.ts. */
declare global {
  interface Window {
    presentation: {
      init(): Promise<{ view: DisplayView; status: PresentStatus }>;
      micAccess(): Promise<boolean>;
      setSettings(patch: Partial<PresentationSettings>): Promise<PresentationSettings>;
      control(action: 'blank' | 'unblank' | 'next' | 'prev'): Promise<void>;
      setProjector(p: { enabled: boolean; displayId: number | null }): Promise<void>;
      setLan(lan: boolean): Promise<void>;
      copy(text: string): Promise<void>;
      open(url: string): Promise<void>;
      onView(fn: (v: DisplayView) => void): void;
      onStatus(fn: (s: PresentStatus) => void): void;
    };
    updates: {
      status(): Promise<UpdateStatus>;
      check(manual: boolean): Promise<void>;
      download(): Promise<void>;
      install(): Promise<void>;
      open(): Promise<void>;
      setPrefs(patch: Partial<UpdatePrefs>): Promise<UpdateStatus>;
      onStatus(fn: (s: UpdateStatus) => void): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The app's own words: English or Punjabi (App → Language). */
let lang: UiLanguage = 'en';
const t = (text: string, ...args: (string | number)[]) => translate(lang, text, ...args);

/** Put the window's marked words (static/index.html) in the current language. */
function applyWords(): void {
  document.documentElement.dataset.lang = lang;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) el.textContent = t(el.dataset.i18n!);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n-html]'))) el.innerHTML = HTML[el.dataset.i18nHtml!][lang];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n-title]'))) el.title = t(el.dataset.i18nTitle!);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]'))) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel!));
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]'))) el.placeholder = t(el.dataset.i18nPlaceholder!);
}

const ROLE_RAHAO = 1;
const ROLE_HEADER = 2;
const ROLE_MANGAL = 3;

let port: MessagePort | null = null;
let shabad: UiShabad | null = null;
let currentLine: number | null = null;
let capture: { stop: () => void; mic: boolean } | null = null;
let mode: 'kirtan' | 'paath' | 'bani' = 'kirtan';
let streamName: string | null = null;
let view: DisplayView | null = null;
let status: PresentStatus | null = null;

/**
 * Audio is sent by copy: ArrayBuffer transfer does not survive the hop into
 * Electron's utility process (it arrives as null). 100 ms of audio is 6.4 KB.
 */
function send(msg: ToEngine): void {
  port?.postMessage(msg);
}

/** Gurmukhi with vishraam markers rendered as styling, markers removed. */
function renderTuk(el: HTMLElement, text: string): void {
  el.textContent = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const span = document.createElement('span');
    if (word.endsWith(';')) span.className = 'v-main';
    else if (word.endsWith(',')) span.className = 'v-medium';
    else if (word.endsWith('.')) span.className = 'v-short';
    span.textContent = word.replace(/[;.,]$/, '');
    el.append(span, ' ');
  }
}

/** English text for t() with its values, kept so it can be shown again in another language. */
type Words = [string, ...(string | number)[]];

let statusWords: Words = ['Starting…'];
let errorWords: Words = [''];

/** Status line. */
function setStatus(state: 'idle' | 'listening' | 'searching' | 'locked' | 'error', label: string, ...args: (string | number)[]): void {
  $('status').className = `status status-${state}`;
  statusWords = [label, ...args];
  $('status-text').textContent = t(label, ...args);
}

/** Error bar at the bottom. Engine errors pass their own message as {0}. */
function showError(label: string, ...args: (string | number)[]): void {
  errorWords = [label, ...args];
  const el = $('error');
  el.hidden = false;
  el.textContent = t(label, ...args);
  setStatus('error', 'Something needs attention');
}

/** Ang for the Granths, page for the other sources. */
function pageLabel(source: string, page: number): string {
  return pageText(source, page, lang);
}

/** Scripture or bani name in the app's language. */
function sourceName(source: string, sourcePa?: string): string {
  if (lang !== 'pa') return source;
  return sourcePa || banis.find((b) => b.nameEn === source)?.name || source;
}

function renderShabad(): void {
  const list = $<HTMLOListElement>('lines');
  list.textContent = '';
  if (!shabad) return;
  for (const l of shabad.lines) {
    const li = document.createElement('li');
    li.dataset.line = String(l.line);
    if (l.role === ROLE_HEADER || l.role === ROLE_MANGAL) li.classList.add('header');
    if (l.role === ROLE_RAHAO) li.classList.add('rahao');
    renderTuk(li, l.text);
    if (l.role !== ROLE_HEADER && l.role !== ROLE_MANGAL) {
      li.addEventListener('click', () => send({ type: 'setLine', line: l.line }));
    }
    list.append(li);
  }
  highlight();
}

function highlight(): void {
  const list = $<HTMLOListElement>('lines');
  for (const li of Array.from(list.children) as HTMLElement[]) {
    const on = currentLine !== null && li.dataset.line === String(currentLine);
    li.classList.toggle('current', on);
    // Scroll only the shabad list, so the live preview above stays in view.
    if (on && (li.offsetTop < list.scrollTop || li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight)) {
      list.scrollTo({ top: li.offsetTop - list.clientHeight / 3, behavior: 'smooth' });
    }
  }
  const s = shabad;
  const meta = $('now-meta');
  meta.textContent = '';
  if (s) {
    const b = document.createElement('b');
    b.textContent = streamName && streamName !== s.source ? sourceName(streamName) : sourceName(s.source, s.sourcePa);
    const section = lang === 'pa' ? sectionPa(s.section) : s.section;
    meta.append(b, ` ${[section, pageLabel(s.source, s.page)].filter(Boolean).join(', ')}`);
  }
  $('guide').hidden = !!s;
}

/** Last lists shown, re-drawn when the language changes. */
const lists = new Map<HTMLOListElement, [UiCandidate[], string]>();

function renderCandidates(el: HTMLOListElement, items: UiCandidate[], emptyText: string): void {
  lists.set(el, [items, emptyText]);
  el.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t(emptyText);
    el.append(li);
    return;
  }
  for (const c of items) {
    const li = document.createElement('li');
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = c.text;
    const row = document.createElement('div');
    row.className = 'row';
    const info = document.createElement('span');
    info.textContent = t('{0} ({1}% match)', [sourceName(c.source, c.sourcePa), pageLabel(c.source, c.page)].filter(Boolean).join(', '), (c.score * 100).toFixed(0));
    const btn = document.createElement('button');
    btn.textContent = t('Show this');
    btn.title = t('Show this shabad and keep it until Search again');
    btn.addEventListener('click', () => send({ type: 'lock', shabad: c.shabad, line: c.line }));
    row.append(info, btn);
    li.append(text, row);
    el.append(li);
  }
}

let readyMsg: Extract<FromEngine, { type: 'ready' }> | null = null;
let lastEvent: UiEvent | null = null;
let banis: { id: string; name: string; nameEn: string }[] = [];

function renderStats(): void {
  const dl = $('stats');
  const base: [string, string][] = [];
  const ready = readyMsg;
  if (ready) {
    base.push([t('Corpus'), t('{0} lines · {1} shabads', ready.lines.toLocaleString(), ready.shabads.toLocaleString())]);
    base.push([t('Text source'), ready.provenance]);
    base.push([t('Threads'), String(ready.threads)]);
    base.push([t('Self-test RTF'), ready.selfTestRtf.toFixed(3)]);
    base.push([t('Load time'), t('{0} s', (ready.loadMs / 1000).toFixed(1))]);
  }
  const ev = lastEvent;
  if (ev) {
    base.push([t('Decode'), t('{0} ms for {1} s', ev.inferMs.toFixed(0), ev.windowSec.toFixed(1))]);
    base.push([t('Pace'), `${ev.paceScale.toFixed(2)}×`]);
    base.push([t('Last action'), ev.reason]);
  }
  dl.textContent = '';
  for (const [k, v] of base) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
}

function renderBanis(): void {
  const sel = $<HTMLSelectElement>('bani');
  const keep = sel.value;
  sel.textContent = '';
  for (const b of banis) {
    const o = document.createElement('option');
    o.value = b.id;
    o.textContent = lang === 'pa' ? b.name : `${b.nameEn} (${b.name})`;
    sel.append(o);
  }
  if (keep) sel.value = keep;
}

function onEngine(msg: FromEngine): void {
  switch (msg.type) {
    case 'ready': {
      setStatus('idle', 'Ready to listen');
      $<HTMLButtonElement>('mic').disabled = false;
      banis = msg.banis;
      renderBanis();
      const japji = msg.banis.find((b) => /jap\s*ji/i.test(b.nameEn));
      if (japji) $<HTMLSelectElement>('bani').value = japji.id;
      readyMsg = msg;
      renderStats();
      break;
    }
    case 'error':
      showError('{0}', msg.message);
      break;
    case 'shabad':
      shabad = msg.shabad;
      currentLine = null;
      renderShabad();
      break;
    case 'event': {
      const ev = msg.ev;
      // Locks report evidence rather than a probability, so cap at 100%.
      // A decode still in flight after Stop listening must not bring the status back.
      const live = $('mic').classList.contains('live');
      if (live && ev.state === 'locked') setStatus('locked', 'Following ({0}% sure)', Math.round(Math.min(1, ev.confidence) * 100));
      else if (live && ev.state === 'searching') setStatus('searching', 'Listening for the shabad…');
      mode = ev.mode;
      streamName = ev.stream;
      currentLine = ev.line;
      highlight();
      renderCandidates($<HTMLOListElement>('candidates'), ev.candidates, 'None yet.');
      $('asr').textContent = ev.asrText;
      lastEvent = ev;
      renderStats();
      break;
    }
    case 'line':
      streamName = msg.stream;
      currentLine = msg.line;
      highlight();
      break;
    case 'searchResults':
      renderCandidates($<HTMLOListElement>('results'), msg.results, 'No match');
      break;
  }
}

function showLevel(samples: Float32Array): void {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  const rms = Math.sqrt(s / samples.length);
  $('level').style.width = `${Math.min(100, rms * 400)}%`;
}

async function listDevices(): Promise<void> {
  const sel = $<HTMLSelectElement>('device');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const keep = sel.value;
  sel.textContent = '';
  for (const d of devices) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || t('Input {0}', sel.length + 1);
    sel.append(o);
  }
  if (!devices.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = t('Default microphone');
    sel.append(o);
  }
  if (keep && devices.some((d) => d.deviceId === keep)) sel.value = keep;
}

/** Start / stop button reflects whether audio is flowing. */
function listening(on: boolean): void {
  const b = $('mic');
  b.classList.toggle('live', on);
  document.body.classList.toggle('listening', on);
  b.textContent = t(on ? 'Stop listening' : 'Start listening');
  if (on && !shabad) setStatus('listening', 'Listening for the shabad…');
  if (!on) setStatus('idle', 'Not listening');
}

async function startMic(): Promise<void> {
  if (!(await window.presentation.micAccess())) {
    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    throw denied;
  }
  const deviceId = $<HTMLSelectElement>('device').value || undefined;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      // Call-oriented processing hurts music recognition.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('../static/capture-worklet.js');
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'capture', { processorOptions: { chunk: 1600 } });
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    showLevel(e.data);
    send({ type: 'audio', samples: e.data });
  };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(node).connect(mute).connect(ctx.destination);
  await listDevices(); // labels become available after permission
  const self = {
    mic: true,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
  capture = self;
  // An unplugged input ends its track: carry on with what the input list now selects.
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    if (capture === self) void listDevices().then(restartMic);
  });
}

/** Moves capture to the selected input. The engine keeps its place in the shabad. */
async function restartMic(): Promise<void> {
  if (!capture?.mic) return;
  capture.stop();
  capture = null;
  try {
    await startMic();
    $('error').hidden = true;
  } catch (err) {
    stopCapture();
    showError(...micHelp(err as Error));
  }
}

/** Play an audio file and stream it to the engine at real-time pace. */
async function startFile(file: File): Promise<void> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const s = off.createBufferSource();
  s.buffer = decoded;
  s.connect(off.destination);
  s.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const play = ctx.createBufferSource();
  play.buffer = decoded;
  play.connect(ctx.destination);
  const t0 = ctx.currentTime;
  play.start();
  let sent = 0;
  const timer = window.setInterval(() => {
    const pos = Math.min(pcm.length, Math.floor((ctx.currentTime - t0) * 16000));
    if (pos > sent) {
      const chunk = pcm.slice(sent, pos);
      showLevel(chunk);
      send({ type: 'audio', samples: chunk });
      sent = pos;
    }
    if (pos >= pcm.length) stop();
  }, 100);
  const stop = () => {
    window.clearInterval(timer);
    try { play.stop(); } catch { /* already stopped */ }
    void ctx.close();
    capture = null;
    listening(false);
  };
  capture = { stop, mic: false };
}

/** Plain-language help for the common microphone failures. */
function micHelp(err: Error): Words {
  const mac = navigator.userAgent.includes('Mac');
  if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
    return mac
      ? ['Kirtan Saathi is not allowed to use the microphone. Open System Settings → Privacy & Security → Microphone, turn on Kirtan Saathi, then restart the app.']
      : ['Kirtan Saathi is not allowed to use the microphone. Open Settings → Privacy & security → Microphone, turn on "Microphone access" and "Let desktop apps access your microphone", then try again.'];
  }
  if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
    return ["No microphone was found. Plug in a microphone or the mixer's USB / line input, choose it in the input list, then press Start listening."];
  }
  if (err.name === 'NotReadableError') {
    return ['The microphone is busy or was unplugged. Close other apps using it (Zoom, Skype, OBS audio capture) and try again.'];
  }
  return ['Microphone unavailable: {0}', err.message];
}

function stopCapture(): void {
  capture?.stop();
  capture = null;
  listening(false);
  $('level').style.width = '0';
}

window.addEventListener('message', (e) => {
  const smokeMode = (e.data as { smokeMode?: string } | null)?.smokeMode;
  if (smokeMode) {
    if (smokeMode.startsWith('bani:')) $<HTMLSelectElement>('bani').value = smokeMode.slice(5);
    chooseMode(smokeMode.startsWith('bani:') ? 'bani' : (smokeMode as 'kirtan' | 'paath'));
    return;
  }
  const smoke = (e.data as { smokeAudio?: Float32Array } | null)?.smokeAudio;
  if (smoke) {
    if (!$('mic').classList.contains('live')) listening(true);
    showLevel(smoke);
    send({ type: 'audio', samples: smoke });
    return;
  }
  if (e.data === 'engine-port' && e.ports[0]) {
    port = e.ports[0];
    port.onmessage = (m: MessageEvent<FromEngine>) => onEngine(m.data);
    port.start();
  }
});

$('mic').addEventListener('click', async () => {
  if (capture) return stopCapture();
  try {
    await startMic();
    listening(true);
    $('error').hidden = true;
  } catch (err) {
    showError(...micHelp(err as Error));
  }
});

// Choosing another input while listening switches to it; plugged-in inputs appear in the list.
$('device').addEventListener('change', () => void restartMic());
navigator.mediaDevices.addEventListener('devicechange', () => void listDevices());

$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  stopCapture();
  send({ type: 'reset' });
  try {
    await startFile(f);
    listening(true);
  } catch (err) {
    showError('Could not play file: {0}', (err as Error).message);
  }
});

$('reset').addEventListener('click', () => send({ type: 'reset' }));

/** Mode buttons: Kirtan, Paath, Bani (with the bani picker beside it). */
function chooseMode(m: 'kirtan' | 'paath' | 'bani'): void {
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.modes [data-mode]'))) {
    b.setAttribute('aria-checked', String(b.dataset.mode === m));
  }
  const bani = $<HTMLSelectElement>('bani');
  bani.hidden = m !== 'bani';
  mode = m;
  send({ type: 'mode', mode: m === 'bani' ? { kind: 'bani', id: bani.value } : { kind: m } });
  if (capture) setStatus('listening', 'Listening for the shabad…');
}
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.modes [data-mode]'))) {
  b.addEventListener('click', () => chooseMode(b.dataset.mode as 'kirtan' | 'paath' | 'bani'));
}
$('bani').addEventListener('change', () => chooseMode('bani'));

/** Side panel tabs. */
for (const t of Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]'))) {
  t.addEventListener('click', () => {
    for (const o of Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]'))) {
      o.setAttribute('aria-selected', String(o === t));
    }
    for (const p of Array.from(document.querySelectorAll<HTMLElement>('.panel'))) p.hidden = p.dataset.panel !== t.dataset.tab;
  });
}

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>('search').value.trim();
  if (q) send({ type: 'search', query: q });
});

// ---------- Presentation: projector, overlay, phones ----------

const P = window.presentation;

/** After a language change: every word on screen again, in the new language. */
function refreshWords(): void {
  applyWords();
  $('mic').textContent = t($('mic').classList.contains('live') ? 'Stop listening' : 'Start listening');
  $('status-text').textContent = t(...statusWords);
  $('error').textContent = t(...errorWords);
  renderBanis();
  renderStats();
  renderShabad();
  for (const [el, [items, empty]] of lists) renderCandidates(el, items, empty);
  if (status) renderStatus(status);
  if (lastUpdates) renderUpdates(lastUpdates);
  if (view) $('blank-label').textContent = t(view.blank ? 'Show again' : 'Blank');
  void listDevices();
}

function renderView(v: DisplayView): void {
  view = v;
  const blank = $('blank');
  blank.classList.toggle('on', v.blank);
  $('blank-label').textContent = t(v.blank ? 'Show again' : 'Blank');
  $('blank-badge').hidden = !v.blank;
  const st = v.settings;
  $<HTMLInputElement>('font-scale').value = String(st.fontScale);
  radio('theme', st.theme);
  radio('language', st.language);
  if (st.language !== lang) {
    lang = st.language;
    refreshWords();
  }
  radio('hindi', st.hindi);
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="meaning"]'))) {
    el.checked = st.meaning.includes(el.value as MeaningLang);
  }
  $<HTMLInputElement>('opt-vishraam').checked = st.vishraam;
  $<HTMLInputElement>('opt-larivaar').checked = st.larivaar;
  $<HTMLInputElement>('opt-next').checked = st.nextLine;
  $<HTMLInputElement>('opt-source').checked = st.showSource;
  $<HTMLInputElement>('opt-waheguru').checked = st.waheguru;
}

function renderStatus(s: PresentStatus): void {
  const first = !status || status.server.port !== s.server.port;
  status = s;
  const preview = $<HTMLIFrameElement>('preview');
  if (first) preview.src = s.server.urls.projector;
  const sel = $<HTMLSelectElement>('proj-display');
  sel.textContent = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = t('Second screen (automatic)');
  sel.append(auto);
  for (const d of s.projector.displays) {
    const o = document.createElement('option');
    o.value = String(d.id);
    o.textContent = `${d.label}, ${d.width} × ${d.height}${d.primary ? t(' (this screen)') : ''}`;
    sel.append(o);
  }
  sel.value = s.projector.displayId === null ? '' : String(s.projector.displayId);
  const p = s.projector;
  $('proj-toggle').textContent = t(p.enabled ? 'Hide' : 'Show');
  $('proj-toggle').classList.toggle('primary', !p.enabled);
  $('proj-toggle').title = t(p.enabled ? 'Close the projector window' : 'Open the projector window on the chosen screen');
  const target = p.displays.find((d) => d.id === p.targetId);
  $('proj-status').textContent = p.enabled
    ? p.showing && target
      ? t(target.primary ? 'Showing on {0}. Press Esc on the projector to close it.' : 'Showing on {0}.', target.label)
      : t('Waiting for the chosen screen to be connected.')
    : p.displays.length > 1
      ? t('Off. Press Show to put Gurbani on the projector.')
      : t('Only one screen is connected. Connect the projector, or show it here (Esc closes it).');
  $('url-overlay').textContent = s.server.urls.overlay;
  $<HTMLInputElement>('opt-lan').checked = s.server.lan;
  const lan = $('lan-urls');
  lan.textContent = '';
  if (s.server.lan) {
    if (!s.server.urls.lanFollow.length) {
      lan.textContent = t('No Wi-Fi or network connection found on this computer.');
    }
    for (const url of s.server.urls.lanFollow) {
      const row = document.createElement('div');
      row.className = 'url-row';
      const code = document.createElement('code');
      code.textContent = url;
      const b = document.createElement('button');
      b.textContent = t('Copy');
      b.addEventListener('click', () => void P.copy(url));
      row.append(code, b);
      lan.append(row);
    }
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = t('Open this address in the phone browser. The phone must be on the same Wi-Fi as this computer.');
    lan.append(note);
  }
}

function setting(patch: Partial<PresentationSettings>): void {
  void P.setSettings(patch);
}

function radio(name: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

function onRadio(name: string, fn: (value: string) => void): void {
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`))) {
    el.addEventListener('change', () => el.checked && fn(el.value));
  }
}

$('proj-toggle').addEventListener('click', () => {
  const v = $<HTMLSelectElement>('proj-display').value;
  void P.setProjector({ enabled: !status?.projector.enabled, displayId: v === '' ? null : Number(v) });
});
$('proj-display').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  void P.setProjector({ enabled: !!status?.projector.enabled, displayId: v === '' ? null : Number(v) });
});
$('font-scale').addEventListener('input', (e) => setting({ fontScale: Number((e.target as HTMLInputElement).value) }));
onRadio('theme', (v) => setting({ theme: v as PresentationSettings['theme'] }));
onRadio('language', (v) => setting({ language: v as UiLanguage }));
onRadio('hindi', (v) => setting({ hindi: v as PresentationSettings['hindi'] }));
for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="meaning"]'))) {
  el.addEventListener('change', () => {
    const on = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="meaning"]:checked'));
    setting({ meaning: on.map((x) => x.value as MeaningLang) });
  });
}
$('opt-vishraam').addEventListener('change', (e) => setting({ vishraam: (e.target as HTMLInputElement).checked }));
$('opt-larivaar').addEventListener('change', (e) => setting({ larivaar: (e.target as HTMLInputElement).checked }));
$('opt-next').addEventListener('change', (e) => setting({ nextLine: (e.target as HTMLInputElement).checked }));
$('opt-source').addEventListener('change', (e) => setting({ showSource: (e.target as HTMLInputElement).checked }));
$('opt-waheguru').addEventListener('change', (e) => setting({ waheguru: (e.target as HTMLInputElement).checked }));
$('opt-lan').addEventListener('change', (e) => void P.setLan((e.target as HTMLInputElement).checked));
$('blank').addEventListener('click', () => void P.control(view?.blank ? 'unblank' : 'blank'));
$('prev').addEventListener('click', () => void P.control('prev'));
$('next').addEventListener('click', () => void P.control('next'));
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-copy]'))) {
  b.addEventListener('click', () => void P.copy($(b.dataset.copy!).textContent ?? ''));
}

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input:not([type=checkbox]):not([type=range]), select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowRight') void P.control('next');
  else if (e.key === 'ArrowLeft') void P.control('prev');
  else if (e.key === 'b' || e.key === 'B') void P.control(view?.blank ? 'unblank' : 'blank');
  else return;
  e.preventDefault();
});

// ---------- Updates ----------

const U = window.updates;
/** A version the operator dismissed with Later (shown again after Check now). */
let laterFor: string | null = null;
let lastUpdates: UpdateStatus | null = null;

function renderUpdates(s: UpdateStatus): void {
  const v = s.release?.version ?? '';
  lastUpdates = s;
  $('app-version').textContent = t('Kirtan Saathi {0}', lang === 'pa' ? gurmukhiDigits(s.current) : s.current);
  $<HTMLInputElement>('opt-update-check').checked = s.prefs.check;
  const auto = $<HTMLInputElement>('opt-update-auto');
  auto.checked = s.prefs.auto && s.canInstall;
  auto.disabled = !s.canInstall;
  // Store copies: the Microsoft Store updates them, so there is nothing to set here.
  $('update-switches').hidden = s.store;
  $('update-check-row').hidden = s.store;
  $('update-auto-hint').textContent = s.store
    ? t('The Microsoft Store keeps Kirtan Saathi up to date.')
    : s.canInstall
      ? t('Updates download in the background and install when you close Kirtan Saathi, never during kirtan.')
      : t('This copy of Kirtan Saathi cannot install updates itself. When there is a new version, Download opens the release page.');
  const pct = Math.round(s.progress * 100);
  $('update-state').textContent = {
    idle: '',
    checking: t('Checking for updates…'),
    latest: t('You have the latest version.'),
    offline: t('Not connected to the internet. Kirtan Saathi checks again when it is.'),
    available: t('Version {0} is available.', v),
    downloading: t('Downloading version {0}: {1}%', v, pct),
    ready: t('Version {0} is downloaded. It installs when you close Kirtan Saathi.', v),
    error: t('Could not check for updates: {0}', s.message),
  }[s.state];

  const show = !!s.release && ['available', 'downloading', 'ready'].includes(s.state) && laterFor !== v;
  $('update').hidden = !show;
  if (!show) return;
  $('update-title').textContent = t(s.state === 'ready' ? 'Kirtan Saathi {0} is ready to install' : 'Kirtan Saathi {0} is available', v);
  const list = $('update-notes');
  list.textContent = '';
  for (const n of s.release!.notes) {
    const li = document.createElement('li');
    li.textContent = n;
    list.append(li);
  }
  const msg = $('update-msg');
  msg.hidden = !s.message;
  msg.textContent = s.message;
  const install = $<HTMLButtonElement>('update-install');
  install.hidden = !s.canInstall;
  install.disabled = s.state === 'downloading';
  install.textContent = s.state === 'ready' ? t('Restart and update') : s.state === 'downloading' ? t('Downloading {0}%', pct) : t('Update now');
  $('update-download').hidden = s.canInstall && !s.message;
}

$('update-install').addEventListener('click', () => {
  void (U.status().then((s) => (s.state === 'ready' ? U.install() : U.download())));
});
$('update-download').addEventListener('click', () => void U.open());
$('update-later').addEventListener('click', () => {
  void U.status().then((s) => {
    laterFor = s.release?.version ?? null;
    renderUpdates(s);
  });
});
$('update-check').addEventListener('click', () => {
  laterFor = null;
  void U.check(true);
});
$('opt-update-check').addEventListener('change', (e) => void U.setPrefs({ check: (e.target as HTMLInputElement).checked }));
$('opt-update-auto').addEventListener('change', (e) => void U.setPrefs({ auto: (e.target as HTMLInputElement).checked }));
// Back online after being offline: look again.
window.addEventListener('online', () => void U.check(false));
U.onStatus(renderUpdates);
void U.status().then(renderUpdates);

P.onView(renderView);
P.onStatus(renderStatus);
void P.init().then(({ view: v, status: s }) => {
  renderView(v);
  renderStatus(s);
});

void listDevices();
