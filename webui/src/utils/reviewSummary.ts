import { accuracyFromAvgCpl, cpLossForMoveSideAware, summarizeGame, type UciScore } from '../ScoreHelpers';
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

type HalfMoveRecord = { side: 'W' | 'B'; best: UciScore; after: UciScore; tag?: MoveEval['tag'] };

function buildHalfMove(m: MoveEval): HalfMoveRecord | null {
  const side = moverSideOf(m);
  const bestCp =
    typeof (m as any).bestCpBefore === 'number'
      ? (m as any).bestCpBefore
      : typeof (m as any).cpBestBefore === 'number'
      ? (m as any).cpBestBefore
      : typeof (m as any).cpBefore === 'number'
      ? side === 'W'
        ? (m as any).cpBefore
        : -(m as any).cpBefore
      : null;

  if (bestCp == null || !Number.isFinite(bestCp)) return null;
  const best: UciScore = { type: 'cp', value: bestCp };

  const rawAfter: UciScore | null =
    (m as any).afterScore && typeof (m as any).afterScore.value === 'number'
      ? (m as any).afterScore
      : typeof (m as any).cpAfter === 'number' && Number.isFinite((m as any).cpAfter)
      ? { type: 'cp', value: (m as any).cpAfter }
      : typeof (m as any).cpAfterWhite === 'number' && Number.isFinite((m as any).cpAfterWhite)
      ? (() => {
          const nextSide = side === 'W' ? 'B' : 'W';
          const val = nextSide === 'W' ? (m as any).cpAfterWhite : -(m as any).cpAfterWhite;
          return { type: 'cp', value: val } as UciScore;
        })()
      : null;

  if (!rawAfter) return null;

  return {
    side,
    best,
    after: rawAfter,
    tag: m.tag,
  };
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
    if (typeof (m as any).mateAfter === 'number') continue;
    const hm = buildHalfMove(m);
    if (!hm) continue;
    halfMoves.push(hm);
    const loss = cpLossForMoveSideAware(hm.best, hm.after, hm.side);
    if (loss != null) rollingLosses.push(loss);
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
