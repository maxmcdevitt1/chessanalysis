// Robust score helpers for accuracy, tagging, and rough Elo-from-game estimation.

export type UciScore = { type: 'cp' | 'mate'; value: number };

// -------------------------------- Core score math --------------------------------

/** Normalize engine scores to centipawns (clipped), POV = mover. */
export function cpFromScore(score: UciScore | null | undefined): number | null {
  if (!score || typeof score.value !== 'number') return null;
  if (score.type === 'cp') {
    return Math.max(-4000, Math.min(4000, score.value));
  }
  const sign = score.value >= 0 ? 1 : -1;
  const cp = 10000 - Math.min(99, Math.abs(score.value)) * 100;
  return sign * cp;
}

/** Centipawn loss for a half-move using White-POV values. */
export function cpLossWhitePov(
  cpBeforeWhite: number,
  cpAfterWhite: number,
  side: 'W' | 'B'
): number {
  if (side === 'W') return Math.max(0, cpBeforeWhite - cpAfterWhite);
  return Math.max(0, cpAfterWhite - cpBeforeWhite);
}

/** @deprecated Use cpLossWhitePov instead. */
export function cpLossForMoveSideAware(
  bestBefore: UciScore | null | undefined,
  afterScore: UciScore | null | undefined,
  _mover: 'W' | 'B'
): number | null {
  const b = cpFromScore(bestBefore);
  const aRaw = cpFromScore(afterScore);
  if (b == null || aRaw == null) return null;
  const a = -aRaw;
  return Math.max(0, b - a);
}

/** Classify a single move by its centipawn loss (mover POV). */
export function classifyLossCp(lossCp: number): 'best'|'good'|'inaccuracy'|'mistake'|'blunder' {
  const l = Math.abs(lossCp | 0);
  if (l >= 300) return 'blunder';
  if (l >= 100)  return 'mistake';
  if (l >= 50)  return 'inaccuracy';
  if (l >= 30)   return 'good';
  return 'best';
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

// -------------------------------- Win-chances accuracy --------------------------------

/**
 * Win-chance percentage in (0,100) for a White-POV centipawn score.
 * Matches the Lichess formula: wc = 50 + 50 * (2/(1+exp(-0.00368208*cp)) - 1)
 */
export function winChancesPct(cp: number): number {
  return 100 / (1 + Math.exp(-0.00368208 * cp));
}

/**
 * Per-move accuracy (0–100) using win-chance loss.
 * Uses Lichess-derived formula: 103.1668 * exp(-0.04354 * wcLoss) - 3.167
 * Both cpBeforeWhite and cpAfterWhite are White-POV centipawns.
 */
export function moveWinAccuracy(cpBeforeWhite: number, cpAfterWhite: number, side: 'W' | 'B'): number {
  const before = side === 'W' ? cpBeforeWhite : -cpBeforeWhite;
  const after  = side === 'W' ? cpAfterWhite  : -cpAfterWhite;
  const wcLoss = Math.max(0, winChancesPct(before) - winChancesPct(after));
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * wcLoss) - 3.167));
}

// -------------------------- Accuracy & ELO (steeper) --------------------------

const LOGISTIC_A = 163;
const LOGISTIC_B = 1.45;

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
  if (lossCp <= 45) return 'Good';
  if (lossCp <= 90) return 'Mistake';
  return 'Blunder';
}

// Piecewise ACPL→ELO anchors (steeper)
const ACPL_ELO_TABLE: Array<[number, number]> = [
  [5, 2750],
  [10, 2450],
  [20, 2100],
  [35, 1875],
  [50, 1675],
  [70, 1475],
  [90, 1300],
  [120, 1100],
  [150, 900],
  [200, 700],
  [250, 500],
  [300, 250],
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
 * Compute per-move and aggregate accuracy using win-chances formula.
 * Accepts moves in White-POV convention (cpBeforeWhite, cpAfterWhite).
 */
export function summarizeGame(moves: Array<{
  side: 'W' | 'B';
  cpBeforeWhite: number;
  cpAfterWhite: number;
  tag?: string | null;
}>) {
  const bySide = { W: [] as typeof moves, B: [] as typeof moves };
  for (const m of moves) (m.side === 'W' ? bySide.W : bySide.B).push(m);

  function stats(side: 'W'|'B') {
    const arr = bySide[side];
    let sumAcc = 0, sumCpl = 0, n = 0, mistakes = 0, blunders = 0;
    for (const m of arr) {
      const cpl = cpLossWhitePov(m.cpBeforeWhite, m.cpAfterWhite, side);
      sumCpl += cpl;
      sumAcc += moveWinAccuracy(m.cpBeforeWhite, m.cpAfterWhite, side);
      n++;
      if (cpl >= 150) blunders++;
      else if (cpl >= 50) mistakes++;
    }
    const avgCpl = n ? sumCpl / n : null;
    const accuracy = n ? Math.round((sumAcc / n) * 10) / 10 : null;
    const estElo = estimateEloFromGame({ avgCpl, halfMoves: n, mistakes, blunders });
    return { n, avgCpl, mistakes, blunders, estElo, accuracy };
  }

  const white = stats('W');
  const black = stats('B');
  return { white, black };
}
