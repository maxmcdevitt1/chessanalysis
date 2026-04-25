import type { Color } from '../types/chess';

export type BandId = 'beginner' | 'developing' | 'intermediate' | 'advanced' | 'expert';

export type ProgressiveWidening = {
  /** Additional centipawns to relax max drop before retrying. */
  dropStepsCp: number[];
  /** Additional MultiPV lines to request if no candidates survive. */
  multiPvIncrements: number[];
  /** Extra milliseconds to grant when widening search. */
  timeExtensionsMs: number[];
};

export type BookConfig = {
  maxPlies: number;
  topLines: number;
  exitEarly?: { minPlies: number; probability: number };
};

export type BandConfig = {
  id: BandId;
  label: string;
  eloRange: [number, number];
  movetimeFloorMs: number;
  multipvCap: number;
  baseMaxDrop: number;
  k: number;
  book: BookConfig;
  widening: ProgressiveWidening;
  randomFloorDrop: number;
};

export type PickerConfig = {
  threads: number;
  hashMb: number;
  ponder: boolean;
  defaultBookMaxPlies: number;
  globalTimeCapMs: number;
  bands: Record<BandId, BandConfig>;
  devBand: {
    range: { lo: number; hi: number };
    targetGapCp: number;
    minDrop: number;
    maxDrop: number;
    kRangeScale: [number, number];
    dropAdjustStep: number;
    kAdjustStep: number;
    noiseRate: number;
    noiseMinDrop: number;
    noiseTake: number;
    forcedRandomRate: number;
    forcedRandomMinDrop: number;
    bookExit: { minPlies: number; probability: number };
    phase: { maxPlies: number; maxMs: number; extraDrop: number; kScale: number; multiPvCap: number };
  };
  imperfections: Array<{
    range: [number, number];
    profile: {
      rate: number;
      minDrop: number;
      maxDrop: number;
      randomLegalRate: number;
      takeWorst: number;
    };
  }>;
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
      movetimeFloorMs: 90,
      multipvCap: 5,
      baseMaxDrop: 900,
      k: 0.004,
      book: { maxPlies: 4, topLines: 2, exitEarly: { minPlies: 1, probability: 0.75 } },
      widening: { dropStepsCp: [160, 240], multiPvIncrements: [1, 1], timeExtensionsMs: [150, 200] },
      randomFloorDrop: 320,
    },

    developing: {
      id: 'developing',
      label: 'Developing',
      eloRange: [801, 1000],
      movetimeFloorMs: 130,
      multipvCap: 5,
      baseMaxDrop: 670,
      k: 0.006,
      book: { maxPlies: 4, topLines: 2, exitEarly: { minPlies: 2, probability: 0.55 } },
      widening: { dropStepsCp: [120, 180], multiPvIncrements: [1], timeExtensionsMs: [220] },
      randomFloorDrop: 240,
    },

    intermediate: {
      id: 'intermediate',
      label: 'Club',
      eloRange: [1001, 1400],
      movetimeFloorMs: 210,
      multipvCap: 6,
      baseMaxDrop: 420,
      k: 0.01,
      book: { maxPlies: 10, topLines: 3, exitEarly: { minPlies: 4, probability: 0.35 } },
      widening: { dropStepsCp: [90, 150], multiPvIncrements: [1, 1], timeExtensionsMs: [220, 240] },
      randomFloorDrop: 170,
    },

    advanced: {
      id: 'advanced',
      label: 'Advanced',
      eloRange: [1401, 1800],
      movetimeFloorMs: 280,      // was 300
      multipvCap: 3,
      baseMaxDrop: 280,
      k: 0.017,
      book: { maxPlies: 12, topLines: 4, exitEarly: { minPlies: 6, probability: 0.22 } },
      widening: { dropStepsCp: [70], multiPvIncrements: [1], timeExtensionsMs: [240] },
      randomFloorDrop: 120,
    },

    expert: {
      id: 'expert',
      label: 'Expert',
      eloRange: [1801, 2600],
      movetimeFloorMs: 360,
      multipvCap: 2,
      baseMaxDrop: 170,
      k: 0.03,
      book: { maxPlies: 14, topLines: 6, exitEarly: { minPlies: 8, probability: 0.15 } },
      widening: { dropStepsCp: [50], multiPvIncrements: [], timeExtensionsMs: [200] },
      randomFloorDrop: 70,
    },
  },
  devBand: {
    range: { lo: 800, hi: 1000 },
    targetGapCp: 140,
    minDrop: 80,
    maxDrop: 720,
    kRangeScale: [0.7, 1.15],
    dropAdjustStep: 10,
    kAdjustStep: 0.02,
    noiseRate: 0.7,
    noiseMinDrop: 12,
    noiseTake: 6,
    forcedRandomRate: 0.15,
    forcedRandomMinDrop: 180,
    bookExit: { minPlies: 1, probability: 0.7 },
    phase: { maxPlies: 24, maxMs: 170, extraDrop: 320, kScale: 0.5, multiPvCap: 5 },
  },
  imperfections: [
    { range: [0, 600],    profile: { rate: 0.84, minDrop: 30, maxDrop: 850, randomLegalRate: 0.16, takeWorst: 6 } },
    { range: [601, 800],  profile: { rate: 0.74, minDrop: 40, maxDrop: 700, randomLegalRate: 0.10, takeWorst: 5 } },
    { range: [801, 1000], profile: { rate: 0.52, minDrop: 25, maxDrop: 500, randomLegalRate: 0.05, takeWorst: 3 } },
    { range: [1001, 1300], profile: { rate: 0.26, minDrop: 45, maxDrop: 210, randomLegalRate: 0.04, takeWorst: 2 } },
    { range: [1301, 1700], profile: { rate: 0.10, minDrop: 35, maxDrop: 160, randomLegalRate: 0.01, takeWorst: 2 } },
    { range: [1701, 2000], profile: { rate: 0.04, minDrop: 25, maxDrop: 110, randomLegalRate: 0.0,  takeWorst: 2 } },
    { range: [2001, 2300], profile: { rate: 0.02, minDrop: 20, maxDrop: 80,  randomLegalRate: 0.0,  takeWorst: 2 } },
  ],
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

export function devBandIncludes(elo: number, cfg: PickerConfig = DEFAULT_PICKER_CONFIG): boolean {
  const e = clampElo(elo);
  return e >= cfg.devBand.range.lo && e <= cfg.devBand.range.hi;
}

export type ImperfectionProfile = PickerConfig['imperfections'][number]['profile'];

export function imperfectionForElo(elo: number, cfg: PickerConfig = DEFAULT_PICKER_CONFIG): ImperfectionProfile | null {
  const e = clampElo(elo);
  const row = cfg.imperfections.find((entry) => e >= entry.range[0] && e <= entry.range[1]);
  return row?.profile ?? null;
}

export type SideAwareEval = { cp: number; pov: Color };
