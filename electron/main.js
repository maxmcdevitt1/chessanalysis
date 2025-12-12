// inprogress/electron/main.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const coach = require('./coachBridge');
const settingsStore = require('./settingsStore');

let mainWindow = null;
let engine = null;
let engineReadyPromise = null;
let engineIdleTimer = null;

const ENGINE_IDLE_MS = Number(process.env.ENGINE_IDLE_MS || 90000);
const bootSettings = settingsStore.loadSettings();

if (bootSettings.disableGpu) {
  app.commandLine.appendSwitch('disable-gpu');
}

const isDev = !app.isPackaged;
function resolveIcon() {
  // Try packaged resource paths first, then dev paths.
  const platformIcon = process.platform === 'win32'
    ? 'icon.ico'
    : (process.platform === 'darwin' ? 'icon.icns' : 'icon.png');
  const candidates = [
    // packaged
    path.join(process.resourcesPath || '', 'build', platformIcon),
    path.join(process.resourcesPath || '', 'assets', 'icon.png'),
    // dev (when running with npm run dev)
    path.join(__dirname, '..', 'build', platformIcon),
    path.join(__dirname, '..', 'assets', 'icon.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log('[icon] using', p);
        return p;
      }
    } catch {}
  }
  console.warn('[icon] none found in', candidates);
  return undefined; // Electron will use default icon
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
  const envPath = process.env.STOCKFISH_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const baseBin = app.isPackaged
    ? path.join(process.resourcesPath || '', 'bin')
    : path.join(__dirname, 'bin');
  const platform = process.platform;

  const names =
    platform === 'win32'
      ? ['stockfish.exe', 'stockfish-windows.exe']
      : platform === 'darwin'
        ? ['stockfish-mac', 'stockfish', 'stockfish-avx2']
        : ['stockfish', 'stockfish-avx2'];

  const resourceDirs = new Set(['']);
  if (platform) resourceDirs.add(platform);
  if (platform === 'darwin') resourceDirs.add('mac');
  if (platform === 'linux') resourceDirs.add('linux');
  if (platform === 'win32') resourceDirs.add('win');

  const resourceCandidates = [];
  for (const dir of resourceDirs) {
    for (const name of names) {
      resourceCandidates.push(dir ? path.join(baseBin, dir, name) : path.join(baseBin, name));
    }
  }

  const systemCandidates = (() => {
    if (platform === 'darwin') {
      return [
        '/opt/homebrew/bin/stockfish',
        '/usr/local/bin/stockfish',
        '/usr/bin/stockfish',
        '/opt/local/bin/stockfish',
      ];
    }
    if (platform === 'linux') {
      return [
        '/usr/games/stockfish',
        '/usr/local/bin/stockfish',
        '/usr/bin/stockfish',
      ];
    }
    if (platform === 'win32') {
      const pf = process.env.ProgramFiles || '';
      const pf86 = process.env['ProgramFiles(x86)'] || '';
      const local = process.env.LOCALAPPDATA || '';
      return [
        pf ? path.join(pf, 'Stockfish', 'stockfish.exe') : null,
        pf86 ? path.join(pf86, 'Stockfish', 'stockfish.exe') : null,
        local ? path.join(local, 'Programs', 'Stockfish', 'stockfish.exe') : null,
      ];
    }
    return [];
  })().filter(Boolean);

  const candidates = [...resourceCandidates, ...systemCandidates];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        console.log('[engine] using Stockfish at', candidate);
        return candidate;
      }
    } catch {}
  }

  console.warn('[engine] falling back to PATH lookup for Stockfish');
  console.warn('[engine] checked locations:', candidates);
  return 'stockfish';
}

function touchEngineTimer() {
  if (engineIdleTimer) {
    try { clearTimeout(engineIdleTimer); } catch {}
    engineIdleTimer = null;
  }
  if (!engine) return;
  if (!Number.isFinite(ENGINE_IDLE_MS) || ENGINE_IDLE_MS <= 0) return;
  engineIdleTimer = setTimeout(() => {
    console.log('[engine] idle timeout reached; shutting down Stockfish');
    stopEngine('idle').catch(() => {});
  }, ENGINE_IDLE_MS);
}

