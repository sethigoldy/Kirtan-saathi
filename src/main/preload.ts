/**
 * Preload: forwards the engine MessagePort into the page. Ports cannot cross
 * contextBridge, so it is re-posted with window.postMessage.
 */
import { ipcRenderer } from 'electron';

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
