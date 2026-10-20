/**
 * Model smoke test: loads the ONNX model through onnxruntime-node on this OS
 * and architecture, decodes 5 s of synthetic audio, and checks the output
 * shape. Catches missing or broken native binaries per platform.
 *
 * Usage: node dist/cli/model-smoke.js
 */
import { resolve } from 'node:path';
import { arch, platform } from 'node:os';
import { AsrModel, SAMPLE_RATE } from '../engine/asr';

async function main(): Promise<void> {
  const t0 = Date.now();
  const model = await AsrModel.load(resolve('models/model.int8.onnx'), resolve('models/edge-vocab.json'));
  const loadMs = Date.now() - t0;
  const audio = new Float32Array(5 * SAMPLE_RATE);
  for (let i = 0; i < audio.length; i++) audio[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) + (Math.random() - 0.5) * 0.01;
  await model.transcribe(audio); // warm-up
  const r = await model.transcribe(audio);
  const expectedFrames = Math.round((5 * SAMPLE_RATE) / 640); // 40 ms frames
  if (Math.abs(r.frames - expectedFrames) > 3) throw new Error(`unexpected frame count ${r.frames} (expected ~${expectedFrames})`);
  console.log(
    `model smoke OK on ${platform()}-${arch()}: load ${loadMs} ms, 5 s decode ${r.inferMs.toFixed(0)} ms ` +
      `(RTF ${(r.inferMs / 5000).toFixed(3)}), ${r.frames} frames, ${model.threads} threads`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
