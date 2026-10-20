/**
 * Operator / follow-along view (Phase 1).
 * Captures 16 kHz mono audio, streams it to the engine, renders canonical
 * Gurbani for the line the engine reports. Raw ASR text is debug-only.
 */
import type { FromEngine, ToEngine, UiCandidate, UiEvent, UiShabad } from '../main/protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ROLE_RAHAO = 1;
const ROLE_HEADER = 2;
const ROLE_MANGAL = 3;

let port: MessagePort | null = null;
let shabad: UiShabad | null = null;
let currentLine: number | null = null;
let capture: { stop: () => void } | null = null;
let mode: 'kirtan' | 'paath' | 'bani' = 'kirtan';
let streamName: string | null = null;

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
    if (word.endsWith(';')) span.className = 'v-major';
    else if (word.endsWith('.')) span.className = 'v-minor';
    span.textContent = word.replace(/[;.,]$/, '');
    el.append(span, ' ');
  }
}

function setStatus(state: string, label: string): void {
  const el = $('status');
  el.className = `pill pill-${state}`;
  el.textContent = label;
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
    if (on) li.scrollIntoView({ block: 'nearest' });
  }
  const now = $('now');
  const idx = shabad ? shabad.lines.findIndex((l) => l.line === currentLine) : -1;
  const line = idx >= 0 ? shabad!.lines[idx] : undefined;
  if (line) {
    now.classList.remove('empty');
    renderTuk($('now-line'), line.text);
    // Paath moves quickly: preview the next line.
    const next = mode !== 'kirtan' ? shabad!.lines[idx + 1] : undefined;
    if (next) renderTuk($('next-line'), next.text);
    else $('next-line').textContent = '';
    const s = shabad!;
    $('now-meta').textContent = [streamName && streamName !== s.source ? streamName : '', s.source, s.section, s.author, s.page > 0 ? `page ${s.page}` : '']
      .filter(Boolean)
      .join(' · ');
  } else {
    now.classList.add('empty');
    $('now-line').textContent = 'ਉਡੀਕ…';
    $('next-line').textContent = '';
    $('now-meta').textContent = shabad ? 'Locked — waiting for a confident line' : 'Listening for Gurbani';
  }
}

function renderCandidates(el: HTMLOListElement, items: UiCandidate[], emptyText: string): void {
  el.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = emptyText;
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
    info.textContent = `${c.source}${c.page > 0 ? ` · page ${c.page}` : ''} · ${(c.score * 100).toFixed(0)}%`;
    const btn = document.createElement('button');
    btn.textContent = 'Lock';
    btn.addEventListener('click', () => send({ type: 'lock', shabad: c.shabad, line: c.line }));
    row.append(info, btn);
    li.append(text, row);
    el.append(li);
  }
}

function renderStats(ev: UiEvent | null, ready?: Extract<FromEngine, { type: 'ready' }>): void {
  const dl = $('stats');
  const rows: [string, string][] = [];
  if (ready) {
    rows.push(['Corpus', `${ready.lines.toLocaleString()} lines · ${ready.shabads.toLocaleString()} shabads`]);
    rows.push(['Text source', ready.provenance]);
    rows.push(['Threads', String(ready.threads)]);
    rows.push(['Self-test RTF', ready.selfTestRtf.toFixed(3)]);
    rows.push(['Load time', `${(ready.loadMs / 1000).toFixed(1)} s`]);
    dl.dataset.ready = JSON.stringify(rows);
  }
  const base = dl.dataset.ready ? (JSON.parse(dl.dataset.ready) as [string, string][]) : [];
  if (ev) {
    base.push(['Decode', `${ev.inferMs.toFixed(0)} ms for ${ev.windowSec.toFixed(1)} s`]);
    base.push(['Pace', `${ev.paceScale.toFixed(2)}×`]);
    base.push(['Last action', ev.reason]);
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

function onEngine(msg: FromEngine): void {
  switch (msg.type) {
    case 'ready': {
      setStatus('idle', 'Ready');
      $<HTMLButtonElement>('mic').disabled = false;
      const group = $('banis');
      group.textContent = '';
      for (const b of msg.banis) {
        const o = document.createElement('option');
        o.value = `bani:${b.id}`;
        o.textContent = `${b.nameEn} — ${b.name}`;
        group.append(o);
      }
      renderStats(null, msg);
      break;
    }
    case 'error': {
      const el = $('error');
      el.hidden = false;
      el.textContent = msg.message;
      setStatus('error', 'Error');
      break;
    }
    case 'shabad':
      shabad = msg.shabad;
      currentLine = null;
      renderShabad();
      break;
    case 'event': {
      const ev = msg.ev;
      if (ev.state === 'locked') setStatus('locked', `Locked · ${(ev.confidence * 100).toFixed(0)}%`);
      else if (ev.state === 'searching') setStatus('searching', 'Searching…');
      mode = ev.mode;
      streamName = ev.stream;
      currentLine = ev.line;
      highlight();
      renderCandidates($<HTMLOListElement>('candidates'), ev.candidates, 'No candidates yet');
      $('asr').textContent = ev.asrText;
      renderStats(ev);
      break;
    }
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
  sel.textContent = '';
  for (const d of devices) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Input ${sel.length + 1}`;
    sel.append(o);
  }
}

async function startMic(): Promise<void> {
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
  capture = {
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
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
    $('mic').textContent = 'Start listening';
  };
  capture = { stop };
}

function stopCapture(): void {
  capture?.stop();
  capture = null;
  $('mic').textContent = 'Start listening';
  $('level').style.width = '0';
}

window.addEventListener('message', (e) => {
  const smokeMode = (e.data as { smokeMode?: string } | null)?.smokeMode;
  if (smokeMode) {
    const sel = $<HTMLSelectElement>('mode');
    sel.value = smokeMode;
    sel.dispatchEvent(new Event('change'));
    return;
  }
  const smoke = (e.data as { smokeAudio?: Float32Array } | null)?.smokeAudio;
  if (smoke) {
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
    $('mic').textContent = 'Stop';
  } catch (err) {
    onEngine({ type: 'error', message: `Microphone unavailable: ${(err as Error).message}` });
  }
});

$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  stopCapture();
  send({ type: 'reset' });
  try {
    await startFile(f);
    $('mic').textContent = 'Stop';
  } catch (err) {
    onEngine({ type: 'error', message: `Could not play file: ${(err as Error).message}` });
  }
});

$('reset').addEventListener('click', () => send({ type: 'reset' }));

$<HTMLSelectElement>('mode').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  send({ type: 'mode', mode: v.startsWith('bani:') ? { kind: 'bani', id: v.slice(5) } : { kind: v as 'kirtan' | 'paath' } });
});

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>('search').value.trim();
  if (q) send({ type: 'search', query: q });
});

void listDevices();
