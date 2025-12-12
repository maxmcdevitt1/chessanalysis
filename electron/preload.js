// inprogress/electron/preload.js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Expose only if the key is not already defined on window */
function safeExpose(key, api) {
  try {
    if (Object.prototype.hasOwnProperty.call(window, key)) {
      console.warn(`[preload] '${key}' already exists on window; skipping expose`);
      return;
    }
    contextBridge.exposeInMainWorld(key, api);
  } catch (e) {
    console.error(`[preload] expose '${key}' failed:`, e);
  }
}

/* ----------------------------- Engine bridge ----------------------------- */

const engineApi = {
  analyzeFen: (fen, opts = {}) => ipcRenderer.invoke('engine:analyzeFen', { fen, ...opts }),
  reviewPgn:  (pgn, opts = {}) => ipcRenderer.invoke('engine:reviewPgn', { pgn, ...opts }),
  identifyOpening: (fen) => ipcRenderer.invoke('engine:identifyOpening', fen),
  getCapabilities: () => ipcRenderer.invoke('engine:getCapabilities'),
  setStrength: ({ elo }) => ipcRenderer.invoke('engine:setStrength', { elo }),
  reviewFast: (fens = [], opts = {}) => ipcRenderer.invoke('engine:reviewFast', { fens, opts }),
  ping: () => ipcRenderer.invoke('engine:ping'),
  panic: () => ipcRenderer.invoke('engine:panic'),
};

/* ------------------------------ Coach bridge ----------------------------- */

const coachApi = {
  generate: (inputs) => ipcRenderer.invoke('coach:generate', { inputs }),
};

/* ------------------------------- Expose APIs ------------------------------ */

safeExpose('engine', engineApi);
safeExpose('coach', coachApi);
safeExpose('appSettings', settingsApi);

// Merge/augment a global electron bridge with a safe invoke
try {
  const existing = (typeof window !== 'undefined' && (window).electron) || {};
  contextBridge.exposeInMainWorld('electron', {
    ...existing,
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  });
} catch (e) {
  console.error('[preload] expose electron.invoke failed:', e);
}
const settingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (patch) => ipcRenderer.invoke('settings:update', patch),
};
