// inprogress/electron/main.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron'); // <-- nativeImage added
const coach = require('./coachBridge');

let mainWindow = null;
let engine = null;

const isDev = !app.isPackaged;
function getAssetPath(...p) {
  // In dev, resolve relative to electron/.. ; in prod use resourcesPath
  return isDev
    ? path.join(__dirname, '..', 'assets', ...p)
    : path.join(process.resourcesPath, 'assets', ...p);
}

function getPlatformIconPath() {
  if (process.platform === 'win32') return getAssetPath('icon.ico');
  if (process.platform === 'darwin') return getAssetPath('icon.icns');
  return getAssetPath('icon.png'); // linux/freebsd
}

// Prefer NativeImage (Linux can be picky); log what we load
function resolveIconOrWarn() {
  const p = getPlatformIconPath();
  const exists = fs.existsSync(p);
  console.log('[icon] platform=', process.platform, 'dev=', isDev, 'path=', p, 'exists=', exists);
  if (!exists) {
    console.warn('[icon] Missing icon file at', p, '→ using default Electron icon');
    return undefined;
  }
  const img = nativeImage.createFromPath(p);
  const sz = img.getSize && img.getSize();
  const ok = img && !img.isEmpty();
  console.log('[icon] nativeImage empty=', !ok, 'size=', sz ? `${sz.width}x${sz.height}` : '0x0');
  // Some WMs prefer a raw path, others like NativeImage; we pass NativeImage first.
  return ok ? img : p;
}

// ---------- dev-server helpers ----------
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function ping(url, timeout = 1200){
  const lib = url.startsWith('https') ? https : http;
  return new Promise((res, rej)=>{
    const req = lib.get(url, resp => { resp.resume(); res(resp.statusCode || 0); });
    req.on('error', rej);
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
  });
}
async function waitForDevUrl(urls, totalMs = 25000){
  const end = Date.now() + totalMs;
  let lastErr = new Error('unknown');
  while (Date.now() < end){
    for (const u of urls){
      try {
        const code = await ping(u);
        if ((code+'').startsWith('2') || (code+'').startsWith('3')) return u;
        lastErr = new Error('HTTP '+code+' from '+u);
      } catch (e) { lastErr = e; }
    }
    await wait(300);
  }
  throw lastErr;
}

// ---------- logging ----------
function wireWebContentsLogging(win) {
  const wc = win.webContents;
  wc.on('did-fail-load', (_e, ec, desc, url) => {
    console.error('[did-fail-load]', ec, desc, url);
    dialog.showErrorBox('Load failed', `${desc}\nURL: ${url}\nCode: ${ec}`);
  });
  wc.on('did-fail-provisional-load', (_e, ec, desc, url) => {
    console.error('[did-fail-provisional-load]', ec, desc, url);
  });
  wc.on('render-process-gone', (_e, details) => console.error('[render-process-gone]', details));
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    console.log('[renderer]', { level, message, line, sourceId });
  });
}

// ---------- engine path + ready gate ----------
function resolveStockfishPath() {
  if (process.env.STOCKFISH_PATH && fs.existsSync(process.env.STOCKFISH_PATH)) return process.env.STOCKFISH_PATH;
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'bin');
  const linux = path.join(base, 'linux', 'stockfish');
  if (fs.existsSync(linux)) return linux;
  return 'stockfish';
}

// A promise all IPC handlers await before touching the engine
let resolveEngineReady;
const engineReady = new Promise(res => { resolveEngineReady = res; });

// Initialize the engine AFTER UI is up; resolve the gate either way
async function initEngine() {
  try {
    const { createEngine } = require('./engine/uci'); // lazy require
    engine = await createEngine({
      bin: resolveStockfishPath(),
      threads: process.env.ENGINE_THREADS ? Number(process.env.ENGINE_THREADS) : undefined,
      hash: process.env.ENGINE_HASH_MB ? Number(process.env.ENGINE_HASH_MB) : 1024,
    });
    const caps = await engine.getCapabilities();
    console.log('[engine caps]', caps);
    await engine.applyStrength(2000);
    resolveEngineReady(true);
  } catch (e) {
    console.error('[engine init failed]', e);
    engine = null;
    resolveEngineReady(false);
  }
}

