/**
 * Engine host. Runs in an Electron utilityProcess so model inference never
 * blocks the UI. Receives 16 kHz mono audio from the renderer over a
 * MessagePort and sends back engine events and shabad text.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AsrModel, SAMPLE_RATE } from '../engine/asr';
import { Corpus } from '../engine/corpus';
import { Engine, type EngineEvent, type Transcriber } from '../engine/engine';
import { Retriever } from '../engine/retrieval';
import type { FromEngine, ToEngine, UiCandidate, UiShabad } from './protocol';

interface ParentPortLike {
  on(event: 'message', fn: (e: { data: unknown; ports: MessagePortLike[] }) => void): void;
  postMessage(msg: unknown): void;
}
interface MessagePortLike {
  on(event: 'message', fn: (e: { data: unknown }) => void): void;
  postMessage(msg: unknown): void;
  start(): void;
  close(): void;
}

const parent = (process as unknown as { parentPort: ParentPortLike }).parentPort;

let port: MessagePortLike | null = null;
let engine: Engine | null = null;
let corpus: Corpus | null = null;
let retriever: Retriever | null = null;
let ready: FromEngine | null = null;
let lastShabad: number | null | undefined;
let pumping = false;

function send(msg: FromEngine): void {
  port?.postMessage(msg);
}

function shabadPayload(index: number): UiShabad {
  const c = corpus!;
  const s = c.shabads[index];
  return {
    index,
    id: s.id,
    source: c.sources[s.source]?.nameEn ?? '',
    section: s.section,
    author: s.author,
    page: s.page,
    lines: c.linesOf(index).map((line) => ({ line, inShabad: c.lineInShabad[line], text: c.text[line], role: c.role[line] })),
  };
}

function candidate(shabad: number, line: number, score: number, evidence: number): UiCandidate {
  const c = corpus!;
  return {
    shabad,
    line,
    text: c.plain[line],
    source: c.sources[c.shabads[shabad].source]?.nameEn ?? '',
    page: c.page[line],
    score,
    evidence,
  };
}

/** Adjust hop lengths so decoding keeps up with real time on this machine. */
function pace(ev: EngineEvent): void {
  const e = engine!;
  const hop = ev.state === 'locked' ? e.opts.followHopSec : e.opts.searchHopSec;
  const budgetMs = hop * e.opts.paceScale * 1000;
  if (ev.inferMs > 0.8 * budgetMs) e.opts.paceScale = Math.min(4, e.opts.paceScale * 1.25);
  else if (ev.inferMs < 0.3 * budgetMs) e.opts.paceScale = Math.max(1, e.opts.paceScale / 1.1);
}

function emit(ev: EngineEvent): void {
  pace(ev);
  if (ev.shabad !== lastShabad) {
    lastShabad = ev.shabad;
    send({ type: 'shabad', shabad: ev.shabad === null ? null : shabadPayload(ev.shabad) });
  }
  send({
    type: 'event',
    ev: {
      t: ev.t,
      state: ev.state,
      shabad: ev.shabad,
      line: ev.line,
      confidence: ev.confidence,
      reason: ev.reason,
      candidates: ev.candidates.map((c) => candidate(c.shabad, c.line, c.score, c.evidence)),
      asrText: ev.asrText,
      inferMs: ev.inferMs,
      windowSec: ev.windowSec,
      paceScale: engine!.opts.paceScale,
    },
  });
}

async function pump(): Promise<void> {
  if (pumping || !engine) return;
  pumping = true;
  try {
    while (engine.due()) {
      const ev = await engine.step();
      if (ev) emit(ev);
    }
  } catch (err) {
    send({ type: 'error', message: String((err as Error).stack ?? err) });
  } finally {
    pumping = false;
  }
}

function handle(msg: ToEngine | null): void {
  if (!engine || !msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'audio':
      if (!(msg.samples instanceof Float32Array)) return;
      engine.pushAudio(msg.samples);
      void pump();
      break;
    case 'lock':
      engine.lock(msg.shabad, msg.line ?? null);
      lastShabad = undefined;
      break;
    case 'setLine':
      engine.setLine(msg.line);
      break;
    case 'reset':
      engine.reset();
      lastShabad = undefined;
      send({ type: 'shabad', shabad: null });
      break;
    case 'search': {
      // Manual search: the operator types romanized or Gurmukhi text.
      const res = retriever!.search(require('../engine/gurmukhi').toKey(msg.query));
      send({
        type: 'searchResults',
        query: msg.query,
        results: res.shabads.slice(0, 8).map((h) => candidate(h.shabad, h.line, h.score, 0)),
      });
      break;
    }
  }
}

function attach(p: MessagePortLike): void {
  port?.close();
  port = p;
  port.on('message', (e) => handle(e.data as ToEngine));
  port.start();
  if (ready) send(ready);
  lastShabad = undefined;
}

async function init(paths: { models: string; corpus: string }): Promise<void> {
  const t0 = Date.now();
  const modelPath = join(paths.models, 'model.int8.onnx');
  const vocabPath = join(paths.models, 'edge-vocab.json');
  for (const p of [modelPath, vocabPath, paths.corpus]) {
    if (!existsSync(p)) throw new Error(`missing ${p}. Run "npm run fetch-assets" first.`);
  }
  corpus = Corpus.load(paths.corpus);
  retriever = new Retriever(corpus);
  const model = await AsrModel.load(modelPath, vocabPath);
  const transcriber: Transcriber = { transcribe: (s) => model.transcribe(s) };

  // Self-test: time a 5 s decode to pick a starting pace for this machine.
  const probe = new Float32Array(5 * SAMPLE_RATE);
  for (let i = 0; i < probe.length; i++) probe[i] = (Math.random() - 0.5) * 0.01;
  await model.transcribe(probe); // warm-up
  const r = await model.transcribe(probe);
  const rtf = r.inferMs / 5000;
  engine = new Engine(corpus, retriever, transcriber);
  // Follow decodes 5 s every 0.5 s: keep each decode under ~60% of the hop.
  engine.opts.paceScale = Math.min(4, Math.max(1, r.inferMs / (0.6 * engine.opts.followHopSec * 1000)));

  ready = {
    type: 'ready',
    lines: corpus.lineCount,
    shabads: corpus.shabads.length,
    threads: model.threads,
    loadMs: Date.now() - t0,
    selfTestRtf: rtf,
    provenance: `${corpus.provenance.name} ${corpus.provenance.version}`,
  };
  send(ready);
}

parent.on('message', (e) => {
  const data = e.data as { type: string; paths?: { models: string; corpus: string } };
  if (data.type === 'init' && data.paths) {
    if (e.ports[0]) attach(e.ports[0]);
    init(data.paths).catch((err) => send({ type: 'error', message: String((err as Error).message ?? err) }));
  } else if (data.type === 'attach' && e.ports[0]) {
    attach(e.ports[0]);
  }
});
