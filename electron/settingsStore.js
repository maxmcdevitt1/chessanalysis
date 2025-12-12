const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const THREAD_RANGE = { min: 1, max: 4 };
const HASH_RANGE = { min: 64, max: 256 };
const MULTIPV_RANGE = { min: 1, max: 2 };

function getDefaults() {
  const isWindows = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  // Prefer extremely conservative defaults on Linux laptops.
  const threads = isWindows ? 2 : isLinux ? 1 : 2;
  return {
    engineThreads: clampInt(threads, THREAD_RANGE.min, THREAD_RANGE.max),
    engineHashMb: HASH_RANGE.min,
    liveMultipv: MULTIPV_RANGE.min,
    disableGpu: false,
  };
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizePatch(patch = {}) {
  const normalized = {};
  if (patch.engineThreads != null) {
    normalized.engineThreads = clampInt(
      Number(patch.engineThreads),
      THREAD_RANGE.min,
      THREAD_RANGE.max
    );
  }
  if (patch.engineHashMb != null) {
    normalized.engineHashMb = clampInt(
      Number(patch.engineHashMb),
      HASH_RANGE.min,
      HASH_RANGE.max
    );
  }
  if (patch.liveMultipv != null) {
    normalized.liveMultipv = clampInt(
      Number(patch.liveMultipv),
      MULTIPV_RANGE.min,
      MULTIPV_RANGE.max
    );
  }
  if (patch.disableGpu != null) {
    normalized.disableGpu = Boolean(patch.disableGpu);
  }
  return normalized;
}

function getStorePath() {
  const dir = app.getPath('userData');
  return path.join(dir, 'settings.json');
}

function readFileSafe(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    return null;
  }
}

let cachedSettings = null;

function loadSettings() {
  if (cachedSettings) return cachedSettings;
  const defaults = getDefaults();
  const file = getStorePath();
  const disk = readFileSafe(file);
  const normalizedDisk = disk ? normalizePatch(disk) : {};
  cachedSettings = {
    ...defaults,
    ...normalizedDisk,
  };
  saveSettings(cachedSettings);
  return cachedSettings;
}

function saveSettings(settings) {
  try {
    const file = getStorePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('[settingsStore] failed to write settings:', err);
  }
}

function getSettings() {
  return { ...loadSettings() };
}

function updateSettings(patch = {}) {
  const normalized = normalizePatch(patch);
  const current = loadSettings();
  cachedSettings = { ...current, ...normalized };
  saveSettings(cachedSettings);
  return getSettings();
}

module.exports = {
  loadSettings,
  getSettings,
  updateSettings,
};