async function stopEngine(reason = '') {
  if (engineIdleTimer) {
    try { clearTimeout(engineIdleTimer); } catch {}
    engineIdleTimer = null;
  }
  if (!engine) return;
  console.log('[engine] stopping', reason ? `(${reason})` : '');
  try { await engine.quit(); } catch {}
  engine = null;
}

// Initialize the engine lazily and reuse a single instance.
async function ensureEngine() {
  if (engine) {
    touchEngineTimer();
    return engine;
  }
  if (!engineReadyPromise) {
    engineReadyPromise = (async () => {
      try {
        const { createEngine } = require('./engine/uci'); // lazy require
        const settings = settingsStore.getSettings();
        engine = await createEngine({
          bin: resolveStockfishPath(),
          threads: settings.engineThreads,
          hash: settings.engineHashMb,
        });
        const caps = await engine.getCapabilities();
        console.log('[engine caps]', caps);
        touchEngineTimer();
        return engine;
      } catch (e) {
        console.error('[engine init failed]', e);
        engine = null;
        return null;
      } finally {
        engineReadyPromise = null;
      }
    })();
  }
  await engineReadyPromise;
  return engine;
}

async function withEngine(fn) {
  const eng = await ensureEngine();
  if (!eng) return null;
  touchEngineTimer();
  try {
    return await fn(eng);
  } finally {
    touchEngineTimer();
  }
}

// ---------- IPC: register BEFORE loading UI; handlers lazy-init engine ----------
let ipcWired = false;
function registerIpc() {
  if (ipcWired) return;
  ipcWired = true;
  console.log('[ipc] registering handlers');

  ipcMain.handle('engine:analyzeFen', async (_evt, payload) => {
    const res = await withEngine((eng) => eng.analyzeFen(payload));
    return res || { error: 'engine-not-ready' };
  });

  ipcMain.handle('engine:reviewPgn', async (_evt, payload) => {
    const res = await withEngine((eng) => eng.reviewPgn(payload));
    return res || { error: 'engine-not-ready' };
  });

  ipcMain.handle('engine:identifyOpening', async (_evt, fen) => {
    const res = await withEngine((eng) => eng.identifyOpening(fen));
    return res || null;
  });

  ipcMain.handle('engine:getCapabilities', async () => {
    const res = await withEngine((eng) => eng.getCapabilities());
    return res || { error: 'engine-not-ready' };
  });

  ipcMain.handle('engine:setStrength', async (_evt, { elo }) => {
    const res = await withEngine((eng) => eng.applyStrength(elo));
    return res || { error: 'engine-not-ready' };
  });

  ipcMain.handle('engine:reviewFast', async (_evt, payload) => {
    const eng = await ensureEngine();
    if (!eng) return { error: 'engine-not-ready' };
    touchEngineTimer();
    const { fens = [], opts = {} } = payload || {};
    try {
      const res = await eng.reviewPositionsFast(fens, opts);
      touchEngineTimer();
      return res;
    } catch (e) {
      console.error('[ipc] engine:reviewFast error', e);
      return [];
    } finally {
      touchEngineTimer();
    }
  });

  ipcMain.handle('engine:ping', async () => 'pong');
  ipcMain.handle('engine:panic', async () => {
    await stopEngine('panic');
    return { ok: true };
  });

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

  ipcMain.handle('settings:get', async () => settingsStore.getSettings());
  ipcMain.handle('settings:update', async (_evt, patch = {}) => {
    const prev = settingsStore.getSettings();
    const next = settingsStore.updateSettings(patch);
    const engineKnobsChanged =
      (patch.engineThreads != null && patch.engineThreads !== prev.engineThreads) ||
      (patch.engineHashMb != null && patch.engineHashMb !== prev.engineHashMb);
    if (engineKnobsChanged) {
      await stopEngine('settings-update');
    }
    return next;
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
  const iconResolved = resolveIcon(); // path or undefined
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconResolved,
    show: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  wireWebContentsLogging(mainWindow);

  // Register IPC now so renderer can call immediately
  registerIpc();

  // Load UI (waits for Vite or falls back to file)
  await loadUI(mainWindow);

  // Init engine in background; handlers will lazy-init on demand as well
  setImmediate(() => ensureEngine());

  mainWindow.on('closed', () => {
    stopEngine('window-closed').catch(() => {});
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
app.on('before-quit', () => { stopEngine('app-quit').catch(() => {}); });
