// electron-builder afterPack hook: keep only the ONNX Runtime binaries for the
// platform and CPU being packaged. Runs before signing.
const { existsSync, readdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');

// electron-builder's Arch enum.
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName; // darwin | win32 | linux
  const arch = ARCH[context.arch] ?? String(context.arch);
  const resources =
    platform === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources');
  const napi = join(resources, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
  if (!existsSync(napi)) throw new Error(`after-pack: ONNX Runtime binaries not found at ${napi}`);
  for (const p of readdirSync(napi)) {
    if (p !== platform) {
      rmSync(join(napi, p), { recursive: true, force: true });
      continue;
    }
    for (const a of readdirSync(join(napi, p))) {
      if (arch !== 'universal' && a !== arch) rmSync(join(napi, p, a), { recursive: true, force: true });
    }
  }
  const kept = join(napi, platform, arch);
  if (!existsSync(kept)) throw new Error(`after-pack: no ONNX Runtime binary for ${platform}/${arch}`);
  for (const f of ['models/model.int8.onnx', 'models/edge-vocab.json', 'resources/corpus.json.gz', 'resources/meanings.json.gz']) {
    if (!existsSync(join(resources, f))) throw new Error(`after-pack: missing bundled ${f}`);
  }
  console.log(`  • after-pack: kept ONNX Runtime ${platform}/${arch}; model and corpus bundled`);
};
