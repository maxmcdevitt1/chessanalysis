import type { MoveEval, BadgeTag } from '../types/moveEval';

type QualityCounts = { total: number; best: number; good: number; inaccuracy: number; mistake: number; blunder: number };
type QualityBySide = { W: QualityCounts; B: QualityCounts };

type MoveTag = NonNullable<MoveEval['tag']>;

const TAG_BUCKET: Partial<Record<MoveTag, keyof QualityCounts>> = {
  Best: 'best',
  Genius: 'best',
  Good: 'good',
  Inaccuracy: 'inaccuracy',
  Mistake: 'mistake',
  Blunder: 'blunder',
};

export function moverSideOf(m: any): 'W' | 'B' {
  const s = String(m?.side ?? m?.color ?? '').toUpperCase();
  if (s.startsWith('W')) return 'W';
  if (s.startsWith('B')) return 'B';
  if (Number.isFinite(m?.ply)) return (m.ply % 2 === 1) ? 'W' : 'B'; // ply=1 -> White
  return 'W';
}

export function tallyQualityFromTags(moves: MoveEval[]): QualityBySide {
  const init = (): QualityCounts => ({ total: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 });
  const out: QualityBySide = { W: init(), B: init() };
  for (const m of moves) {
    const tag = m?.tag;
    if (!tag) continue;
    const bucket = TAG_BUCKET[tag as MoveTag];
    if (!bucket) continue;
    const entry = out[moverSideOf(m)];
    entry.total++;
    entry[bucket]++;
  }
  return out;
}

const SEVERITY_THRESHOLDS = {
  goodMax: 10,        // ≤ 10 cp → Good
  inaccuracyMax: 49,  // ≤ 49 cp → Inaccuracy
  mistakeMax: 149,    // ≤ 149 cp → Mistake
                      // > 149 cp → Blunder
};

export function severityTag(cpl: number | null): MoveEval['tag'] {
  if (cpl == null) return 'Review';
  if (cpl <= SEVERITY_THRESHOLDS.goodMax) return 'Good';
  if (cpl <= SEVERITY_THRESHOLDS.inaccuracyMax) return 'Inaccuracy';
  if (cpl <= SEVERITY_THRESHOLDS.mistakeMax) return 'Mistake';
  return 'Blunder';
}

export function maybeGeniusTag(opts: {
  mover: 'w' | 'b';
  cpl: number | null;
  mateAfter: number | null;
  cpBeforeWhite: number | null;
  isBookMove: boolean;
}): MoveEval['tag'] | null {
  const { mover, cpl, mateAfter, cpBeforeWhite, isBookMove } = opts;
  if (isBookMove) return null;
  if (mateAfter == null || !Number.isFinite(mateAfter)) return null;
  if (mateAfter >= -1) return null;
  const mateDist = Math.abs(mateAfter);
  if (mateDist <= 2) return null;

  const beforeForMover = typeof cpBeforeWhite === 'number'
    ? (mover === 'w' ? cpBeforeWhite : -cpBeforeWhite)
    : null;
  if (beforeForMover != null && beforeForMover > 300) return null;

  const sacrificeLike = cpl == null ? true : cpl >= 12;
  if (!sacrificeLike) return null;
  return 'Genius';
}

export function symbolFor(tag: MoveEval['tag']): MoveEval['symbol'] {
  switch (tag) {
    case 'Genius': return '!!';
    case 'Best': return '!';
    case 'Inaccuracy': return '?!';
    case 'Good': return '';
    case 'Mistake': return '?';
    case 'Blunder': return '??';
    case 'Review': return '?!';
    case 'Book':
    default: return '';
  }
}

/** Read cpAfterWhite (White POV) from a MoveEval record. */
export function cpAfterWhiteValue(m: any): number | null {
  if (!m) return null;
  if (typeof m.cpAfterWhite === 'number') return m.cpAfterWhite;
  return null;
}
