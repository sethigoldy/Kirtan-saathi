#!/usr/bin/env python3
"""Stitch consecutive sehaj-paath clips into continuous evaluation streams.

Source: surindersinghssj/gurbani-sehajpath on Hugging Face (CC BY 4.0), one
recited line of Sri Guru Granth Sahib per clip, in reading order, single
paathi. Clips are joined with 0.4 s of silence. Each stream gets a WAV and a
.clips.json with per-clip start/end/text/ang, which paath-eval maps to
corpus lines.

Usage: python3 scripts/make-paath-streams.py <out_dir>
Requires: pyarrow, soundfile, numpy.
"""
import io
import json
import os
import sys
import urllib.request

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf

HF = 'https://huggingface.co/datasets/surindersinghssj/gurbani-sehajpath/resolve/main/data'
GAP = 0.4
STREAMS = {
    # validation split: angs 1090-1100 (the headline paath number)
    'val-1090': ('validation-00000-of-00001.parquet', 0, 300),
    # Japji Sahib (also used for bani mode)
    'japji': ('train-00000-of-00019.parquet', 0, 385),
    # Sri Raag from ang 14: many shabad boundaries
    'ang14': ('train-00000-of-00019.parquet', 587, 760),
}


def main(out: str) -> None:
    os.makedirs(out, exist_ok=True)
    cache = os.path.join(out, 'parquet')
    os.makedirs(cache, exist_ok=True)
    for name, (shard, a, b) in STREAMS.items():
        wav = os.path.join(out, f'{name}.wav')
        meta = os.path.join(out, f'{name}.clips.json')
        if os.path.exists(wav) and os.path.exists(meta):
            print(f'{name}: present')
            continue
        local = os.path.join(cache, shard)
        if not os.path.exists(local):
            print(f'downloading {shard}')
            urllib.request.urlretrieve(f'{HF}/{shard}', local)
        t = pq.read_table(local).slice(a, b - a).to_pydict()
        pcm, clips, pos = [], [], 0.0
        gap = np.zeros(int(GAP * 16000), dtype=np.float32)
        for i in range(b - a):
            audio, sr = sf.read(io.BytesIO(t['audio'][i]['bytes']), dtype='float32')
            assert sr == 16000, sr
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            dur = len(audio) / 16000
            clips.append({'start': round(pos, 3), 'end': round(pos + dur, 3), 'text': t['transcription'][i], 'ang': t['source_ang_range'][i]})
            pcm += [audio, gap]
            pos += dur + GAP
        sf.write(wav, np.concatenate(pcm), 16000, subtype='PCM_16')
        with open(meta, 'w', encoding='utf-8') as f:
            json.dump({'name': name, 'source': 'surindersinghssj/gurbani-sehajpath (CC BY 4.0)', 'speaker': t['speaker_id'][0], 'clips': clips}, f, ensure_ascii=False, indent=1)
        print(f'{name}: {len(clips)} clips, {pos / 60:.1f} min')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.bench-data/paath')
