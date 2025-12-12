import type { MoveEval, BadgeTag } from '../types/moveEval';
import { mateToCp } from './evalScoring';

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
  goodMax: 80,
  inaccuracyMax: 180,
  mistakeMax: 380,
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
  // mateAfter is POV of opponent (side to move). Negative means mover is winning.
  if (mateAfter >= -1) return null; // not a forced mate for mover or too trivial
  const mateDist = Math.abs(mateAfter);
  if (mateDist <= 2) return null; // skip obvious mate-in-1/2

  // Before the move, avoid already-crushing positions; focus on surprise turnarounds.
  const beforeForMover = typeof cpBeforeWhite === 'number'
    ? (mover === 'w' ? cpBeforeWhite : -cpBeforeWhite)
    : null;
  if (beforeForMover != null && beforeForMover > 300) return null; // already winning big

  // If the move dumped material (high CPL) or even wasn't marked Best yet still forces mate, call it genius.
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

export function cpAfterWhiteValue(m: any): number | null {
  if (!m) return null;
  const side = (m.side === 'White' || m.side === 'W') ? 'W' : 'B';
  if (typeof m.cpAfterWhite === 'number') return m.cpAfterWhite;
  if (typeof m.cpAfter === 'number') {
    return side === 'W' ? -m.cpAfter : m.cpAfter;
  }
  if (typeof m.mateAfter === 'number') {
    const mateCp = mateToCp(m.mateAfter);
    if (mateCp == null) return null;
    return side === 'W' ? -mateCp : mateCp;
  }
  return null;
}
