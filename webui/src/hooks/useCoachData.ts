import { useMemo } from 'react';
import type { CoachInputs, CoachNote } from './useCoach';
import type { MoveEval } from '../types/moveEval';

export function useCoachMoments(movesUci: string[], moveEvals: MoveEval[]): CoachInputs['moments'] {
  return useMemo(() => {
    return movesUci.map((uci, index) => {
      const m: any = moveEvals[index] ?? {};
      const side: 'W' | 'B' = m.side === 'White' || index % 2 === 0 ? 'W' : 'B';
      const san =
        typeof m.san === 'string'
          ? m.san
          : typeof m.playedSan === 'string'
          ? m.playedSan
          : typeof uci === 'string'
          ? uci
          : '';
      const best =
        typeof m.engineBestSan === 'string'
          ? m.engineBestSan
          : typeof m.bestSan === 'string'
          ? m.bestSan
          : typeof m.engineBest === 'string'
          ? m.engineBest
          : null;
      const tag = typeof m.tag === 'string' ? m.tag : '';
      const cpBefore =
        typeof m.cpBestBefore === 'number'
          ? m.cpBestBefore
          : typeof m.bestCpBefore === 'number'
          ? m.bestCpBefore
          : null;
      const cpAfter = typeof m.cpAfter === 'number' ? m.cpAfter : null;
      return {
        index,
        moveNo: Math.floor(index / 2) + 1,
        side,
        san,
        best,
        tag,
        cpBefore,
        cpAfter,
      };
    });
  }, [movesUci, moveEvals]);
}

export function useCoachNotesForPly(ply: number, coachNotes: CoachNote[] | null | undefined, moveCount: number) {
  return useMemo(() => {
    const arr = coachNotes || [];
    if (!arr.length) return [];
    const idx = Math.max(0, ply - 1);
    const exact = arr.filter((n) => n?.type === 'move' && n.moveIndex === idx);
    if (exact.length) return exact;
    const near = arr.filter(
      (n) => n?.type === 'move' && typeof n.moveIndex === 'number' && Math.abs(n.moveIndex - idx) === 1
    );
    if (near.length) return near;
    if (idx === 0) return arr.filter((n) => n?.type === 'intro');
    if (idx >= moveCount - 1) return arr.filter((n) => n?.type === 'summary');
    return [];
  }, [ply, coachNotes, moveCount]);
}
