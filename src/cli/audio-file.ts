import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SAMPLE_RATE } from '../engine/asr';

function parseWav(buf: Buffer): Float32Array | null {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        rate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data' && fmt) {
      if (fmt.rate !== SAMPLE_RATE || fmt.channels !== 1) return null;
      const data = buf.subarray(off + 8, off + 8 + size);
      if (fmt.format === 1 && fmt.bits === 16) {
        const out = new Float32Array(data.length >> 1);
        for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
        return out;
      }
      if (fmt.format === 3 && fmt.bits === 32) {
        return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
      }
      return null;
    }
    off += 8 + size + (size & 1);
  }
  return null;
}

/** Load any audio file as 16 kHz mono float32 (uses ffmpeg for non-WAV input). */
export function loadAudio(path: string): Float32Array {
  const direct = path.toLowerCase().endsWith('.wav') ? parseWav(readFileSync(path)) : null;
  if (direct) return direct;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-'], {
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0 || !r.stdout) {
    throw new Error(`could not decode ${path}: install ffmpeg or provide a 16 kHz mono WAV (${r.stderr?.toString() ?? ''})`);
  }
  const b = r.stdout as Buffer;
  const out = new Float32Array(b.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(i * 2) / 32768;
  return out;
}
