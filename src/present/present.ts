/**
 * Presentation page, served by the local presentation server in three
 * layouts chosen by path:
 *
 *   /projector  fullscreen sangat display (loaded by the projector window)
 *   /overlay    transparent lower third for OBS (Browser Source)
 *   /follow     phone / tablet follow-along: whole shabad, live line highlighted
 *
 * Overlay query parameters: size (multiplier), position (bottom|top|center),
 * box (1|0), next (1|0), source (1|0), color (hex without #).
 */
import type { DisplayLine, DisplayView } from '../main/display-types';
import { tokens } from './format.js';

type Layout = 'projector' | 'overlay' | 'follow';

const ROLE_RAHAO = 1;
const ROLE_HEADER = 2;
const ROLE_MANGAL = 3;

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

/** Render a line into `el`: vishraam colouring and larivaar per settings. */
function renderLine(el: HTMLElement, line: DisplayLine | null): void {
  el.textContent = '';
  if (!line || !view) return;
  const s = view.settings;
  for (const t of tokens(line.text, { larivaar: s.larivaar, vishraam: s.vishraam })) {
    if (t.gap) el.append(t.gap);
    const span = document.createElement('span');
    span.textContent = t.text;
    if (t.pause) span.className = `v-${t.pause}`;
    if (t.mark) span.classList.add('mark');
    el.append(span);
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
  const changed = cur.dataset.line !== String(v.current?.line ?? '');
  cur.dataset.line = String(v.current?.line ?? '');
  renderLine(cur, v.current);
  cur.classList.toggle('rahao', v.current?.role === ROLE_RAHAO);
  renderLine(next, showNext(v) ? v.next : null);
  src.textContent = showSource(v) ? v.source : '';
  stage.classList.toggle('empty', !v.current);
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
  const key = `${v.lines[0]?.line ?? ''}|${v.settings.larivaar}|${v.settings.vishraam}`;
  if (key !== lastFollowShabad) {
    lastFollowShabad = key;
    list.textContent = '';
    for (const l of v.lines) {
      const li = document.createElement('li');
      li.dataset.line = String(l.line);
      if (l.role === ROLE_HEADER || l.role === ROLE_MANGAL) li.classList.add('header');
      if (l.role === ROLE_RAHAO) li.classList.add('rahao');
      renderLine(li, l);
      list.append(li);
    }
    window.scrollTo({ top: 0 });
  }
  $('follow-source').textContent = v.source || 'Waiting for the shabad…';
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
