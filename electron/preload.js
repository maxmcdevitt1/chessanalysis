const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('engine', {
  analyzeFen: (fen, opts = {}) => ipcRenderer.invoke('engine:analyzeFen', { fen, ...opts }),
  reviewPgn: (pgn, opts = {}) => ipcRenderer.invoke('engine:reviewPgn', { pgn, ...opts }),
});
