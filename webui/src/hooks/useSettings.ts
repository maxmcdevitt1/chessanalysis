import { useCallback, useEffect, useState } from 'react';
import { getNumber, getString } from '../persist';
import { DEFAULT_STRENGTH_BAND_ID, STRENGTH_BANDS, type StrengthBandId } from '../strengthBands';

const SETTINGS_STORAGE_KEY = 'appSettings.v2';
const WRITE_DEBOUNCE_MS = 200;
const LEGACY_KEYS = {
  band: 'engineStrengthBand',
  elo: 'engineElo',
  autoReply: 'autoReplyEnabled',
  showEvalGraph: 'showEvalGraph',
} as const;

export type Settings = {
  band: StrengthBandId;
  customElo: number;
  autoReply: boolean;
  showEvalGraph: boolean;
  engineThreads: number;
  engineHashMb: number;
  liveMultipv: number;
  disableGpu: boolean;
};

const platform = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const PLATFORM_DEFAULT_THREADS =
  /Windows/i.test(platform) ? 2 : /Linux/i.test(platform) ? 1 : 2;

const DEFAULT_SETTINGS: Settings = {
  band: DEFAULT_STRENGTH_BAND_ID,
  customElo: 1500,
  autoReply: false,
  showEvalGraph: true,
  engineThreads: PLATFORM_DEFAULT_THREADS,
  engineHashMb: 64,
  liveMultipv: 1,
  disableGpu: false,
};

function isStrengthBandId(value: unknown): value is StrengthBandId {
  return typeof value === 'string' && STRENGTH_BANDS.some((band) => band.id === value);
}

function clampElo(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.customElo;
  return Math.max(400, Math.min(2800, Math.round(num)));
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return fallback;
}

function clampThreads(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.engineThreads;
  return Math.max(1, Math.min(4, Math.round(num)));
}

function clampHash(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.engineHashMb;
  return Math.max(64, Math.min(256, Math.round(num)));
}

function clampMultipv(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.liveMultipv;
  return Math.max(1, Math.min(2, Math.round(num)));
}

function normalizeSettings(value: Partial<Record<keyof Settings, unknown>>): Settings {
  return {
    band: isStrengthBandId(value.band) ? value.band : DEFAULT_SETTINGS.band,
    customElo: clampElo(value.customElo ?? DEFAULT_SETTINGS.customElo),
    autoReply: coerceBoolean(value.autoReply, DEFAULT_SETTINGS.autoReply),
    showEvalGraph: coerceBoolean(value.showEvalGraph, DEFAULT_SETTINGS.showEvalGraph),
    engineThreads: clampThreads(value.engineThreads ?? DEFAULT_SETTINGS.engineThreads),
    engineHashMb: clampHash(value.engineHashMb ?? DEFAULT_SETTINGS.engineHashMb),
    liveMultipv: clampMultipv(value.liveMultipv ?? DEFAULT_SETTINGS.liveMultipv),
    disableGpu: coerceBoolean(value.disableGpu, DEFAULT_SETTINGS.disableGpu),
  };
}

function readStoredSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? (parsed as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

function readLegacySettings(): Partial<Settings> {
  const out: Partial<Settings> = {};
  const legacyBand = getString(LEGACY_KEYS.band, '') as StrengthBandId;
  if (isStrengthBandId(legacyBand)) out.band = legacyBand;
  const legacyElo = getNumber(LEGACY_KEYS.elo, NaN);
  if (Number.isFinite(legacyElo)) out.customElo = legacyElo;
  const legacyAuto = getNumber(LEGACY_KEYS.autoReply, NaN);
  if (legacyAuto === 0 || legacyAuto === 1) out.autoReply = legacyAuto === 1;
  const legacyEval = getNumber(LEGACY_KEYS.showEvalGraph, NaN);
  if (legacyEval === 0 || legacyEval === 1) out.showEvalGraph = legacyEval === 1;
  return out;
}

function loadSettings(): Settings {
  const stored = readStoredSettings();
  if (Object.keys(stored).length > 0) {
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
  }
  const legacy = readLegacySettings();
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...legacy });
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (bootstrapped) return;
    const api = (typeof window !== 'undefined' && (window as any).appSettings) || null;
    if (!api?.get) {
      setBootstrapped(true);
      return;
    }
    let cancelled = false;
    api.get()
      .then((remote: Partial<Settings>) => {
        if (cancelled || !remote) return;
        setSettings((prev) => normalizeSettings({ ...prev, ...remote }));
      })
      .finally(() => {
        if (!cancelled) setBootstrapped(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrapped]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // ignore quota/storage errors
      }
    }, WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => normalizeSettings({ ...prev, ...patch }));
    const api = (typeof window !== 'undefined' && (window as any).appSettings) || null;
    if (api?.update) {
      api.update(patch).catch(() => {});
    }
  }, []);

  return { settings, update };
}
