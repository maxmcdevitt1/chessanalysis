export type StrengthBandId =
  | 'casual'
  | 'novice'
  | 'developing'
  | 'club'
  | 'class_b'
  | 'expert'
  | 'master';

export type StrengthBand = {
  id: StrengthBandId;
  label: string;
  range: [number, number];
  centerElo: number;
  display?: string;
};

export const STRENGTH_BANDS: StrengthBand[] = [
  { id: 'casual',     label: 'Casual',     range: [400, 600],   centerElo: 500,  display: 'Casual (400–600)' },
  { id: 'novice',     label: 'Novice',     range: [600, 800],   centerElo: 700,  display: 'Novice (600–800)' },
  { id: 'developing', label: 'Developing', range: [800, 1000],  centerElo: 900,  display: 'Developing (800–1000)' },
  { id: 'club',       label: 'Club',       range: [1000, 1300], centerElo: 1150, display: 'Club (1000–1300)' },
  { id: 'class_b',    label: 'Class B',    range: [1400, 1800], centerElo: 1600, display: 'Class B (1400–1800)' },
  { id: 'expert',     label: 'Expert',     range: [1800, 2100], centerElo: 1950, display: 'Expert (1800–2100)' },
  { id: 'master',     label: 'Master',     range: [2100, 2500], centerElo: 2300, display: 'Master (2100–2500)' },
];

export const DEFAULT_STRENGTH_BAND_ID: StrengthBandId = 'club';

export function bandById(id: StrengthBandId | string | null | undefined): StrengthBand {
  const hit = STRENGTH_BANDS.find((b) => b.id === id);
  return hit || STRENGTH_BANDS.find((b) => b.id === DEFAULT_STRENGTH_BAND_ID)!;
}

export function bandForElo(elo: number): StrengthBand {
  const e = Math.max(100, Math.min(2800, Math.round(elo || 400)));
  const inRange = STRENGTH_BANDS.find((b) => e >= b.range[0] && e <= b.range[1]);
  if (inRange) return inRange;
  return STRENGTH_BANDS.reduce((best, b) => {
    const diff = Math.abs(e - b.centerElo);
    const bestDiff = Math.abs(e - best.centerElo);
    return diff < bestDiff ? b : best;
  }, STRENGTH_BANDS[0]);
}

export function bandCenterElo(id: StrengthBandId | string | null | undefined): number {
  return bandById(id).centerElo;
}

export function bandPlayElo(id: StrengthBandId | string | null | undefined): number {
  const band = bandById(id as StrengthBandId);
  return Math.round(Math.max(400, Math.min(2500, band.centerElo)));
}
