#!/usr/bin/env bash
# Adds a Darbar Sahib recording (used with SGPC's permission) to the private
# data repository: download (if a link), read the captions, match them to
# Gurbani lines, then pack audio + labels into ../kirtan-saathi-data.
#
#   scripts/darbar-add.sh <video file or YouTube link> --split test|train [--title "..."] [--start S --duration S]
#
# Needs: Node 22, ffmpeg, tesseract, and yt-dlp for links. Run `npm install && npm run build` first.
# Review darbar-data/labelled/<id>/review.html before committing the data repository.
set -euo pipefail

src="${1:?usage: darbar-add.sh <video|link> --split test|train [--title ...] [--start S --duration S]}"
shift
split="" title="" range=()
while [ $# -gt 0 ]; do
  case "$1" in
    --split) split="$2"; shift 2 ;;
    --title) title="$2"; shift 2 ;;
    --start|--duration) range+=("$1" "$2"); shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ "$split" = test ] || [ "$split" = train ] || { echo "--split test|train is required" >&2; exit 2; }

root="$(cd "$(dirname "$0")/.." && pwd)"
data="${KS_DATA_REPO:-$root/../kirtan-saathi-data}"
[ -d "$data/.git" ] || { echo "clone the private data repository to $data first (or set KS_DATA_REPO)" >&2; exit 1; }
work="$root/darbar-data"
mkdir -p "$work/videos" "$work/labelled"

# Gurmukhi OCR model (tessdata_best), fetched once.
tess="${TESSDATA_PREFIX:-$HOME/.cache/kirtan-saathi/tessdata}"
if [ ! -f "$tess/pan.traineddata" ]; then
  mkdir -p "$tess"
  echo "downloading the Gurmukhi OCR model to $tess"
  curl -sSfL -o "$tess/pan.traineddata" https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/pan.traineddata
fi

source_note="$src"
if [[ "$src" =~ ^https?:// ]]; then
  command -v yt-dlp >/dev/null || { echo "install yt-dlp to download links (https://github.com/yt-dlp/yt-dlp)" >&2; exit 1; }
  # 720p is plenty for reading captions and keeps downloads small.
  video=$(yt-dlp -f 'bv*[height<=720]+ba/b[height<=720]' --merge-output-format mp4 \
    -o "$work/videos/%(upload_date)s-%(id)s.%(ext)s" --print after_move:filepath --no-progress "$src")
  [ -n "$title" ] || title=$(yt-dlp --get-title "$src" 2>/dev/null || echo "")
else
  video="$src"
fi

TESSDATA_PREFIX="$tess" node "$root/dist/cli/caption-label.js" "$video" --out "$work/labelled" "${range[@]}"
id=$(basename "${video%.*}" | sed 's/[^A-Za-z0-9_.-]\+/_/g')
node "$root/dist/cli/caption-pack.js" "$work/labelled/$id" "$data" --split "$split" --title "${title:-$id}" --source "$source_note"

echo
echo "Check the labels: $work/labelled/$id/review.html"
echo "Then commit the data repository:"
echo "  git -C \"$data\" add -A && git -C \"$data\" commit -m \"Add $id ($split)\" && git -C \"$data\" push"
