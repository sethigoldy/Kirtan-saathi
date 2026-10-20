#!/usr/bin/env bash
# Downloads and prepares evaluation data (not redistributed with this repo):
#   bench/   Live Gurbani Captioning benchmark v1 (code MIT, annotations CC BY 4.0), pinned commit
#   audio/   its 4 kirtan recordings, converted to 16 kHz mono WAV
#   paath/   stitched sehaj-paath streams from surindersinghssj/gurbani-sehajpath (CC BY 4.0)
# Requires: git, curl, ffmpeg, python3 with pyarrow + soundfile.
set -euo pipefail

DIR="${1:-.bench-data}"
BENCH_REPO="https://github.com/karanbirsingh/live-gurbani-captioning-benchmark-v1"
BENCH_COMMIT="5cfa23d583c8157e09beb07c911bc1009ae41b10"
mkdir -p "$DIR/audio" "$DIR/paath"

if [ ! -d "$DIR/bench/.git" ]; then
  git clone --quiet "$BENCH_REPO" "$DIR/bench"
fi
git -C "$DIR/bench" checkout --quiet "$BENCH_COMMIT"

for id in IZOsmkdmmcg kZhIA8P6xWI kchMJPK9Axs zOtIpxMT9hU; do
  if [ ! -f "$DIR/audio/${id}_16k.wav" ]; then
    curl -sSfL -o "$DIR/audio/$id.webm" "https://raw.githubusercontent.com/karanbirsingh/bin/main/audio/$id.webm"
    ffmpeg -loglevel error -y -i "$DIR/audio/$id.webm" -ar 16000 -ac 1 "$DIR/audio/${id}_16k.wav"
    rm -f "$DIR/audio/$id.webm"
  fi
done

python3 "$(dirname "$0")/make-paath-streams.py" "$DIR/paath"
echo "evaluation data ready in $DIR"
