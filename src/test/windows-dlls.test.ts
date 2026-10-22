import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

const { VC_RUNTIME, imports } = require('../../scripts/windows-dlls.cjs') as {
  VC_RUNTIME: RegExp;
  imports: (file: string) => string[];
};

// The Windows ONNX Runtime that the installers ship (onnxruntime-node includes every platform's binaries).
const ORT = join(__dirname, '..', '..', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64');

test('the Windows ONNX Runtime binding imports ONNX Runtime and the Visual C++ runtime', () => {
  const binding = imports(join(ORT, 'onnxruntime_binding.node'));
  assert.ok(binding.includes('onnxruntime.dll'), binding.join(' '));
  // NODE.EXE is delay-loaded, so delay imports are read too.
  assert.ok(binding.includes('NODE.EXE'), binding.join(' '));
  const runtime = [...binding, ...imports(join(ORT, 'onnxruntime.dll'))].filter((d) => VC_RUNTIME.test(d)).map((d) => d.toLowerCase());
  assert.deepEqual([...new Set(runtime)].sort(), ['msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']);
});

test('only Visual C++ runtime DLLs count as the Visual C++ runtime', () => {
  for (const d of ['MSVCP140.dll', 'msvcp140_1.dll', 'VCRUNTIME140_1.dll', 'concrt140.dll', 'vcomp140.dll', 'msvcr120.dll']) assert.ok(VC_RUNTIME.test(d), d);
  for (const d of ['KERNEL32.dll', 'ucrtbase.dll', 'api-ms-win-crt-heap-l1-1-0.dll', 'onnxruntime.dll', 'msvcrt.dll']) assert.ok(!VC_RUNTIME.test(d), d);
});
