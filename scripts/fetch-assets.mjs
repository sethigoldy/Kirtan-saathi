// Downloads the runtime assets that are too large for the repository:
//   models/model.int8.onnx, models/edge-vocab.json  (karansea IndicConformer CTC, MIT)
//   assets/shabados/master.sqlite                    (Shabad OS Database 5.0.0-next.0)
// The corpus is then built with `npm run build-corpus` (resources/corpus.json.gz
// is already committed, so this step is only needed to rebuild it).
//
// Behind a proxy on Node >= 22.21, run with NODE_USE_ENV_PROXY=1.
// --model-only skips the database (CI and end users only need the model).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

// Pinned revision and checksums: every build (and every installer) ships
// exactly the model the benchmarks were run with.
const HF_REVISION = '5fd2e89e3a43d31f47b0fb55fdce5ed50a91283f';
const HF = `https://huggingface.co/karansea/indicconformer-stt-pa-ctc-shabad-preview/resolve/${HF_REVISION}`;
const MODEL_FILES = [
  {
    url: `${HF}/model.int8.onnx`,
    out: 'models/model.int8.onnx',
    sha256: '5f9e41d867dee2883796e290eef85abc11cbd32fe0f10c1f763a638d824634f9',
  },
  {
    url: `${HF}/edge-vocab.json`,
    out: 'models/edge-vocab.json',
    sha256: '1e50a56595c6b2471b02152419d86f1e6275cfbe8ec4241cc6856730a6d00ea9',
  },
];
const SHABADOS_TGZ = 'https://registry.npmjs.org/@shabados/database/-/database-5.0.0-next.0.tgz';
const SHABADOS_OUT = 'assets/shabados/master.sqlite';

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Extract one file from a tar archive (ustar). */
function extractFromTar(tar, wanted) {
  let off = 0;
  while (off + 512 <= tar.length) {
    const name = tar.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(tar.toString('utf8', off + 124, off + 136).replace(/\0.*$/, '').trim() || '0', 8);
    const prefix = tar.toString('utf8', off + 345, off + 500).replace(/\0.*$/, '');
    const full = prefix ? `${prefix}/${name}` : name;
    if (full === wanted) return tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} not found in archive`);
}

function save(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  console.log(`  ${path}  ${(buf.length / 1e6).toFixed(1)} MB  sha256:${sha}…`);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

for (const f of MODEL_FILES) {
  if (existsSync(f.out) && sha256(readFileSync(f.out)) === f.sha256) {
    console.log(`  ${f.out} already present (checksum ok)`);
    continue;
  }
  console.log(`downloading ${f.url}`);
  const buf = await download(f.url);
  const got = sha256(buf);
  if (got !== f.sha256) throw new Error(`${f.url}: checksum mismatch (expected ${f.sha256}, got ${got})`);
  save(f.out, buf);
}

if (process.argv.includes('--model-only')) {
  console.log('done (model only)');
  process.exit(0);
}

if (existsSync(SHABADOS_OUT)) {
  console.log(`  ${SHABADOS_OUT} already present`);
} else {
  console.log(`downloading ${SHABADOS_TGZ}`);
  const tar = gunzipSync(await download(SHABADOS_TGZ));
  save(SHABADOS_OUT, extractFromTar(tar, 'package/dist/master.sqlite'));
}
console.log('done');
