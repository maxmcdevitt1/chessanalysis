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
      movetimeFloorMs: 150,
      multipvCap: 4,
      baseMaxDrop: 700,
      k: 0.006,
      book: { maxPlies: 5, topLines: 3 },
      widening: {
        dropStepsCp: [120, 200],
        multiPvIncrements: [1],
        timeExtensionsMs: [180],
      },
      randomFloorDrop: 250,
    },
    developing: {
      id: 'developing',
      label: 'Developing',
      eloRange: [801, 1000],
      movetimeFloorMs: 170,
      multipvCap: 6,
      baseMaxDrop: 900,
      k: 0.005,
      book: { maxPlies: 2, topLines: 1, exitEarly: { minPlies: 1, probability: 0.7 } },
      widening: {
        dropStepsCp: [160, 220],
        multiPvIncrements: [1],
        timeExtensionsMs: [220],
      },
      randomFloorDrop: 320,
    },
    intermediate: {
      id: 'intermediate',
      label: 'Intermediate',
      eloRange: [1001, 1300],
      movetimeFloorMs: 160,
      multipvCap: 2,
      baseMaxDrop: 480,
      k: 0.012,
      book: { maxPlies: 10, topLines: 3 },
      widening: {
        dropStepsCp: [100, 160],
        multiPvIncrements: [1],
        timeExtensionsMs: [200],
      },
      randomFloorDrop: 220,
    },
    advanced: {
      id: 'advanced',
      label: 'Advanced',
      eloRange: [1301, 1700],
      movetimeFloorMs: 130,
      multipvCap: 2,
      baseMaxDrop: 300,
      k: 0.0135,
      book: { maxPlies: 12, topLines: 4 },
      widening: {
        dropStepsCp: [80],
        multiPvIncrements: [1],
        timeExtensionsMs: [220],
      },
      randomFloorDrop: 150,
    },
    expert: {
      id: 'expert',
      label: 'Expert',
      eloRange: [1701, 2600],
      movetimeFloorMs: 120,
      multipvCap: 1,
      baseMaxDrop: 220,
      k: 0.024,
      book: { maxPlies: 14, topLines: 6 },
      widening: {
        dropStepsCp: [60],
        multiPvIncrements: [],
        timeExtensionsMs: [200],
      },
      randomFloorDrop: 80,
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
    { range: [0, 600], profile: { rate: 0.75, minDrop: 60, maxDrop: 700, randomLegalRate: 0.32, takeWorst: 5 } },
    { range: [601, 800], profile: { rate: 0.65, minDrop: 45, maxDrop: 660, randomLegalRate: 0.24, takeWorst: 4 } },
    { range: [801, 1000], profile: { rate: 0.58, minDrop: 30, maxDrop: 620, randomLegalRate: 0.15, takeWorst: 4 } },
    { range: [1001, 1300], profile: { rate: 0.18, minDrop: 45, maxDrop: 280, randomLegalRate: 0.04, takeWorst: 2 } },
    { range: [1301, 1700], profile: { rate: 0.08, minDrop: 35, maxDrop: 160, randomLegalRate: 0.02, takeWorst: 2 } },
    { range: [1701, 2000], profile: { rate: 0.04, minDrop: 25, maxDrop: 110, randomLegalRate: 0.0, takeWorst: 2 } },
    { range: [2001, 2300], profile: { rate: 0.02, minDrop: 20, maxDrop: 80, randomLegalRate: 0.0, takeWorst: 2 } },
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
