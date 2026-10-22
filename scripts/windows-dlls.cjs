// The DLLs a Windows binary (.exe, .dll, .node) needs, read from its PE import
// tables, and the Visual C++ runtime DLLs that ONNX Runtime needs but Windows
// does not include. Used by after-pack.cjs and check-windows-dlls.mjs.
const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

/** Visual C++ runtime DLLs: installed by the Visual C++ Redistributable, not by Windows. */
const VC_RUNTIME = /^(msvcp|msvcr|vcruntime|concrt|vccorlib|vcomp)\d+(_\w+)?\.dll$/i;

/** Names of the DLLs the binary imports, including delay-loaded ones. */
function imports(file) {
  const b = readFileSync(file);
  if (b.readUInt16LE(0) !== 0x5a4d) throw new Error(`${file}: not a Windows binary`);
  const pe = b.readUInt32LE(0x3c);
  if (b.readUInt32LE(pe) !== 0x4550) throw new Error(`${file}: no PE header`);
  const sections = b.readUInt16LE(pe + 6);
  const opt = pe + 24;
  const pe32plus = b.readUInt16LE(opt) === 0x20b;
  const imageBase = pe32plus ? Number(b.readBigUInt64LE(opt + 24)) : b.readUInt32LE(opt + 28);
  const dirs = opt + (pe32plus ? 112 : 96);
  const dirCount = b.readUInt32LE(opt + (pe32plus ? 108 : 92));
  const table = pe + 24 + b.readUInt16LE(pe + 20);
  const offset = (rva) => {
    for (let i = 0; i < sections; i++) {
      const s = table + i * 40;
      const va = b.readUInt32LE(s + 12);
      const size = Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16));
      if (rva >= va && rva < va + size) return rva - va + b.readUInt32LE(s + 20);
    }
    throw new Error(`${file}: address ${rva} is in no section`);
  };
  const name = (rva) => {
    const at = offset(rva);
    return b.toString('latin1', at, b.indexOf(0, at));
  };
  const out = [];
  // Data directory 1: import descriptors (20 bytes, name at +12).
  if (dirCount > 1 && b.readUInt32LE(dirs + 8)) {
    for (let d = offset(b.readUInt32LE(dirs + 8)); b.readUInt32LE(d + 12); d += 20) out.push(name(b.readUInt32LE(d + 12)));
  }
  // Data directory 13: delay-load descriptors (32 bytes, name at +4; an
  // address rather than an offset when attribute bit 0 is clear).
  if (dirCount > 13 && b.readUInt32LE(dirs + 13 * 8)) {
    for (let d = offset(b.readUInt32LE(dirs + 13 * 8)); b.readUInt32LE(d + 4); d += 32) {
      const n = b.readUInt32LE(d + 4);
      out.push(name(b.readUInt32LE(d) & 1 ? n : n - imageBase));
    }
  }
  return out;
}

/**
 * The folder with the Visual C++ runtime DLLs to ship (Visual Studio's
 * redistributable folder, VC\Redist\MSVC\<version>\<arch>\Microsoft.VC*.CRT),
 * or VC_REDIST_DIR when set.
 */
function vcRedistDir(arch) {
  if (process.env.VC_REDIST_DIR) return process.env.VC_REDIST_DIR;
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!existsSync(vswhere)) return null;
  const installs = execFileSync(vswhere, ['-products', '*', '-property', 'installationPath'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const newestFirst = (a, b) => b.localeCompare(a, undefined, { numeric: true });
  for (const vs of installs) {
    const msvc = join(vs, 'VC', 'Redist', 'MSVC');
    if (!existsSync(msvc)) continue;
    for (const version of readdirSync(msvc).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(newestFirst)) {
      const dir = join(msvc, version, arch);
      const crt = existsSync(dir) && readdirSync(dir).filter((d) => /^Microsoft\.VC\d+\.CRT$/i.test(d)).sort(newestFirst)[0];
      if (crt) return join(dir, crt);
    }
  }
  return null;
}

module.exports = { VC_RUNTIME, imports, vcRedistDir };
