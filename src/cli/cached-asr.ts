/**
 * Transcriber wrapper that caches decoded windows on disk, keyed by the
 * window's absolute position in the source file. Lets the matcher and
 * tracker be tuned without re-running the acoustic model.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AsrModel, AsrResult } from '../engine/asr';
import type { Transcriber } from '../engine/engine';
import { toKeyTimed } from '../engine/gurmukhi';

interface CachedEntry {
  p: string[];
  pt: number[];
  f: number;
  w: number;
  ms: number;
}

export class CachedTranscriber implements Transcriber {
  private cache: Record<string, CachedEntry> = {};
  private dirty = false;
  hits = 0;
  misses = 0;
  totalInferMs = 0;
  totalAudioSec = 0;

  constructor(
    private readonly model: AsrModel | null,
    private readonly cacheDir: string,
    private readonly fileId: string,
    /** Absolute sample offset of stream time 0 within the file. */
    private readonly fileOffset: number,
  ) {
    mkdirSync(cacheDir, { recursive: true });
    const p = this.path();
    if (existsSync(p)) this.cache = JSON.parse(readFileSync(p, 'utf8')) as Record<string, CachedEntry>;
  }

  private path(): string {
    return join(this.cacheDir, `${this.fileId}.json`);
  }

  async transcribe(samples: Float32Array, startSample: number): Promise<AsrResult> {
    const k = `${this.fileOffset + startSample}:${samples.length}`;
    let e = this.cache[k];
    if (e) {
      this.hits++;
    } else if (!this.model) {
      // Cache-only mode: an uncached window (e.g. a partial window at the very
      // end of a file) is treated as silence and counted.
      this.misses++;
      e = { p: [], pt: [], f: 0, w: samples.length / 16000, ms: 0 };
    } else {
      const r = await this.model.transcribe(samples);
      e = { p: r.pieces, pt: Array.from(r.pieceTimes), f: r.frames, w: r.windowSec, ms: r.inferMs };
      this.cache[k] = e;
      this.dirty = true;
      this.misses++;
      this.totalInferMs += r.inferMs;
      this.totalAudioSec += r.windowSec;
    }
    const pieceTimes = Float32Array.from(e.pt);
    const { key, src } = toKeyTimed(e.p);
    const keyTimes = new Float32Array(key.length);
    for (let i = 0; i < key.length; i++) keyTimes[i] = pieceTimes[src[i]];
    return {
      pieces: e.p,
      pieceTimes,
      text: e.p.join('').replace(/▁/g, ' ').trim(),
      key,
      keyTimes,
      frameSec: e.f > 0 ? e.w / e.f : 0.04,
      frames: e.f,
      windowSec: e.w,
      inferMs: e.ms,
    };
  }

  save(): void {
    if (this.dirty) writeFileSync(this.path(), JSON.stringify(this.cache));
    this.dirty = false;
  }
}
