// electron-builder afterPack hook: keep only the ONNX Runtime binaries for the
// platform and CPU being packaged and, on Windows, put the Visual C++ runtime
// they need beside them. Runs before signing.
const { copyFileSync, existsSync, readdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { VC_RUNTIME, imports, vcRedistDir } = require('./windows-dlls.cjs');

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
  if (platform === 'win32') bundleVcRuntime(kept, arch);
  for (const f of ['models/model.int8.onnx', 'models/edge-vocab.json', 'resources/corpus.json.gz', 'resources/meanings.json.gz']) {
    if (!existsSync(join(resources, f))) throw new Error(`after-pack: missing bundled ${f}`);
  }
  console.log(`  • after-pack: kept ONNX Runtime ${platform}/${arch}; model and corpus bundled`);
};

// ONNX Runtime links against the Visual C++ runtime, which Windows does not
// include: on a PC without the Visual C++ Redistributable, loading it fails with
// "The specified module could not be found". Windows looks for these DLLs in
// the binding's folder first, so copies there work for every install, the
// Microsoft Store package included.
function bundleVcRuntime(dir, arch) {
  const needed = new Set();
  for (const f of readdirSync(dir).filter((f) => /\.(dll|node)$/i.test(f))) {
    for (const dll of imports(join(dir, f))) if (VC_RUNTIME.test(dll)) needed.add(dll.toLowerCase());
  }
  if (!needed.size) return;
  const from = vcRedistDir(arch);
  if (!from) {
    throw new Error(
      'after-pack: the Visual C++ runtime to ship with ONNX Runtime was not found. Install Visual Studio (or its Build Tools) with the C++ workload, or set VC_REDIST_DIR to a folder with ' +
        [...needed].join(', '),
    );
  }
  const available = new Map(readdirSync(from).map((f) => [f.toLowerCase(), f]));
  for (const dll of needed) {
    if (!available.has(dll)) throw new Error(`after-pack: ${dll} is not in ${from}`);
    copyFileSync(join(from, available.get(dll)), join(dir, dll));
  }
  console.log(`  • after-pack: bundled the Visual C++ runtime (${[...needed].join(', ')}) from ${from}`);
}
