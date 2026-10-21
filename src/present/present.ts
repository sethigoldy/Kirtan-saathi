/**
 * Presentation page, served by the local presentation server in three
 * layouts chosen by path:
 *
 *   /projector  fullscreen sangat display (loaded by the projector window)
 *   /overlay    transparent lower third for OBS (Browser Source)
 *   /follow     phone / tablet follow-along: whole shabad, live line highlighted
 *
 * Overlay query parameters: size (multiplier), position (bottom|top|center),
 * box (1|0), next (1|0), source (1|0), color (hex without #),
 * hindi (off|below|only), meaning (off|pa|hi|both).
 */
import type { DisplayLine, DisplayView } from '../main/display-types';
import { toDevanagari, tokens } from './format.js';

type Layout = 'projector' | 'overlay' | 'follow';
type Hindi = 'off' | 'below' | 'only';
const HINDI: Hindi[] = ['off', 'below', 'only'];
type Meaning = 'off' | 'pa' | 'hi' | 'both';
const MEANING: Meaning[] = ['off', 'pa', 'hi', 'both'];

const ROLE_RAHAO = 1;
const ROLE_HEADER = 2;
const ROLE_MANGAL = 3;

/** Shown while searching, instead of an empty screen. */
const WAHEGURU = 'ਵਾਹਿਗੁਰੂ';

const layout: Layout = (['projector', 'overlay', 'follow'] as const).find((l) => location.pathname === `/${l}`) ?? 'follow';
const query = new URLSearchParams(location.search);
const root = document.documentElement;
root.dataset.layout = layout;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function flag(name: string): boolean | null {
  const v = query.get(name);
  return v === null ? null : v === '1' || v === 'true';
}

if (layout === 'overlay') {
  const size = Number(query.get('size'));
  if (size > 0) root.style.setProperty('--overlay-size', String(Math.min(4, size)));
  const pos = query.get('position');
  if (pos === 'top' || pos === 'center' || pos === 'bottom') root.dataset.position = pos;
  if (flag('box') === false) root.dataset.box = 'off';
  const color = query.get('color');
  if (color && /^[0-9a-fA-F]{3,8}$/.test(color)) root.style.setProperty('--overlay-fg', `#${color}`);
}

let view: DisplayView | null = null;
let lastFollowShabad = '';
let userScrolledAt = 0;
/** Follow page: the reader's own Hindi choice (null = use the operator's). */
let localHindi: Hindi | null = null;
let localMeaning: Meaning | null = null;

function meaningMode(v: DisplayView): Meaning {
  const q = query.get('meaning') as Meaning | null;
  if (q && MEANING.includes(q)) return q;
  if (layout === 'follow' && localMeaning) return localMeaning;
  return v.settings.meaning;
}

function hindiMode(v: DisplayView): Hindi {
  const q = query.get('hindi') as Hindi | null;
  if (q && HINDI.includes(q)) return q;
  if (layout === 'follow' && localHindi) return localHindi;
  return v.settings.hindi;
}

function appendTokens(el: HTMLElement, text: string, hindi: boolean): void {
  const s = view!.settings;
  for (const t of tokens(text, { larivaar: s.larivaar, vishraam: s.vishraam, hindi })) {
    if (t.gap) el.append(t.gap);
    const span = document.createElement('span');
    span.textContent = t.text;
    if (t.pause) span.className = `v-${t.pause}`;
    if (t.mark) span.classList.add('mark');
    el.append(span);
  }
}

/**
 * Render a line into `el`: Gurmukhi and / or Hindi (Devanagari), with
 * vishraam colouring and larivaar per settings.
 */
function renderLine(el: HTMLElement, line: DisplayLine | null, hindi: Hindi, meaning: Meaning = 'off'): void {
  el.textContent = '';
  if (!line || !view) return;
  renderTuk(el, line, hindi);
  // Meaning (arth) just under the tuk, smaller.
  const pa = line.pa ?? '';
  if (meaning === 'off' || !pa) return;
  const arth = document.createElement('div');
  arth.className = 'arth';
  if (meaning === 'pa' || meaning === 'both') {
    const d = document.createElement('div');
    d.className = 'arth-pa';
    d.lang = 'pa';
    d.textContent = pa;
    arth.append(d);
  }
  if (meaning === 'hi' || meaning === 'both') {
    const d = document.createElement('div');
    d.className = 'arth-hi';
    d.lang = 'hi';
    // A bundled Hindi translation when there is one, else the Punjabi arth in Hindi script.
    d.textContent = line.hi || toDevanagari(pa);
    arth.append(d);
  }
  el.append(arth);
}

