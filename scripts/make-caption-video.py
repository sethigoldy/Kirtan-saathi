"""Synthetic captioned broadcast for testing scripts/caption-label.

Renders a video in the style of the Darbar Sahib telecast: the Gurbani line
in bold Gurmukhi on a caption band, with Punjabi and English translations
under it. Captions change with a random operator lag after each line starts,
like a live caption operator. Audio is a recorded paath stream, so the
expected labels are known exactly.

    python3 scripts/make-caption-video.py timeline.json audio.wav out.mp4 \
        [--style opaque|translucent] [--font noto|anek] [--seed 1] [--seconds 240]

timeline.json: [{start, end, line_id, text, pa, en}] in audio time.
Writes out.mp4 and out.truth.json ([{start, end, line_id}] in display time).
Needs Pillow with raqm, fontTools + brotli (to read the bundled woff2 fonts) and ffmpeg.
"""
import argparse
import json
import math
import random
import subprocess
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H, FPS = 1280, 720, 5


def ttf(woff2: Path, out_dir: Path, variation: dict | None = None, name: str | None = None) -> str:
    out = out_dir / ((name or woff2.stem) + '.ttf')
    font = TTFont(str(woff2))
    font.flavor = None
    if variation and 'fvar' in font:
        from fontTools.varLib.instancer import instantiateVariableFont
        font = instantiateVariableFont(font, variation)
    font.save(str(out))
    return str(out)


def fonts(kind: str, tmp: Path):
    nm = ROOT / 'node_modules/@fontsource'
    if kind == 'anek':
        anek = ROOT / 'node_modules/@fontsource-variable/anek-gurmukhi/files/anek-gurmukhi-gurmukhi-wdth-normal.woff2'
        guru = ttf(anek, tmp, {'wght': 700, 'wdth': 100}, 'anek-bold')
        body = ttf(anek, tmp, {'wght': 450, 'wdth': 100}, 'anek-regular')
    else:
        guru = ttf(nm / 'noto-sans-gurmukhi/files/noto-sans-gurmukhi-gurmukhi-600-normal.woff2', tmp)
        body = ttf(nm / 'noto-sans-gurmukhi/files/noto-sans-gurmukhi-gurmukhi-400-normal.woff2', tmp)
    latin = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    return (
        ImageFont.truetype(guru, 40, layout_engine=ImageFont.Layout.RAQM),
        ImageFont.truetype(body, 24, layout_engine=ImageFont.Layout.RAQM),
        ImageFont.truetype(latin, 20),
    )


def wrap(draw, text, font, width):
    lines, cur = [], ''
    for word in text.split():
        trial = f'{cur} {word}'.strip()
        if draw.textlength(trial, font=font) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def caption_band(cap, f_guru, f_pa, f_en, style):
    band_h = int(H * 0.32)
    band = Image.new('RGBA', (W, band_h), (12, 22, 60, 255 if style == 'opaque' else 190))
    if cap is None:
        return band
    d = ImageDraw.Draw(band)
    y = 14
    for line in wrap(d, cap['text'], f_guru, W - 120)[:2]:
        d.text((W / 2, y), line, font=f_guru, fill=(255, 255, 255), anchor='ma')
        y += 52
    for line in wrap(d, cap['pa'], f_pa, W - 160)[:2]:
        d.text((W / 2, y), line, font=f_pa, fill=(255, 214, 102), anchor='ma')
        y += 32
    for line in wrap(d, cap['en'], f_en, W - 160)[:2]:
        d.text((W / 2, y), line, font=f_en, fill=(230, 230, 230), anchor='ma')
        y += 26
    return band


def background(t, rng_blobs):
    img = Image.new('RGB', (W, H), (40, 28, 30))
    d = ImageDraw.Draw(img)
    for x, y, r, c, sx, sy in rng_blobs:
        cx = x + 80 * math.sin(t * sx)
        cy = y + 40 * math.cos(t * sy)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
    return img.filter(ImageFilter.GaussianBlur(18))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('timeline')
    ap.add_argument('audio')
    ap.add_argument('out')
    ap.add_argument('--style', default='opaque', choices=['opaque', 'translucent'])
    ap.add_argument('--font', default='noto', choices=['noto', 'anek'])
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--seconds', type=float, default=240)
    a = ap.parse_args()

    rng = random.Random(a.seed)
    tl = [c for c in json.load(open(a.timeline)) if c['start'] < a.seconds]
    # Operator lag: each caption appears 0.3-1.5 s after its line starts.
    shown = []
    for i, c in enumerate(tl):
        start = c['start'] + rng.uniform(0.3, 1.5)
        shown.append({**c, 'show': start})
    for i, c in enumerate(shown):
        c['hide'] = shown[i + 1]['show'] if i + 1 < len(shown) else min(a.seconds, c['end'] + 1.0)
    truth = [{'start': round(c['show'], 2), 'end': round(c['hide'], 2), 'line_id': c['line_id']} for c in shown]

    tmp = Path(tempfile.mkdtemp())
    f_guru, f_pa, f_en = fonts(a.font, tmp)
    blobs = [
        (rng.uniform(0, W), rng.uniform(0, H * 0.7), rng.uniform(60, 180),
         tuple(rng.randint(80, 255) for _ in range(3)), rng.uniform(0.2, 0.9), rng.uniform(0.2, 0.9))
        for _ in range(9)
    ]
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    ff = subprocess.Popen(
        ['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
         '-i', a.audio, '-t', str(a.seconds), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-crf', '30',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-shortest', a.out],
        stdin=subprocess.PIPE,
    )
    cache = {}
    idx = 0
    for n in range(int(a.seconds * FPS)):
        t = n / FPS
        while idx + 1 < len(shown) and shown[idx + 1]['show'] <= t:
            idx += 1
        cap = shown[idx] if shown and shown[idx]['show'] <= t < shown[idx]['hide'] else None
        key = cap['line_id'] if cap else None
        if key not in cache:
            cache[key] = caption_band(cap, f_guru, f_pa, f_en, a.style)
        frame = background(t, blobs) if a.style == 'translucent' else Image.new('RGB', (W, H), (40, 28, 30))
        frame.paste(cache[key], (0, H - cache[key].height), cache[key])
        ff.stdin.write(frame.tobytes())
    ff.stdin.close()
    ff.wait()
    Path(a.out).with_suffix('.truth.json').write_text(json.dumps(truth, indent=1))
    print(f'wrote {a.out}: {len(truth)} captions, {a.seconds:.0f} s, style={a.style}, font={a.font}')


if __name__ == '__main__':
    main()