// ---------- IPC: register BEFORE loading UI; await engineReady inside handlers ----------
let ipcWired = false;
function registerIpc() {
  if (ipcWired) return;
  ipcWired = true;
  console.log('[ipc] registering handlers');

  ipcMain.handle('engine:analyzeFen', async (_evt, payload) => {
    await engineReady;
    if (!engine) return { error: 'engine-not-ready' };
    return engine.analyzeFen(payload);
  });

  ipcMain.handle('engine:reviewPgn', async (_evt, payload) => {
    await engineReady;
    if (!engine) return { error: 'engine-not-ready' };
    return engine.reviewPgn(payload);
  });

  ipcMain.handle('engine:getCapabilities', async () => {
    await engineReady;
    if (!engine) return { error: 'engine-not-ready' };
    return engine.getCapabilities();
  });

  ipcMain.handle('engine:setStrength', async (_evt, { elo }) => {
    await engineReady;
    if (!engine) return { error: 'engine-not-ready' };
    return engine.applyStrength(elo);
  });

  ipcMain.handle('engine:moveWeak', async (_evt, payload) => {
    await engineReady?.catch?.(()=>{});
    try {
      if (!engine) return { error: 'engine-not-ready' };
      const { fen, movetimeMs = 300, multiPv = 1 } = payload || {};
      console.log('[ipc] moveWeak -> calling engine', {
        movetimeMs, multiPv, fen: String(fen).slice(0, 40)
      });
      const out = await engine.moveWeak({ fen, movetimeMs, multiPv });
      console.log('[ipc] moveWeak <- result', out?.bestMove);
      return out;
    } catch (e) {
      console.error('[ipc] engine:moveWeak error', e);
      throw e;
    }
  });

  ipcMain.handle('engine:reviewFast', async (_evt, payload) => {
    await engineReady?.catch?.(()=>{});
    if (!engine) return { error: 'engine-not-ready' };
    const { fens = [], opts = {} } = payload || {};
    try {
      return await engine.reviewPositionsFast(fens, opts);
    } catch (e) {
      console.error('[ipc] engine:reviewFast error', e);
      return [];
    }
  });

  ipcMain.handle('engine:ping', async () => 'pong');

  // Save file (PGN / JSON)
  ipcMain.handle('export:save', async (_evt, payload) => {
    try {
      const { defaultPath, filters, content } = payload || {};
      const res = await dialog.showSaveDialog({
        title: 'Export game',
        defaultPath: defaultPath || 'game.pgn',
        filters: filters && Array.isArray(filters) ? filters : [
          { name: 'PGN', extensions: ['pgn'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (res.canceled) return { ok: false, canceled: true };
      fs.writeFileSync(res.filePath, content ?? '', 'utf8');
      return { ok: true, path: res.filePath };
    } catch (e) {
      console.error('[ipc] export:save error', e);
      return { ok: false, error: String(e?.message || e) };
    }
  });
}

// ---------- UI loader ----------
async function loadUI(win){
  const envUrl = process.env.ELECTRON_START_URL;
  const candidates = envUrl ? [envUrl] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const prodUrl = 'file://' + path.join(__dirname, '../webui/dist/index.html');

  try {
    console.log('[main] waiting for dev server', candidates);
    const target = await waitForDevUrl(candidates);
    console.log('[main] loading', target);
    await win.loadURL(target);
  } catch (e) {
    console.warn('[main] dev server unreachable; falling back:', e.message || e);
    await win.loadURL(prodUrl);
  }
  win.show();
}

// ---------- app bootstrap ----------
async function createWindow(){
   if (process.env.DEBUG_PROD === '1') {
  mainWindow.webContents.openDevTools({ mode: 'detach' });
}

  // Create + show window ASAP
  const iconResolved = resolveIconOrWarn(); // NativeImage or path or undefined
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconResolved,    // Win/Linux honor NativeImage; some WMs prefer path
    show: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // macOS dev: set dock icon explicitly (packaged apps use .icns from builder)
  if (process.platform === 'darwin' && isDev && iconResolved) {
    const img = nativeImage.isPrototypeOf(iconResolved) ? iconResolved : nativeImage.createFromPath(iconResolved);
    if (!img.isEmpty()) app.dock.setIcon(img);
    else console.warn('[icon] nativeImage empty for macOS dock');
  }

  wireWebContentsLogging(mainWindow);

  // Register IPC now so renderer can call immediately
  registerIpc();

  // Load UI (waits for Vite or falls back to file)
  await loadUI(mainWindow);

  // Init engine in background; handlers will `await engineReady`
  setImmediate(initEngine);

  mainWindow.on('closed', () => {
    if (engine) engine.quit().catch(()=>{});
    engine = null;
  });
}

if (process.platform === 'win32') {
  // Better taskbar grouping/notifications on Windows
  app.setAppUserModelId('com.maxmcdevitt.chessanalysis');
}
app.whenReady().then(() => {
  createWindow();
  try {
    // Idempotent in dev: coachBridge removes handlers before re-adding
    require('./coachBridge').registerCoachIpc();
    console.log('[coach] IPC registered');
  } catch (e) {
    console.error('[coach] register failed:', e);
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
