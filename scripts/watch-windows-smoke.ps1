# Waits for an installed app's smoke run (at most 3 minutes) and checks where
# the process running ONNX Runtime took the Visual C++ runtime from. It must be
# the app's own copy: Windows does not include the runtime. This machine has the
# Visual C++ Redistributable, so a copy from System32 would hide an app that
# cannot start listening on a PC without it.
#   scripts/watch-windows-smoke.ps1 -Process <the started app> -AppDir <its install folder>
param(
  [Parameter(Mandatory)] [System.Diagnostics.Process] $Process,
  [Parameter(Mandatory)] [string] $AppDir
)
$deadline = (Get-Date).AddMinutes(3)
$runtime = @{}
while (-not $Process.HasExited) {
  if ((Get-Date) -gt $deadline) { $Process.Kill(); throw 'app did not finish within 3 minutes' }
  foreach ($q in Get-Process -Name 'Kirtan Saathi' -ErrorAction SilentlyContinue) {
    try { $modules = $q.Modules } catch { continue }
    if (-not ($modules | Where-Object ModuleName -eq 'onnxruntime_binding.node')) { continue }
    $modules | Where-Object ModuleName -match '^(msvcp|msvcr|vcruntime)\d+' | ForEach-Object { $runtime[$_.FileName] = $true }
  }
  Start-Sleep -Milliseconds 500
}
if (-not $runtime.Count) { throw 'ONNX Runtime was never seen loaded with the Visual C++ runtime' }
$root = $AppDir.TrimEnd('\') + '\'
foreach ($path in $runtime.Keys) {
  $file = $path -replace '^\\\\\?\\', ''
  if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "ONNX Runtime loaded $file, which is not part of the app: a PC without the Visual C++ Redistributable cannot start listening"
  }
  Write-Host "ONNX Runtime loaded the app's own $file"
}
