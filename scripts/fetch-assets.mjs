// Downloads the runtime assets that are too large for the repository:
//   models/model.int8.onnx, models/edge-vocab.json  (karansea IndicConformer CTC, MIT)
//   assets/shabados/master.sqlite                    (Shabad OS Database 5.0.0-next.0)
// The corpus is then built with `npm run build-corpus` (resources/corpus.json.gz
// is already committed, so this step is only needed to rebuild it).
//
// Behind a proxy on Node >= 22.21, run with NODE_USE_ENV_PROXY=1.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

const HF = 'https://huggingface.co/karansea/indicconformer-stt-pa-ctc-shabad-preview/resolve/main';
const MODEL_FILES = [
  { url: `${HF}/model.int8.onnx`, out: 'models/model.int8.onnx', minBytes: 150e6 },
  { url: `${HF}/edge-vocab.json`, out: 'models/edge-vocab.json', minBytes: 1000 },
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

for (const f of MODEL_FILES) {
  if (existsSync(f.out) && readFileSync(f.out).length >= f.minBytes) {
    console.log(`  ${f.out} already present`);
    continue;
  }
  console.log(`downloading ${f.url}`);
  const buf = await download(f.url);
  if (buf.length < f.minBytes) throw new Error(`${f.url}: unexpectedly small (${buf.length} bytes)`);
  save(f.out, buf);
}

if (existsSync(SHABADOS_OUT)) {
  console.log(`  ${SHABADOS_OUT} already present`);
} else {
  console.log(`downloading ${SHABADOS_TGZ}`);
  const tar = gunzipSync(await download(SHABADOS_TGZ));
  save(SHABADOS_OUT, extractFromTar(tar, 'package/dist/master.sqlite'));
}
console.log('done');
