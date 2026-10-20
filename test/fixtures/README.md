# Test fixtures

`japji-50s.wav`: the first 50 seconds of Japji Sahib sehaj paath, 16 kHz mono,
stitched from [surindersinghssj/gurbani-sehajpath](https://huggingface.co/datasets/surindersinghssj/gurbani-sehajpath)
(CC BY 4.0) by `scripts/make-paath-streams.py`. The installer workflow plays it
through each installed app to check that the whole pipeline works on that OS.

`japji-50s.timeline.json`: the corpus line, Gurbani text and Punjabi arth (from the bundled meanings) for each line in `japji-50s.wav`. `scripts/make-caption-video.py` draws captions from it to test the caption labeller in CI.