function renderTuk(el: HTMLElement, line: DisplayLine, hindi: Hindi): void {
  if (hindi !== 'only') {
    const gu = document.createElement('div');
    gu.className = 'gu';
    gu.lang = 'pa';
    appendTokens(gu, line.text, false);
    el.append(gu);
  }
  if (hindi !== 'off') {
    const hi = document.createElement('div');
    hi.className = hindi === 'only' ? 'hi solo' : 'hi';
    hi.lang = 'hi';
    appendTokens(hi, line.text, true);
    el.append(hi);
  }
}

/** Shrink the font until `el` fits `maxHeight` (long Dasam Granth lines). */
function fit(el: HTMLElement, maxHeight: number): void {
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize);
  let size = base;
  while (el.scrollHeight > maxHeight && size > base * 0.4) {
    size *= 0.92;
    el.style.fontSize = `${size}px`;
  }
}

function showNext(v: DisplayView): boolean {
  const override = flag('next');
  return (override ?? v.settings.nextLine) && v.next !== null;
}

function showSource(v: DisplayView): boolean {
  return (flag('source') ?? v.settings.showSource) && v.source !== '';
}

/** Projector and overlay: current line, optional next line, source. */
function renderStage(v: DisplayView): void {
  const stage = $('stage');
  const cur = $('current');
  const next = $('next');
  const src = $('source');
  const hindi = hindiMode(v);
  const changed = cur.dataset.line !== String(v.current?.line ?? '');
  cur.dataset.line = String(v.current?.line ?? '');
  const idle = !v.current && (flag('waheguru') ?? v.settings.waheguru);
  if (idle) {
    cur.textContent = '';
    const gu = document.createElement('div');
    gu.className = 'gu';
    gu.lang = 'pa';
    gu.textContent = WAHEGURU;
    cur.append(gu);
  } else {
    renderLine(cur, v.current, hindi, meaningMode(v));
  }
  cur.classList.toggle('waheguru', idle);
  cur.classList.toggle('rahao', v.current?.role === ROLE_RAHAO);
  renderLine(next, showNext(v) ? v.next : null, hindi);
  src.textContent = showSource(v) && !idle ? [v.source, meaningMode(v) !== 'off' ? v.credit : ''].filter(Boolean).join(' · ') : '';
  stage.classList.toggle('empty', !v.current && !idle);
  if (layout === 'projector') {
    fit(cur, window.innerHeight * (next.textContent ? 0.55 : 0.75));
    fit(next, window.innerHeight * 0.22);
  } else {
    fit(cur, window.innerHeight * 0.6);
  }
  if (changed && v.current) {
    cur.classList.remove('enter');
    void cur.offsetWidth; // restart the fade
    cur.classList.add('enter');
  }
}

/** Follow page: whole shabad, current line highlighted and kept in view. */
function renderFollow(v: DisplayView): void {
  const list = $('lines');
  const hindi = hindiMode(v);
  const meaning = meaningMode(v);
  const key = `${v.lines[0]?.line ?? ''}|${v.settings.larivaar}|${v.settings.vishraam}|${hindi}|${meaning}|${v.lines[0]?.pa !== undefined}`;
  if (key !== lastFollowShabad) {
    lastFollowShabad = key;
    list.textContent = '';
    for (const l of v.lines) {
      const li = document.createElement('li');
      li.dataset.line = String(l.line);
      if (l.role === ROLE_HEADER || l.role === ROLE_MANGAL) li.classList.add('header');
      if (l.role === ROLE_RAHAO) li.classList.add('rahao');
      renderLine(li, l, hindi, meaning);
      list.append(li);
    }
    window.scrollTo({ top: 0 });
  }
  $('follow-source').textContent = [v.source, meaning !== 'off' ? v.credit : ''].filter(Boolean).join(' · ') || 'Waiting for the shabad…';
  let current: HTMLElement | null = null;
  for (const li of Array.from(list.children) as HTMLElement[]) {
    const on = v.current !== null && li.dataset.line === String(v.current.line);
    li.classList.toggle('current', on);
    if (on) current = li;
  }
  const following = Date.now() - userScrolledAt > 8000;
  $('live').hidden = following || !current;
  if (current && following) current.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function render(v: DisplayView): void {
  view = v;
  root.dataset.theme = v.settings.theme;
  root.dataset.mode = v.mode;
  root.classList.toggle('blank', v.blank);
  root.style.setProperty('--scale', String(v.settings.fontScale));
  if (layout === 'follow') renderFollow(v);
  else renderStage(v);
  window.dispatchEvent(new Event('ks-view'));
}

function connect(): void {
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    root.classList.remove('offline');
    try {
      render(JSON.parse(e.data) as DisplayView);
    } catch {
      /* ignore a malformed frame; the next one replaces it */
    }
  };
  // EventSource reconnects by itself (server sends retry: 2000).
  es.onerror = () => root.classList.add('offline');
}

