/**
 * On-device acoustic model: IndicConformer CTC (karansea fine-tune, MIT),
 * int8 ONNX, CPU execution provider via onnxruntime-node.
 *
 * I/O: audio float32 [1, T] @ 16 kHz, audio_len int64 [1]
 *   -> log_probs float32 [1, T', 257], out_len int64 [1]
 * Vocabulary: 256 SentencePiece pieces + CTC blank at index 256.
 *
 * Raw transcripts are never shown to users; only the matcher consumes them.
 */
import { readFileSync } from 'node:fs';
import type * as OrtTypes from 'onnxruntime-node';
import { toKeyTimed } from './gurmukhi';

export const SAMPLE_RATE = 16000;

export interface AsrResult {
  /** Decoded pieces after CTC collapse (SentencePiece '▁' kept). */
  pieces: string[];
  /** Start time of each piece, seconds from window start. */
  pieceTimes: Float32Array;
  /** Human-readable transcript (debug only). */
  text: string;
  /** Matching key and per-unit time (seconds from window start). */
  key: string;
  keyTimes: Float32Array;
  /** Seconds per output frame. */
  frameSec: number;
  frames: number;
  windowSec: number;
  inferMs: number;
}

export interface AsrOptions {
  intraOpThreads?: number;
}

function defaultThreads(): number {
  // Matches what works on low-end machines: 2 threads below 8 logical cores.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cores = require('node:os').availableParallelism?.() ?? require('node:os').cpus().length;
  return cores < 8 ? 2 : 4;
}

export class AsrModel {
  private constructor(
    private readonly ort: typeof OrtTypes,
    private readonly session: OrtTypes.InferenceSession,
    private readonly vocab: string[],
    readonly threads: number,
  ) {}

  static async load(modelPath: string, vocabPath: string, opts: AsrOptions = {}): Promise<AsrModel> {
    // Loaded lazily so the matcher can be used (and tested) without the runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ort = require('onnxruntime-node') as typeof OrtTypes;
    const threads = opts.intraOpThreads ?? defaultThreads();
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      intraOpNumThreads: threads,
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
      // Spinning wastes CPU that the rest of the app needs on weak machines.
      extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
    });
    const vocab = JSON.parse(readFileSync(vocabPath, 'utf8')) as string[];
    if (vocab.length !== 256) throw new Error(`expected 256 vocab entries, got ${vocab.length}`);
    return new AsrModel(ort, session, vocab, threads);
  }

  async transcribe(samples: Float32Array): Promise<AsrResult> {
    const ort = this.ort;
    const t0 = performance.now();
    const out = await this.session.run({
      audio: new ort.Tensor('float32', samples, [1, samples.length]),
      audio_len: new ort.Tensor('int64', BigInt64Array.from([BigInt(samples.length)]), [1]),
    });
    const inferMs = performance.now() - t0;
    const lp = out.log_probs;
    const data = lp.data as Float32Array;
    const V = lp.dims[2];
    const frames = Number((out.out_len.data as BigInt64Array)[0]);
    const windowSec = samples.length / SAMPLE_RATE;
    const frameSec = frames > 0 ? windowSec / frames : 0.04;
    const blank = V - 1;

    const pieces: string[] = [];
    const times: number[] = [];
    let prev = -1;
    for (let t = 0; t < frames; t++) {
      let best = 0, bestV = -Infinity;
      const base = t * V;
      for (let v = 0; v < V; v++) {
        const x = data[base + v];
        if (x > bestV) { bestV = x; best = v; }
      }
      if (best !== prev && best !== blank) {
        pieces.push(this.vocab[best] ?? '');
        times.push(t * frameSec);
      }
      prev = best;
    }
    const pieceTimes = Float32Array.from(times);
    const { key, src } = toKeyTimed(pieces);
    const keyTimes = new Float32Array(key.length);
    for (let i = 0; i < key.length; i++) keyTimes[i] = pieceTimes[src[i]];
    const text = pieces.join('').replace(/▁/g, ' ').trim();
    return { pieces, pieceTimes, text, key, keyTimes, frameSec, frames, windowSec, inferMs };
  }
}
