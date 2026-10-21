/**
 * Preload: forwards the engine MessagePort into the page. Ports cannot cross
 * contextBridge, so it is re-posted with window.postMessage.
 */
import { contextBridge, ipcRenderer } from 'electron';

ipcRenderer.on('engine-port', (e) => {
  window.postMessage('engine-port', '*', e.ports);
});

// Development smoke test only (see main.ts): audio streamed from a file.
ipcRenderer.on('smoke-mode', (_e, mode: string) => {
  window.postMessage({ smokeMode: mode }, '*');
});
ipcRenderer.on('smoke-audio', (_e, samples: Float32Array) => {
  window.postMessage({ smokeAudio: samples }, '*');
});

// Presentation controls (projector, overlay, phones). Only these calls are
// exposed; the page never gets ipcRenderer itself.
contextBridge.exposeInMainWorld('presentation', {
  init: () => ipcRenderer.invoke('present:init'),
  micAccess: () => ipcRenderer.invoke('mic:access'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('present:settings', patch),
  control: (action: string) => ipcRenderer.invoke('present:control', action),
  setProjector: (p: unknown) => ipcRenderer.invoke('present:projector', p),
  setLan: (lan: boolean) => ipcRenderer.invoke('present:lan', lan),
  copy: (text: string) => ipcRenderer.invoke('present:copy', text),
  open: (url: string) => ipcRenderer.invoke('present:open', url),
  onView: (fn: (v: unknown) => void) => ipcRenderer.on('present:view', (_e, v) => fn(v)),
  onStatus: (fn: (s: unknown) => void) => ipcRenderer.on('present:status', (_e, s) => fn(s)),
});

// New releases: check, download, install, or open the release page.
contextBridge.exposeInMainWorld('updates', {
  status: () => ipcRenderer.invoke('updates:status'),
  check: (manual: boolean) => ipcRenderer.invoke('updates:check', manual),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  open: () => ipcRenderer.invoke('updates:open'),
  setPrefs: (patch: unknown) => ipcRenderer.invoke('updates:prefs', patch),
  onStatus: (fn: (s: unknown) => void) => ipcRenderer.on('updates:status', (_e, s) => fn(s)),
});
