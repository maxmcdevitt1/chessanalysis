import { accuracyFromAvgCpl, cpLossWhitePov, summarizeGame, winChancesPct } from '../ScoreHelpers';
import type { MoveEval } from '../types/moveEval';
import { moverSideOf, tallyQualityFromTags } from './moveAnnotations';

export type ReviewSummary = {
  avgCplW: number | null;
  avgCplB: number | null;
  whiteAcc: number | null;
  blackAcc: number | null;
  estEloWhite: number | null;
  estEloBlack: number | null;
  quality: ReturnType<typeof tallyQualityFromTags>;
  rollingAcpl: number | null;
  rollingAcc: number | null;
  rollingSamples: number;
};

export type ReviewResult = {
  summary: ReviewSummary | null;
  rollingHistory: number[];
};

export interface RollingStore {
  read(): number[];
  write(values: number[]): void;
}

const ROLLING_ACPL_KEY = 'rollingAcplHistory';

export function createRollingStore(key: string = ROLLING_ACPL_KEY): RollingStore {
  return {
    read() {
      if (typeof window === 'undefined') return [];
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((n) => typeof n === 'number' && Number.isFinite(n));
      } catch {
        return [];
      }
    },
    write(values: number[]) {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(key, JSON.stringify(values));
      } catch {
        /* ignore */
      }
    },
  };
}

type HalfMoveRecord = { side: 'W' | 'B'; cpBeforeWhite: number; cpAfterWhite: number; tag?: MoveEval['tag'] };

function buildHalfMove(m: MoveEval): HalfMoveRecord | null {
  const side = moverSideOf(m);
  const cpBefore = typeof m.cpBefore === 'number' ? m.cpBefore : null;
  const cpAfterW = typeof m.cpAfterWhite === 'number' ? m.cpAfterWhite : null;
  if (cpBefore == null || cpAfterW == null) return null;
  return { side, cpBeforeWhite: cpBefore, cpAfterWhite: cpAfterW, tag: m.tag };
}

export function deriveReviewSummary(
  moveEvals: MoveEval[],
  opts?: { store?: RollingStore | null; maxSamples?: number }
): ReviewResult {
  const store = opts?.store ?? createRollingStore();
  const maxSamples = opts?.maxSamples ?? 500;
  const rollingBase = store?.read() ?? [];

  const halfMoves: HalfMoveRecord[] = [];
  const rollingLosses: number[] = [];
  for (const m of moveEvals) {
    const hm = buildHalfMove(m);
    if (!hm) continue;
    halfMoves.push(hm);
    const loss = cpLossWhitePov(hm.cpBeforeWhite, hm.cpAfterWhite, hm.side);
    rollingLosses.push(loss);
  }

  if (!halfMoves.length) {
    const history = rollingBase.slice(-maxSamples);
    if (store) store.write(history);
    return { summary: null, rollingHistory: history };
  }

  const quality = tallyQualityFromTags(moveEvals);
  const summary = summarizeGame(halfMoves);
  const updated = [...rollingBase, ...rollingLosses].slice(-maxSamples);
  if (store) store.write(updated);
  const rollingAcpl = updated.length ? updated.reduce((a, b) => a + b, 0) / updated.length : null;
  const rollingAcc = accuracyFromAvgCpl(rollingAcpl);

  const out: ReviewSummary = {
    avgCplW: summary.white.avgCpl,
    avgCplB: summary.black.avgCpl,
    whiteAcc: summary.white.accuracy,
    blackAcc: summary.black.accuracy,
    estEloWhite: summary.white.estElo,
    estEloBlack: summary.black.estElo,
    quality,
    rollingAcpl,
    rollingAcc,
    rollingSamples: updated.length,
  };

  return { summary: out, rollingHistory: updated };
}
