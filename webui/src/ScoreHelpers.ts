// Robust score helpers for accuracy, tagging, and rough Elo-from-game estimation.

export type UciScore = { type: 'cp' | 'mate'; value: number };

// -------------------------------- Core score math --------------------------------

/** Normalize engine scores to centipawns (clipped), POV = mover. */
export function cpFromScore(score: UciScore | null | undefined): number | null {
  if (!score || typeof score.value !== 'number') return null;
  if (score.type === 'cp') {
    // Clamp to something sane; avoids outliers exploding averages
    return Math.max(-2000, Math.min(2000, score.value));
  }
  // Map mate distance to large cp; closer mates get larger magnitude.
  // Sign = positive if mate for mover, negative if getting mated.
  const sign = score.value >= 0 ? 1 : -1;
  const cp = 10000 - Math.min(99, Math.abs(score.value)) * 100; // mate in 1 ≈ 9900
  return sign * cp;
}

/** Centipawn loss for a half-move: how much worse than best for the mover. */
export function cpLossForMoveSideAware(
  bestBefore: UciScore | null | undefined,
  // afterScore should be opponent POV (side to move after the move).
  afterScore: UciScore | null | undefined,
  mover: 'W' | 'B'
): number | null {
  const b = cpFromScore(bestBefore);
  const aRaw = cpFromScore(afterScore);
  if (b == null || aRaw == null) return null;
  const a = -aRaw; // flip POV after the move to keep mover POV
  return Math.max(0, b - a);
}

/** Classify a single move by its centipawn loss (mover POV). */
export function classifyLossCp(lossCp: number): 'best'|'good'|'inaccuracy'|'mistake'|'blunder' {
  const l = Math.abs(lossCp | 0);
  if (l >= 150) return 'blunder';
  if (l >= 60)  return 'mistake';
  if (l >= 30)  return 'inaccuracy';
  if (l <= 5)   return 'best';
  return 'good';
}

export type QualityTally = {
  total: number;
  best: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
};

/** Tally move quality per side using cpLoss thresholds. */
export function tallyMoveQuality(halfMoves: Array<{
  side: 'W'|'B',
  best?: UciScore | null,
  after?: UciScore | null
}>): { W: QualityTally; B: QualityTally } {
  const init = (): QualityTally => ({ total:0, best:0, good:0, inaccuracy:0, mistake:0, blunder:0 });
  const out = { W: init(), B: init() };
  for (const hm of halfMoves) {
    const loss = cpLossForMoveSideAware(hm.best ?? null, hm.after ?? null, hm.side);
    if (loss == null) continue;
    const bucket = classifyLossCp(loss);
    const t = out[hm.side];
    t.total++;
    t[bucket]++;
  }
  return out;
}

/** Aggregate average CPL per side; skips nulls/books. */
export function avgCplPerSide(halfMoves: Array<{
  side: 'W' | 'B';
  best?: UciScore | null;
  after?: UciScore | null;
}>): { avgW: number | null; avgB: number | null; nW: number; nB: number } {
  let sumW = 0, nW = 0, sumB = 0, nB = 0;
  for (const hm of halfMoves) {
    const loss = cpLossForMoveSideAware(hm.best ?? null, hm.after ?? null, hm.side);
    if (loss == null) continue;
    if (hm.side === 'W') { sumW += loss; nW++; }
    else { sumB += loss; nB++; }
  }
  return {
    avgW: nW ? sumW / nW : null,
    avgB: nB ? sumB / nB : null,
    nW, nB
  };
}

// -------------------------- Accuracy & ELO (steeper) --------------------------

/** Accuracy from avg CPL with a smoother curve (ACPL≈10 → ~98–99, 50 → ~91, 100 → ~81). */
export function accuracyFromAvgCpl(acpl: number | null): number | null {
  if (acpl == null || !isFinite(acpl)) return null;
  const x = Math.max(0, acpl);
  const A = 400;
  const k = 1.1;
  const val = 100 / (1 + Math.pow(x / A, k));
  return Math.round(Math.max(1, Math.min(99, val)) * 10) / 10;
}

/** Optional: CPL → qualitative tag aligned with stricter accuracy. */
export function tagFromLoss(lossCp: number): 'Best' | 'Good' | 'Mistake' | 'Blunder' {
  if (lossCp <= 15) return 'Best';
  if (lossCp <= 50) return 'Good';       // slightly tighter than before
  if (lossCp <= 120) return 'Mistake';
  return 'Blunder';
}

// Piecewise ACPL→ELO anchors (steeper)
const ACPL_ELO_TABLE: Array<[number, number]> = [
  [10, 2500], [20, 2200], [30, 1850], [45, 1500],
  [65, 1250], [90, 1000], [120, 800], [160, 600],
  [210, 500], [280, 420], [360, 400], [460, 400],
];

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

function interpPiecewise(points: Array<[number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

export function estimateEloFromGame(args: {
  avgCpl: number | null;
  halfMoves: number;
  mistakes?: number;
  blunders?: number;
}): number | null {
  const { avgCpl, halfMoves } = args;
  if (avgCpl == null || !isFinite(avgCpl) || halfMoves <= 0) return null;
  const hm = Math.max(1, halfMoves | 0);
  const base = interpPiecewise(ACPL_ELO_TABLE, Math.max(0, avgCpl));
  const m = Math.max(0, (args.mistakes ?? 0));
  const b = Math.max(0, (args.blunders ?? 0));
  const shortFactor = 1 + 0.4 * clamp((40 - hm) / 40, 0, 1);
  const penalty = shortFactor * (1.6 * m + 4.5 * b);
  let est = base - penalty;
  const shrink = clamp(1 - hm / 60, 0, 0.5);
  est = (1 - shrink) * est + shrink * 1500;
  return Math.round(clamp(est, 400, 2600));
}

/**
 * Convenience: compute ACPL, accuracy, tags, and Elo for both sides from raw per-move data.
 * Expects an array of moves with stored best and after scores and side-to-move.
 */
export function summarizeGame(moves: Array<{
  side: 'W' | 'B';
  best?: UciScore | null;   // BEFORE move, POV mover
  after?: UciScore | null;  // AFTER move, POV opponent
  tag?: string | null;
}>) {
  const bySide = { W: [] as typeof moves, B: [] as typeof moves };
  for (const m of moves) (m.side === 'W' ? bySide.W : bySide.B).push(m);

  function stats(side: 'W'|'B') {
    const arr = bySide[side];
    let sum = 0, n = 0, mistakes = 0, blunders = 0;
    for (const m of arr) {
      const loss = cpLossForMoveSideAware(m.best ?? null, m.after ?? null, side);
      if (loss == null) continue;
      n++; sum += loss;
      const l = Math.round(loss);
      if (l >= 150) blunders++;
      else if (l >= 60) mistakes++;
    }
    const avgCpl = n ? sum / n : null;
    const estElo = estimateEloFromGame({ avgCpl, halfMoves: n, mistakes, blunders });
    const acc = accuracyFromAvgCpl(avgCpl);
    return { n, avgCpl, mistakes, blunders, estElo, accuracy: acc };
  }

  const white = stats('W');
  const black = stats('B');
  return { white, black };
}
