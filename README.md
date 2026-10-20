# Gurbani Live — Phase 1

Offline desktop app (Electron, Windows + macOS) that listens to a microphone, identifies which Gurbani shabad is being sung or recited, and shows the current tuk. Everything runs on the CPU, with no network access at runtime.

Phase 1 delivers the engine, a benchmark harness, and a minimal operator window. The projector, livestream overlay, paath mode and katha mode come in later phases.

## Results

Live, blind, on the [Live Gurbani Captioning benchmark v1](https://github.com/karanbirsingh/live-gurbani-captioning-benchmark-v1) (4 kirtan recordings × 3 start offsets, frame accuracy at 1 s resolution, 1 s collar):

| Recording | Full | Join at 33% | Join at 66% | First correct lock (full / 33% / 66%) |
|---|---|---|---|---|
| IZOsmkdmmcg (Saarang M5, 7.7 min) | 97.6% | 97.1% | 96.2% | 7 s / 5 s / 8 s |
| kZhIA8P6xWI (Goojree M1, 5.1 min) | 91.1% | 89.4% | 89.5% | 28 s / 15 s / 7 s |
| kchMJPK9Axs (Gauree, Bhagat Kabir, 10.9 min) | 96.8% | 93.2% | 94.6% | 9 s / 23 s / 7 s |
| zOtIpxMT9hU (Maaroo M5, 4.9 min) | 47.4% | 69.9% | 79.8% | 163 s / 66 s / 17 s |
| **Overall** | | | | **88.9%** (3046/3425 frames) |

- **Reference points.** The published reference system scores 57.9%. A perfect transcript delayed by 5 s scores 85.5%.
- **No wrong shabads.** No frame showed a wrong shabad in any case. Adding each decode's measured latency on a 2-vCPU Xeon @ 2.1 GHz leaves the score unchanged.
- **The weak recording.** zOtIpxMT9hU is low because the model decodes this singer poorly. The right shabad's window scores sit at the level of wrong shabads for the first ~70 s, and the engine waits rather than guessing.
- **Shabad transitions.** These are tested by splicing two recordings (`node dist/cli/transition.js <idA> <idB>`):

  | Splice | Switch time | Time on wrong shabad |
  |---|---|---|
  | kZhIA8P6xWI → IZOsmkdmmcg | 11 s | 0 s |
  | kchMJPK9Axs → kZhIA8P6xWI | 28 s (B opens with slow alaap) | 0 s |
- **Decode cost.** Measured on that 2-vCPU machine with 2 threads: 193 ms per 5 s window and 378 ms per 10 s window (RTF ≈ 0.04).

The benchmark has only 4 recordings, and the engine's thresholds were set on them. Treat these numbers as a smoke test, not a generalization estimate.

## Quick start

Prerequisites: Node.js 22 or later.

```bash
npm install
npm run fetch-assets      # model (184 MB) + Shabad OS database
npm start                 # builds and launches the app
```

Follow a recording from the command line (non-WAV input needs ffmpeg):

```bash
npm run run-file -- path/to/kirtan.mp3
```

In the app, either:

- **Live:** choose an input and press **Start listening**. Prefer a line feed from the gurdwara mixer over a laptop mic.
- **Recording:** use **Test with a file** to play a recording through the speakers while the engine follows it.

`npm install` notes:

- **ONNX Runtime pin.** `onnxruntime-node` is pinned to 1.23.2. That is the last release that ships Intel macOS binaries; 1.24 and later support Apple Silicon only.
- **Linux postinstall.** On Linux, the ONNX Runtime postinstall tries to download GPU binaries from NuGet. If that is blocked, run `npm install --onnxruntime-node-install=skip`. The CPU binaries are already in the npm package.

## Operator controls

- **Lock** on a candidate pins that shabad. Automatic switching and unlocking pause until **Reset**.
- **Clicking a line** moves the display there; the tracker continues from that line.
- **Find a shabad** searches typed Gurmukhi text across the corpus.

## How it works

```
mic (16 kHz mono, AudioWorklet)
  → engine utility process
      ASR: IndicConformer CTC int8 (ONNX Runtime, CPU), sliding windows
      searching: 10 s window every 1 s
        → candidate lines: char-trigram + consonant-skeleton 4-gram index (141k lines)
        → candidate shabads: repeat-tolerant alignment against each shabad's text
        → evidence accumulates per shabad over time → lock when one is clearly ahead
      locked: 5 s window every 0.5 s
        → HMM line tracker over the shabad (stay / next / back to rahao / jump)
        → every 2 s a 10 s global search: a challenger that explains the same
          windows clearly better (paired comparison) takes over; sustained
          mismatch unlocks; instrumental passages hold the display
  → (shabad, line) events → renderer shows canonical text only
```

**Matching, not transcription.** The model's raw transcript is never shown to the sangat. The model is fine-tuned on Gurbani, but it still gets about a third of kirtan characters wrong. The engine maps its output onto the closed corpus and only ever displays canonical lines.

**Gurmukhi-aware matching.** Both the transcript and the corpus are reduced to a matching key (`src/engine/gurmukhi.ts`):

- **Dropped:** marks the model and singers realize inconsistently — tippi, bindi, adhak, nukta, halant, vishraam, dandas and digits.
- **Merged vowels:** short and long i, and short and long u.
- **Similar consonants:** the alignment scores near-misses as partial matches (`src/engine/align.ts`). These cover aspiration and voicing pairs, retroflex vs. dental, and Punjabi tonal devoicing, where ਭ ਧ ਘ ਝ ਢ are spoken like ਪ ਤ ਕ ਚ ਟ.

**Repeat-tolerant alignment.** Kirtan repeats phrases and returns to the rahao. The alignment may restart at a line start, a vishraam or a word start, so "ਸਮਝੁ ਮਨੁ ਬਉਰਾ ਸਮਝੁ ਮਨੁ ਬਉਰਾ" is fully explained by one line. Restarts mid-word are not allowed, so a long shabad cannot be stitched together from fragments.

**Holding through instrumentals.** Tabla and harmonium passages decode as consonant soup that matches every line a little. When no line explains at least 60% of the last 3 s, the tracker holds the current line. When nothing in the corpus explains at least 60% of a 10 s window, those windows don't count toward unlocking. The 0.6 value was set on one tabla solo in the benchmark; scores are flat from 0.6 to 0.7.

**Paced decoding.** At startup the engine decodes 5 s of audio to measure this machine's speed and lengthens the hops on slow CPUs. It adapts again during use. Decoding always uses the newest audio, so a slow machine updates less often but never falls behind.

## Benchmark and tuning

```bash
git clone https://github.com/karanbirsingh/live-gurbani-captioning-benchmark-v1 ../bench
mkdir -p ../audio && for id in IZOsmkdmmcg kZhIA8P6xWI kchMJPK9Axs zOtIpxMT9hU; do
  curl -L -o ../audio/$id.webm https://raw.githubusercontent.com/karanbirsingh/bin/main/audio/$id.webm
  ffmpeg -y -i ../audio/$id.webm -ar 16000 -ac 1 ../audio/${id}_16k.wav
done

npm run build
npm run bench -- --gt ../bench/test --audio ../audio            # live, blind
npm run bench -- --gt ../bench/test --audio ../audio --latency  # + this machine's decode delay
npm run calibrate -- --gt ../bench/test --audio ../audio        # single-window score distributions
```

- **Decode cache.** Decoded windows are cached in `.cache/asr/`, so after the first run you can tune matcher and tracker parameters with `--cache-only --opts '{"lockMargin":0.4}'` in seconds.
- **Output.** Submissions are written to `bench-out/` in the benchmark's format. `npm run score -- bench-out ../bench/test` re-scores them; the scorer is a TypeScript port of `eval.py` and gives identical results on the published baselines.

## Project layout

| Path | What it does |
|---|---|
| `src/engine/gurmukhi.ts` | Matching key, boundaries, consonant skeleton, line roles |
| `src/engine/corpus.ts` | Corpus loader (141,264 lines, 12,730 shabads, 29 banis) |
| `src/engine/ngram-index.ts` | IDF-weighted n-gram inverted index |
| `src/engine/align.ts` | Substitution table, Smith-Waterman, repeat-tolerant alignment |
| `src/engine/retrieval.ts` | Whole-corpus search and per-shabad scoring |
| `src/engine/tracker.ts` | HMM line tracker with hysteresis |
| `src/engine/engine.ts` | Search / lock / follow / unlock state machine |
| `src/engine/asr.ts` | ONNX Runtime inference and greedy CTC decoding |
| `src/main/` | Electron main, preload, engine utility process, message protocol |
| `src/renderer/`, `static/` | Operator window, audio capture worklet, styles |
| `src/cli/` | `build-corpus`, `bench`, `calibrate`, `score`, `sweep`, `prefill-cache`, `transition` |
| `src/test/` | Unit tests (`npm test`) |

## Licensing of what is bundled or downloaded

| Component | License | Notes |
|---|---|---|
| This code | MIT | |
| Gurbani text: Shabad OS Database 5.0.0-next.0 | Public domain (per Shabad OS); code MIT | Text is displayed verbatim. Shabad OS forbids derogatory alteration. Version 4.8.7 is **not** used, because its package is CC BY-SA 4.0 / GPL-3.0. |
| Acoustic model: `karansea/indicconformer-stt-pa-ctc-shabad-preview` | MIT | Fine-tune of AI4Bharat IndicConformer (MIT). Training-data provenance is not documented on the model card. |
| ONNX Runtime | MIT | |
| Noto Sans Gurmukhi | SIL OFL 1.1 | Bundled for offline rendering. |
| Benchmark scorer port (`src/cli/score.ts`) | MIT | From Karanbir Singh's benchmark. |

No code was copied from SikhiToTheMax (OSL-3.0) or kirtan-captioning (CC BY-NC-SA). BaniDB data is not used.

## Known limitations

- **Kirtan only for now.** There is no paath mode (bani-as-stream follower) and no katha mode (quote gating). Katha speech may briefly lock onto a shabad.
- **Text search is Gurmukhi only.** The operator search box takes Gurmukhi text; first-letter search is not implemented yet.
- **No projector or overlay yet.** There is no second-display projector window or OBS overlay; those are Phase 3.
- **No packaging yet.** Signed installers are not set up; run from source with `npm start`.
- **Limited evaluation.** Dasam Granth, Vaaran and Bhai Nand Lal are searchable, but no evaluation audio exists for them yet.
