# Kirtan Saathi

Offline desktop app (Electron, Windows + macOS) that listens to a microphone, works out which Gurbani is being sung or recited, and shows the current tuk. It handles three situations:

| Mode | For | What it does |
|---|---|---|
| **Kirtan** | Sung shabads | Identifies the shabad from the whole corpus, then tracks the line through repeats and returns to the rahao |
| **Paath** | Sehaj or akhand paath | Finds the position, then follows recitation forward through the source, across shabad boundaries |
| **Bani** | Nitnem and other banis | Follows a chosen bani (Japji, Jaap, Rehras, Sohila, Anand, Sukhmani and others; 29 in total) |

Everything runs on the CPU with no network access at runtime. Only canonical Gurbani text is ever displayed; the recognizer's own transcript is used for matching only.

Status: Phase 2 (engine, kirtan + paath + bani modes, operator window, benchmarks, CI). The projector and livestream overlay are Phase 3.

## Results

### Kirtan: Live Gurbani Captioning benchmark v1 (live, blind)

4 kirtan recordings × 3 start offsets; frame accuracy at 1 s resolution with a 1 s collar.

| Recording | Full | Join at 33% | Join at 66% | First correct lock (full / 33% / 66%) |
|---|---|---|---|---|
| IZOsmkdmmcg (Saarang M5, 7.7 min) | 97.6% | 97.1% | 96.2% | 7 s / 5 s / 8 s |
| kZhIA8P6xWI (Goojree M1, 5.1 min) | 91.1% | 89.4% | 89.5% | 28 s / 15 s / 7 s |
| kchMJPK9Axs (Gauree, Bhagat Kabir, 10.9 min) | 96.8% | 93.2% | 94.6% | 9 s / 23 s / 7 s |
| zOtIpxMT9hU (Maaroo M5, 4.9 min) | 47.4% | 69.9% | 79.8% | 163 s / 66 s / 17 s |
| **Overall** | | | | **88.9%** (3046/3425 frames) |

- **Reference points.** The published reference system scores 57.9%. A perfect transcript delayed by 5 s scores 85.5%. Scores are cross-checked with the benchmark's own `eval.py`.
- **No wrong shabads.** No frame showed a wrong shabad in any case. Adding each decode's measured latency leaves the score unchanged.
- **Where errors are.** 8.4% of frames are lost before the first lock and 2.7% to the wrong line while locked, mostly the ~1 s lag at line changes. Identification is the lever.
- **The weak recording.** The model decodes zOtIpxMT9hU's singer poorly, and the engine waits rather than guessing.
- **Shabad changes.** Spliced recordings (`node dist/cli/transition.js <idA> <idB>`) switch 11 s and 28 s after the splice, with no time on a wrong shabad.

### Paath and bani: stitched sehaj-paath streams

