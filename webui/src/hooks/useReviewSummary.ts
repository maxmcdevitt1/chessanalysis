import { useMemo, useRef } from 'react';
import type { MoveEval } from '../types/moveEval';
import { createRollingStore, deriveReviewSummary, type ReviewSummary } from '../utils/reviewSummary';
import { cpAfterWhiteValue } from '../utils/moveAnnotations';

export type UseReviewReturn = {
  review: ReviewSummary | null;
  evalSeries: Array<number | null>;
};

export function useReviewSummary(moveEvals: MoveEval[]): UseReviewReturn {
  const storeRef = useRef(createRollingStore());
  return useMemo(() => {
    const { summary } = deriveReviewSummary(moveEvals, { store: storeRef.current });
    const evalSeries = moveEvals.map((m) => cpAfterWhiteValue(m));
    return { review: summary, evalSeries };
  }, [moveEvals]);
}