if (layout === 'follow') {
  const key = 'ks-follow-scale';
  let scale = 1;
  try {
    scale = Number(localStorage.getItem(key)) || 1;
  } catch {
    /* storage unavailable: keep the default */
  }
  const apply = () => {
    root.style.setProperty('--follow-scale', String(scale));
    try {
      localStorage.setItem(key, String(scale));
    } catch {
      /* not persisted */
    }
  };
  apply();
  $('smaller').addEventListener('click', () => {
    scale = Math.max(0.6, +(scale - 0.1).toFixed(2));
    apply();
  });
  $('larger').addEventListener('click', () => {
    scale = Math.min(2.5, +(scale + 0.1).toFixed(2));
    apply();
  });
  // Hindi: each reader can choose Gurmukhi, both, or Hindi only on their phone.
  const hindiKey = 'ks-follow-hindi';
  try {
    const saved = localStorage.getItem(hindiKey) as Hindi | null;
    if (saved && HINDI.includes(saved)) localHindi = saved;
  } catch {
    /* storage unavailable */
  }
  const label = () => {
    const mode = view ? hindiMode(view) : localHindi ?? 'off';
    $('script').textContent = mode === 'off' ? 'ਗੁਰਮੁਖੀ' : mode === 'below' ? 'ਗੁ + हि' : 'हिंदी';
  };
  $('script').addEventListener('click', () => {
    const cur = view ? hindiMode(view) : 'off';
    localHindi = HINDI[(HINDI.indexOf(cur) + 1) % HINDI.length];
    try {
      localStorage.setItem(hindiKey, localHindi);
    } catch {
      /* not persisted */
    }
    if (view) renderFollow(view);
    label();
  });
  // Meaning: each reader can choose off / Punjabi / Hindi / both.
  const meaningKey = 'ks-follow-meaning';
  try {
    const saved = localStorage.getItem(meaningKey) as Meaning | null;
    if (saved && MEANING.includes(saved)) localMeaning = saved;
  } catch {
    /* storage unavailable */
  }
  const meaningLabel = () => {
    const mode = view ? meaningMode(view) : localMeaning ?? 'off';
    $('arth').textContent = { off: 'ਅਰਥ ✕', pa: 'ਅਰਥ', hi: 'अर्थ', both: 'ਅਰਥ+अर्थ' }[mode];
  };
  $('arth').addEventListener('click', () => {
    const cur = view ? meaningMode(view) : 'off';
    localMeaning = MEANING[(MEANING.indexOf(cur) + 1) % MEANING.length];
    try {
      localStorage.setItem(meaningKey, localMeaning);
    } catch {
      /* not persisted */
    }
    if (view) renderFollow(view);
    meaningLabel();
  });
  window.addEventListener('ks-view', () => {
    label();
    meaningLabel();
  });
  $('live').addEventListener('click', () => {
    userScrolledAt = 0;
    if (view) renderFollow(view);
  });
  // A finger or wheel scroll pauses auto-follow for 8 s.
  for (const ev of ['wheel', 'touchmove']) {
    window.addEventListener(ev, () => {
      userScrolledAt = Date.now();
      $('live').hidden = false;
    }, { passive: true });
  }
}

window.addEventListener('resize', () => {
  if (view && layout !== 'follow') renderStage(view);
});

connect();