Built from [surindersinghssj/gurbani-sehajpath](https://huggingface.co/datasets/surindersinghssj/gurbani-sehajpath) (CC BY 4.0): one paathi, one line per clip, joined in reading order with 0.4 s pauses. Every clip maps to its corpus line (858/858).

| Stream | Mode | Within 1 line | Exact line | Median lag | Missed lines |
|---|---|---|---|---|---|
| Angs 1090–1100, validation split (23 min) | paath | **97.9%** | 80.6% | 0.68 s | 2/300 |
| Sri Raag from ang 14 (15 min) | paath | **98.2%** | 82.8% | 0.69 s | 3/173 |
| Japji Sahib (25 min) | bani | **99.7%** | 79.5% | 0.63 s | 1/385 |
| Japji Sahib (25 min) | paath | **99.0%** | 78.9% | 0.62 s | 2/385 |

- **Phase 2 gate passed.** The gate was ≥ 95% within one line and a median lag ≤ 1 s.
- **"Exact" is lower than "within 1 line" by design.** The display moves once a word or so of the new line is read, so the first ~0.7 s of each line still shows the previous one.
- **Training overlap.** The acoustic model may have been trained on this dataset. The validation split is the least likely to overlap, so treat it as the headline.

### Compute

Measured on a 2-vCPU Xeon @ 2.1 GHz with 2 threads.

| Metric | Value |
|---|---|
| Decode time | 190 ms per 5 s window (RTF ≈ 0.04), 154 ms per 4 s paath window |
| Real-time soak, 10 min | update lands p50 0.19 s / p95 0.42 s after its audio; stayed at pace tier 1× |
| RSS | 656 → 693 MB |
| Simulated soak, 2 h, with mode switches | heap flat at ~134 MB after warm-up; matcher + tracker p50 0.3 ms per step |

On slower machines the pacer moves through tiers (1×, 1.5×, 2×, 3×, 4× hop length) so decoding always fits in real time. The engine always decodes the newest audio, so audio never backs up.

The kirtan benchmark has 4 recordings and thresholds were tuned on them. Treat all numbers as smoke tests, not generalization estimates.

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
npm run run-file -- path/to/paath.mp3 --mode paath
npm run run-file -- path/to/nitnem.mp3 --mode bani:JAPJ
```

`npm install` notes:

- **ONNX Runtime pin.** `onnxruntime-node` is pinned to 1.23.2, the last release that ships Intel macOS binaries; 1.24 and later support Apple Silicon only.
- **Linux postinstall.** On Linux, the ONNX Runtime postinstall tries to download GPU binaries from NuGet. If that is blocked, run `npm install --onnxruntime-node-install=skip`; the CPU binaries are already in the npm package.

## Using the app

- **Mode.** Pick Kirtan, Paath, or a bani from the mode menu. Changing mode clears the lock.
- **Input.** Choose an input and press **Start listening**. Prefer a line feed from the gurdwara mixer over a laptop mic.
- **Testing.** **Test with a file** plays a recording through the speakers while the engine follows it.
- **Lock** on a candidate pins that shabad (or position in paath). Automatic switching and unlocking pause until **Reset**.
- **Clicking a line** moves the display there; following continues from that line.
- **Next line.** In paath and bani modes the next line is previewed under the current one.
- **Find a shabad** searches typed Gurmukhi text.

## How it works

```
mic (16 kHz mono, AudioWorklet)
  → engine utility process
      ASR: IndicConformer CTC int8 (ONNX Runtime, CPU), sliding windows
      identify (kirtan, paath): 10 s window every 1 s
        → candidate lines: char-trigram + consonant-skeleton 4-gram index (141k lines)
        → candidate shabads: repeat-tolerant alignment against each shabad's text
        → evidence accumulates per shabad → lock when one is clearly ahead
      identify (bani): align an 8 s window against the whole bani
      kirtan, locked: 5 s window every 0.5 s
        → HMM line tracker (stay / next / back to rahao / jump), holds through instrumentals
        → every 2 s a 10 s global search; a challenger that explains the same
          windows clearly better (paired comparison) takes over
      paath / bani, locked: 4 s window every 0.5 s
        → per-line "where does the recent audio end" scores over the lines around
          the current position, with distance penalties; advances once a word of
          the next line is heard, moves back or skips only on repeated evidence
  → (shabad, line) events → renderer shows canonical text only
```

**Gurmukhi-aware matching.** Transcript and corpus are reduced to a matching key (`src/engine/gurmukhi.ts`):

- **Dropped:** tippi, bindi, adhak, nukta, halant, vishraam, dandas and digits.
- **Merged vowels:** short and long i, and short and long u.
- **Similar consonants:** the alignment gives partial credit for aspiration and voicing pairs, retroflex vs. dental, and Punjabi tonal devoicing (ਭ ਧ ਘ ਝ ਢ spoken like ਪ ਤ ਕ ਚ ਟ).

**Repeat-tolerant alignment (kirtan).** The alignment may restart at a line start, a vishraam or a word start, so "ਸਮਝੁ ਮਨੁ ਬਉਰਾ ਸਮਝੁ ਮਨੁ ਬਉਰਾ" is fully explained by one line. Restarts mid-word are not allowed.

**Contiguous end scoring (paath).** Recitation is contiguous, so paath scoring allows no restarts. A line counts as the current position only when the alignment reaches a word or so into it. Identical headings and phrases, which recur constantly in vaars, resolve toward the expected position through distance penalties rather than to the first match.

**Holding through instrumentals.** Tabla and harmonium decode as consonant soup that matches every line a little. When no line explains at least 60% of the last 3 s, the kirtan tracker holds the current line. Windows that nothing in the corpus explains don't count toward unlocking.

## Evaluation and CI

Prepare evaluation data (not redistributed; needs git, curl, ffmpeg, and Python with `pyarrow` and `soundfile`):

```bash
bash scripts/fetch-bench-data.sh .bench-data    # benchmark v1 (pinned) + audio + paath streams
npm run build
npm run ci-bench -- --data .bench-data --out bench-results   # everything, gated
npm run bench -- --gt .bench-data/bench/test --audio .bench-data/audio
npm run paath-eval -- val-1090 --dir .bench-data/paath --mode paath
```

**Decode cache.** Decoded windows are cached in `.cache/asr/` (keyed by audio position and length). After the first run, matcher and tracker changes re-run from cache in minutes; `--cache-only` and `node dist/cli/sweep.js '<json option sets>'` tune parameters in seconds.

### GitHub Actions

| Workflow | When | What |
|---|---|---|
| `.github/workflows/ci.yml` | every push and pull request | Build and unit tests, plus a native ONNX Runtime model smoke test on Ubuntu, Windows and macOS |
| `.github/workflows/benchmark.yml` | merges to `main`, pull requests into `main`, manual | Full kirtan + paath benchmark gated by `ci/thresholds.json`, deltas against `ci/baseline.json`, Electron app smoke test under Xvfb |

Benchmark outputs:

- **Where results appear:** in the job summary and as a sticky comment on the pull request.
- **Artifacts:** `results.json`, `summary.md`, and the app screenshot.
- **Run time:** the first run decodes ~90 min of audio (allow up to 2 h). Later runs reuse the decode cache.

When a change is an intended improvement, update `ci/baseline.json` in the same pull request (copy `bench-results/results.json`).

## Project layout

| Path | What it does |
|---|---|
| `src/engine/gurmukhi.ts` | Matching key, boundaries, consonant skeleton, line roles |
| `src/engine/corpus.ts` | Corpus loader (141,264 lines, 12,730 shabads, 29 banis) |
| `src/engine/ngram-index.ts` | IDF-weighted n-gram inverted index |
| `src/engine/align.ts` | Substitution table, Smith-Waterman, repeat-tolerant alignment with end scores |
| `src/engine/retrieval.ts` | Whole-corpus search, per-shabad and per-line scoring |
| `src/engine/tracker.ts` | Kirtan HMM line tracker |
| `src/engine/paath.ts` | Paath / bani follower, source and bani streams |
| `src/engine/engine.ts` | Modes and the search / lock / follow / switch / unlock state machine |
| `src/engine/pacer.ts` | Real-time pacing tiers |
| `src/engine/asr.ts` | ONNX Runtime inference and greedy CTC decoding |
| `src/main/` | Electron main, preload, engine utility process, message protocol |
| `src/renderer/`, `static/` | Operator window, audio capture worklet, styles |
| `src/cli/` | `bench`, `paath-eval`, `ci-bench`, `run-file`, `calibrate`, `sweep`, `transition`, `soak`, `prefill-cache`, `model-smoke`, `build-corpus`, `score` |
| `src/test/` | Unit tests (`npm test`) |
| `scripts/` | Asset and evaluation-data fetchers |
| `ci/` | Benchmark thresholds and baseline |

## Licensing of what is bundled or downloaded

| Component | License | Notes |
|---|---|---|
| This code | MIT | |
| Gurbani text: Shabad OS Database 5.0.0-next.0 | Public domain (per Shabad OS); code MIT | Text is displayed verbatim. Shabad OS forbids derogatory alteration. Version 4.8.7 is **not** used, because its package is CC BY-SA 4.0 / GPL-3.0. |
| Acoustic model: `karansea/indicconformer-stt-pa-ctc-shabad-preview` | MIT | Fine-tune of AI4Bharat IndicConformer (MIT). Training-data provenance is not documented. |
| ONNX Runtime | MIT | |
| Noto Sans Gurmukhi | SIL OFL 1.1 | Bundled for offline rendering |
| Benchmark scorer port (`src/cli/score.ts`) | MIT | From Karanbir Singh's benchmark |
| Evaluation data (downloaded, not bundled) | Benchmark annotations CC BY 4.0; sehaj-paath dataset CC BY 4.0 | "Live Captioning for Gurbani Kirtan benchmark v1"; surindersinghssj/gurbani-sehajpath |

No code was copied from SikhiToTheMax (OSL-3.0) or kirtan-captioning (CC BY-NC-SA). BaniDB data is not used.

## Known limitations

- **No katha mode yet.** Katha speech may briefly lock onto a shabad.
- **Gurmukhi-only text search.** The operator search takes Gurmukhi text; first-letter search is not implemented.
- **No projector or overlay yet.** There is no second-display projector window or OBS overlay; those are Phase 3.
- **No signed installers.** Run from source with `npm start`.
- **Limited evaluation coverage.** Dasam Granth, Vaaran and Bhai Nand Lal are searchable but have no evaluation audio. The kirtan set is small.
- **Intel Mac not tested in CI.** It is supported through the ONNX Runtime 1.23.2 pin.
- **Deferred: constrained decoding after lock.** At most 2.7% of kirtan frames could benefit. Rescoring identification candidates against the model's raw probabilities is the more promising next step.
