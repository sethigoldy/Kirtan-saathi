// Checks that the native modules in a packaged Windows app load on a PC that
// has only Windows: every DLL they import must be beside them or part of
// Windows. The Visual C++ runtime counts as missing even when this machine has
// it, because the Visual C++ Redistributable is not part of Windows.
//   node scripts/check-windows-dlls.mjs release/win-unpacked
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

const { VC_RUNTIME, imports } = createRequire(import.meta.url)('./windows-dlls.cjs');

const app = process.argv[2];
const unpacked = app && join(app, 'resources', 'app.asar.unpacked');
if (!unpacked || !existsSync(unpacked)) {
  console.error(`usage: node scripts/check-windows-dlls.mjs <packaged app folder> (no ${unpacked})`);
  process.exit(1);
}
const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const inFolder = (dir, dll) => readdirSync(dir).some((f) => f.toLowerCase() === dll.toLowerCase());

function* binaries(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* binaries(p);
    else if (/\.(dll|node|exe)$/i.test(e.name)) yield p;
  }
}

const problems = [];
let checked = 0;
for (const file of binaries(unpacked)) {
  checked++;
  const local = [];
  for (const dll of imports(file)) {
    // API sets resolve inside Windows; node-gyp's delay-load hook maps NODE.EXE to the app itself.
    if (/^(api|ext)-ms-/i.test(dll) || /^node\.exe$/i.test(dll)) continue;
    if (inFolder(dirname(file), dll)) local.push(dll);
    else if (VC_RUNTIME.test(dll)) problems.push(`${relative(app, file)} needs ${dll} (Visual C++ runtime, not part of Windows) beside it`);
    else if (!existsSync(join(system32, dll))) problems.push(`${relative(app, file)} needs ${dll}, which is neither beside it nor part of Windows`);
  }
  console.log(`${relative(app, file)}: ${local.length ? `loads ${local.join(', ')} from its folder` : 'needs only Windows'}`);
}
if (!checked) problems.push(`no native modules under ${unpacked}`);
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log(`${checked} native modules load with Windows alone`);
