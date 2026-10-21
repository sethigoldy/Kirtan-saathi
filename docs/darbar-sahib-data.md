# Darbar Sahib recordings

Kirtan from Sri Darbar Sahib is broadcast with the Gurbani line on screen. The caption labeller turns those recordings into time-aligned labels. The labels say which Gurbani line is being sung, second by second, without anyone labelling by hand. The recordings are used with the permission of the SGPC.

**Recordings and labels never go into this public repository.** They live in the private repository [`sethigoldy/kirtan-saathi-data`](https://github.com/sethigoldy/kirtan-saathi-data):

- `test/`: held out for the benchmark.
- `train/`: for tuning and, later, fine-tuning the speech model.

## How labelling works

```
video ─ffmpeg─▶ 16 kHz audio ─────────────────────────────────────────────▶ <id>_16k.wav
      └ffmpeg─▶ caption band, 2 frames/s ─▶ change detection ─▶ one image per caption
                                              ─▶ Tesseract (Gurmukhi, tessdata_best)
                                              ─▶ matched to a corpus line ─▶ <id>.json
```

1. **Caption changes.** These are detected from the caption's text pixels, not the whole image. A new line is found even when it has the same length and layout, and a translucent band over moving video doesn't trigger false changes.
2. **Matching.** The OCR text is matched with the app's own aligner, so OCR mistakes cost little. Each caption line is scored against corpus lines in both directions.
3. **Shabad continuity.** A weak or very short caption, like a heading, is re-matched inside the shabad of its neighbours. A line that appears more than once, like a refrain, is taken from the copy just after the previous caption.
4. **Translations ignored.** Punjabi and English translation lines on the band do not match Gurbani and are dropped.

Labels follow the *caption*, which a live operator changes by hand. They usually trail the singing by about a second. The benchmark's 1-second collar absorbs most of this.

## Accuracy on a synthetic broadcast

`scripts/make-caption-video.py` draws captions in the broadcast style over a recorded Japji Sahib paath: Gurbani, then Punjabi arth, then English, with 0.3–1.5 s of random operator lag. The correct labels are therefore known exactly. Both variants have 52 captions over 4 minutes:

| Variant | Caption recall | Time agreement | Median boundary error |
|---|---|---|---|
| Opaque band, Noto Sans Gurmukhi | 100% | 97.2% | 0.13 s |
| Translucent band over moving video, Anek Gurmukhi | 98.1% | 96.8% | 0.14 s |

The one miss is the three-letter heading "॥ ਜਪੁ ॥", which the OCR misread. CI repeats the translucent test on every push (*Caption labeller* job, gate: 90% recall).

Real broadcasts will differ: font, band position, compression. Check the first few labelled recordings in `review.html`, and adjust `--region` if the captions are not in the bottom third.

## Building the dataset in bulk

`darbar-batch` builds the dataset from SGPC's archive of live kirtan streams (*Official SGPC LIVE | Gurbani Kirtan*, about three a day). It skips audio-only streams, Katha and Hukamnama.

Run it on your own computer. YouTube refuses downloads from cloud servers, including GitHub's runners, with "Sign in to confirm you're not a bot". Home connections are normally fine.

**Install** (once):

| | |
|---|---|
| macOS | `brew install node ffmpeg tesseract yt-dlp` |
| Windows | `winget install OpenJS.NodeJS.LTS Gyan.FFmpeg UB-Mannheim.TesseractOCR yt-dlp.yt-dlp` |
| Ubuntu | `sudo apt install ffmpeg tesseract-ocr` and `pipx install yt-dlp` (Node 22 from nodejs.org) |

Then, in a clone of this repository with the private data repository cloned next to it:

```bash
npm install && npm run build
git clone https://github.com/sethigoldy/kirtan-saathi-data ../kirtan-saathi-data
npm run darbar-batch -- --count 100 --workers 3 --push
```

What it does:

1. **Lists the archive.** Finished, rejected and other computers' streams are skipped, so it can be stopped and restarted.
2. **Finds the caption area** on 3 minutes of the first stream. It tries the bottom third, bottom quarter, bottom half, lower middle and top, and keeps the area that reads Gurbani. The result is saved to the data repository's `caption-region.json`, and every later run and computer reuses it. If no area reads Gurbani, the tool stops before any bulk download.
3. **Runs parallel workers** (`--workers`, default 3). Each worker:
   - downloads only the part it needs at 720p: 60 minutes from the middle 80% of a training stream, or 8 minutes from a test stream;
   - labels the captions;
   - packs the Opus audio, labels and metadata into the data repository;
   - deletes the video.
4. **Rejects** streams where captions cover under 25% of the window. They are recorded in `rejected/`.
5. **Commits and pushes** every 5 recordings with `--push`, rebasing first so several computers can push to the same repository.

**Several computers.** Run the same command on each with `--shard 1/3`, `--shard 2/3` and `--shard 3/3`. Each stream belongs to exactly one shard, decided from its id, so no two computers download the same stream.

**Splits.** About one stream in 14 goes to `test/`, decided from the video id the same way on every computer. With 100 streams that gives about 7 test clips of 8 minutes each (about an hour). Training audio is about 1 GB per 100 streams. The benchmark downloads only `test/`.

**Speed.** Labelling runs at several times real time per worker, and downloads usually dominate. Expect a few hours for 100 streams on a recent laptop. `--dry-run` lists what would be processed without downloading.

If YouTube asks you to sign in from your own computer too, add `--cookies-from-browser chrome` (or `safari`, `firefox`). yt-dlp then uses that browser's YouTube session.

## Adding a recording

Prerequisites on your computer:

- Node 22, ffmpeg, Tesseract, and [yt-dlp](https://github.com/yt-dlp/yt-dlp) for links.
- This repository built (`npm install && npm run build`).
- The private data repository cloned next to it (`../kirtan-saathi-data`).

```bash
scripts/darbar-add.sh "https://www.youtube.com/watch?v=…" --split test --title "Asa di Vaar, 12 Oct 2026"
# or a file you already have:
scripts/darbar-add.sh ~/Videos/darbar-sahib-2026-10-12.mp4 --split train
# label part of a long recording:
scripts/darbar-add.sh ~/Videos/long.mp4 --split test --start 1800 --duration 1200
```

The script:

1. Downloads the video (720p is enough).
2. Fetches the Gurmukhi OCR model on first use.
3. Labels the recording.
4. Packs Opus audio and the labels into the data repository, keeping only segments with confidence ≥ 0.72.

Then:

1. Open `darbar-data/labelled/<id>/review.html` and scroll through. Yellow rows were matched through neighbouring captions; red rows did not match.
2. Commit and push the data repository; the script prints the command.

**Choosing the test set.** Keep `test/` to about 30–60 minutes, because every pull request decodes it in full. Cover different raags, ragi jathas, and times of day. Put everything else in `train/`. A recording belongs to one split only.

## How the benchmark uses it

The *Benchmark* workflow:

1. Clones the data repository with the `DATA_REPO_TOKEN` secret.
2. Decodes `test/` into the job's temporary directory.
3. Scores the app in kirtan mode.

The pull-request comment gains a *Darbar Sahib kirtan (private)* table with aggregate numbers only: frame accuracy, time on a wrong shabad, first correct lock.

Several precautions keep the private data private:

- **No caches.** The recordings, labels and recognizer output never go into `.bench-data`, the decode cache or uploaded artifacts. Caches can be restored by pull requests from forks.
- **Report only.** `ci/thresholds.json` has `darbarFrameAccuracyMin: null`, so the set reports without gating. Once it has a few recordings, record its numbers in `ci/baseline.json` and set a gate a little below them.
- **Fork pull requests** don't receive the secret and skip the set.

## Next: training data

The `train/` labels say which line is sung during each caption. To fine-tune the speech model:

1. **Tighten boundaries.** Forced-align each line's text to the audio with the app's CTC model, within the caption window plus a few seconds, to get exact boundaries despite operator lag.
2. **Export clips.** Write per-line clips and a NeMo-style manifest (audio path, duration, Gurmukhi text).
3. **Fine-tune on a GPU.** Fine-tune `indicconformer-stt-pa-ctc-shabad-preview` on a GPU machine and compare it on the benchmark before replacing the bundled model.
