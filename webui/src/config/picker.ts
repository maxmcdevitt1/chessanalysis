import type { Color } from '../types/chess';

export type BandId = 'beginner' | 'developing' | 'intermediate' | 'advanced' | 'expert';

export type BookConfig = {
  maxPlies: number;
  topLines: number;
  exitEarly?: { minPlies: number; probability: number };
};

export type BandConfig = {
  id: BandId;
  label: string;
  eloRange: [number, number];
  book: BookConfig;
};

export type PickerConfig = {
  threads: number;
  hashMb: number;
  ponder: boolean;
  defaultBookMaxPlies: number;
  globalTimeCapMs: number;
  bands: Record<BandId, BandConfig>;
};

export const DEFAULT_PICKER_CONFIG: PickerConfig = {
  threads: 2,
  hashMb: 256,
  ponder: false,
  defaultBookMaxPlies: 12,
  globalTimeCapMs: 1500,
  bands: {
    beginner: {
      id: 'beginner',
      label: 'Beginner',
      eloRange: [400, 800],
      book: { maxPlies: 4, topLines: 2, exitEarly: { minPlies: 1, probability: 0.75 } },
    },
    developing: {
      id: 'developing',
      label: 'Developing',
      eloRange: [801, 1000],
      book: { maxPlies: 4, topLines: 2, exitEarly: { minPlies: 2, probability: 0.55 } },
    },
    intermediate: {
      id: 'intermediate',
      label: 'Club',
      eloRange: [1001, 1400],
      book: { maxPlies: 10, topLines: 3, exitEarly: { minPlies: 4, probability: 0.35 } },
    },
    advanced: {
      id: 'advanced',
      label: 'Advanced',
      eloRange: [1401, 1800],
      book: { maxPlies: 12, topLines: 4, exitEarly: { minPlies: 6, probability: 0.22 } },
    },
    expert: {
      id: 'expert',
      label: 'Expert',
      eloRange: [1801, 2600],
      book: { maxPlies: 14, topLines: 6, exitEarly: { minPlies: 8, probability: 0.15 } },
    },
  },
};

export function clampElo(elo: number): number {
  if (!Number.isFinite(elo)) return 400;
  return Math.max(400, Math.min(2500, Math.round(elo)));
}

export function bandFromElo(elo: number, cfg: PickerConfig = DEFAULT_PICKER_CONFIG): BandConfig {
  const e = clampElo(elo);
  const found = Object.values(cfg.bands).find((band) => e >= band.eloRange[0] && e <= band.eloRange[1]);
  return found ?? cfg.bands.advanced;
}

export type SideAwareEval = { cp: number; pov: Color };
