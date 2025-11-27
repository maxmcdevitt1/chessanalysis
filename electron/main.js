const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createEngine } = require('./engine/uci');

let mainWindow;
let engine;

function resolveStockfishPath() {
  // Priority: env override -> bundled -> system PATH
  if (process.env.STOCKFISH_PATH && fs.existsSync(process.env.STOCKFISH_PATH)) {
    return process.env.STOCKFISH_PATH;
  }
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'bin');
  const linux = path.join(base, 'linux', 'stockfish');
  if (fs.existsSync(linux)) return linux;
  return 'stockfish'; // hope system package exists
}

async function createWindow() {
  try {
    engine = await createEngine({
      bin: resolveStockfishPath(),
      threads: Math.max(1, Math.min(2, require('os').cpus().length - 1)),
      hash: 128
    });
  } catch (e) {
    console.error('[main] engine init failed:', e);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const isDev = !app.isPackaged;
  const devUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
  const prodIndex = path.join(__dirname, '..', 'webui', 'dist', 'index.html');

  if (isDev) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(prodIndex);

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  ipcMain.handle('engine:analyzeFen', async (_evt, payload) => {
    if (!engine) return { error: 'engine-not-ready' };
    return engine.analyzeFen(payload);
  });
  ipcMain.handle('engine:reviewPgn', async (_evt, payload) => {
    if (!engine) return { error: 'engine-not-ready' };
    return engine.reviewPgn(payload);
  });

  mainWindow.on('closed', () => {
    if (engine) engine.quit().catch(()=>{});
    engine = null;
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
