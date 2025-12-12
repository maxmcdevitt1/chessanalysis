import { useMemo } from 'react';
import type { MoveEval } from '../types/moveEval';
import type { Square } from '../chess-compat';
import { cpAfterWhiteValue } from '../utils/moveAnnotations';

export function useBestArrow(ply: number, moveEvals: MoveEval[]) {
  return useMemo(() => {
    if (ply === 0) return null;
    const idx = ply - 1;
    if (idx < 0 || idx >= moveEvals.length) return null;
    const uci = moveEvals[idx]?.best;
    if (!uci || uci.length < 4) return null;
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    return { from, to };
  }, [ply, moveEvals]);
}

export function useEvalDisplayCp(
  evalCp: number | null,
  currentMoveEval: MoveEval | null,
  moveEvals: MoveEval[]
): number | null {
  return useMemo(() => {
    if (typeof evalCp === 'number' && Number.isFinite(evalCp)) return evalCp;
    const cur = cpAfterWhiteValue(currentMoveEval as any);
    if (typeof cur === 'number' && Number.isFinite(cur)) return cur;
    for (let i = moveEvals.length - 1; i >= 0; i -= 1) {
      const val = cpAfterWhiteValue(moveEvals[i] as any);
      if (typeof val === 'number' && Number.isFinite(val)) return val;
    }
    return null;
  }, [evalCp, currentMoveEval, moveEvals]);
}
