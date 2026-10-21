# Test fixtures

`japji-50s.wav`: the first 50 seconds of Japji Sahib sehaj paath, 16 kHz mono,
stitched from [surindersinghssj/gurbani-sehajpath](https://huggingface.co/datasets/surindersinghssj/gurbani-sehajpath)
(CC BY 4.0) by `scripts/make-paath-streams.py`. The installer workflow plays it
through each installed app to check that the whole pipeline works on that OS.

`japji-50s.timeline.json`: the corpus line, Gurbani text and Punjabi arth (from the bundled meanings) for each line in `japji-50s.wav`. `scripts/make-caption-video.py` draws captions from it to test the caption labeller in CI.

`two-shabads.wav`: one shabad, then another, for the end-to-end check that a new shabad takes over without *Search again* (`src/e2e/shabads.e2e.ts`). Sehaj paath of Sri Raag from the same dataset (CC BY 4.0): 0–37.4 s is the shabad ਮੋਤੀ ਤ ਮੰਦਰ ਊਸਰਹਿ (ang 14), then 1 s of silence, then from 38.4 s the shabad ਕੋਟਿ ਕੋਟੀ ਮੇਰੀ ਆਰਜਾ (ang 14), 16 kHz mono.
