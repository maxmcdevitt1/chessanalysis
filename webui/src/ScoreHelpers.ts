// Robust score helpers for accuracy, tagging, and rough Elo-from-game estimation.

export type UciScore = { type: 'cp' | 'mate'; value: number };

// -------------------------------- Core score math --------------------------------

/** Normalize engine scores to centipawns (clipped), POV = mover. */
export function cpFromScore(score: UciScore | null | undefined): number | null {
  if (!score || typeof score.value !== 'number') return null;
  if (score.type === 'cp') {
    // Clamp to something sane; avoid runaway but keep large swings visible.
    return Math.max(-4000, Math.min(4000, score.value));
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
  if (l >= 90)  return 'blunder';
  if (l >= 45)  return 'mistake';
  if (l >= 15)  return 'inaccuracy';
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

/**
 * Accuracy curve tuned to match the latest Lichess samples (≈91 ACPL → 70%,
 * ≈94 ACPL → 69%).  These anchors keep higher ACPL games from collapsing into
 * the 50s while still rewarding sub-50 ACPL performance.
 */
const LOGISTIC_A = 163;   // derived from solving the 91/70 constraint pair
const LOGISTIC_B = 1.45;  // steeper drop so 70% occurs around 90 ACPL

export function accuracyFromAvgCpl(acpl: number | null): number | null {
  if (acpl == null || !isFinite(acpl)) return null;
  const x = Math.max(0, acpl);
  const val = 100 / (1 + Math.pow(x / LOGISTIC_A, LOGISTIC_B));
  return Math.max(1, Math.min(99, Math.round(val * 10) / 10));
}

export function acplFromAccuracy(acc: number | null): number | null {
  if (acc == null || !isFinite(acc)) return null;
  const a = Math.max(1, Math.min(99.9, acc));
  const ratio = (100 / a) - 1;
  const acpl = LOGISTIC_A * Math.pow(ratio, 1 / LOGISTIC_B);
  return Math.max(0, Math.round(acpl));
}

export type AcplBand = {
  eloMin: number;
  eloMax: number;
  label: string;
  targetAcpl: number;
  accuracyPct: number;
  acceptableRange: [number, number];
};

const ACPL_BANDS: AcplBand[] = [
  { eloMin: 100,  eloMax: 399,  label: 'Beginner',            targetAcpl: 300, accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 400,  eloMax: 599,  label: 'Casual',              targetAcpl: 250, accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 600,  eloMax: 799,  label: 'Novice',              targetAcpl: 200, accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 800,  eloMax: 999,  label: 'Developing',          targetAcpl: 150, accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 1000, eloMax: 1199, label: 'Intermediate',        targetAcpl: 120, accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 1200, eloMax: 1399, label: 'Club',                targetAcpl: 90,  accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 1400, eloMax: 1549, label: 'Strong Club',         targetAcpl: 70,  accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 1600, eloMax: 1749, label: 'Class B',             targetAcpl: 50,  accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 1800, eloMax: 1949, label: 'Class A',             targetAcpl: 35,  accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 2000, eloMax: 2200, label: 'Expert',              targetAcpl: 20,  accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 2300, eloMax: 2599, label: 'Master',              targetAcpl: 10,  accuracyPct: 0, acceptableRange: [0,0] },
  { eloMin: 2600, eloMax: 2800, label: 'GM / Engine',         targetAcpl: 5,   accuracyPct: 0, acceptableRange: [0,0] },
].map((band) => {
  const acc = accuracyFromAvgCpl(band.targetAcpl) ?? 0;
  const window = Math.round(band.targetAcpl * 0.15);
  const lo = Math.max(0, band.targetAcpl - window);
  const hi = Math.max(lo, band.targetAcpl + window);
  return { ...band, accuracyPct: Math.round(acc * 10) / 10, acceptableRange: [lo, hi] as [number, number] };
});

export function acplBandForElo(elo: number): AcplBand | null {
  const e = Math.max(100, Math.min(2800, Math.round(elo)));
  const hit = ACPL_BANDS.find((b) => e >= b.eloMin && e <= b.eloMax);
  return hit || null;
}

/** Optional: CPL → qualitative tag aligned with stricter accuracy. */
export function tagFromLoss(lossCp: number): 'Best' | 'Good' | 'Mistake' | 'Blunder' {
  if (lossCp <= 10) return 'Best';
  if (lossCp <= 45) return 'Good';       // harsher: flag middling drops sooner
  if (lossCp <= 90) return 'Mistake';
  return 'Blunder';
}

// Piecewise ACPL→ELO anchors (steeper)
const ACPL_ELO_TABLE: Array<[number, number]> = [
  [5, 2750],   // <5 → GM / engine
  [10, 2450],  // 10 → 2300–2600
  [20, 2100],  // 20 → 2000–2200
  [35, 1875],  // 35 → 1800–1950
  [50, 1675],  // 50 → 1600–1750
  [70, 1475],  // 70 → 1400–1550
  [90, 1300],  // 90 → 1200–1400
  [120, 1100], // 120 → 1000–1200
  [150, 900],  // 150 → 800–1000
  [200, 700],  // 200 → 600–800
  [250, 500],  // 250 → 400–600
  [300, 250],  // 300+ → 100–400
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
  const SHORT_GAME_THRESHOLD = 18;
  const shortFactor =
    1 + 0.4 * clamp((SHORT_GAME_THRESHOLD - hm) / SHORT_GAME_THRESHOLD, 0, 1);
  const penalty = shortFactor * (2.1 * m + 5.5 * b);
  let est = base - penalty;
  const shrink = clamp(
    (SHORT_GAME_THRESHOLD - hm) / SHORT_GAME_THRESHOLD,
    0,
    0.5
  );
  est = (1 - shrink) * est + shrink * 1500;
  return Math.round(clamp(est, 100, 2800));
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
      if (l >= 90) blunders++;
      else if (l >= 45) mistakes++;
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
