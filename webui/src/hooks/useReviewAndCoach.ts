import type { CoachInputs, CoachNote } from './useCoach';
import type { MoveEval } from '../types/moveEval';
import { useReviewSummary } from './useReviewSummary';
import { useCoachMoments, useCoachNotesForPly } from './useCoachData';
import { useCoachActions } from './useCoachActions';

export type UseReviewAndCoachArgs = {
  moveEvals: MoveEval[];
  movesUci: string[];
  ply: number;
  coachNotes: CoachNote[];
  coachBusy: boolean;
  runCoach: (inputs: CoachInputs) => Promise<any>;
  openingText: string | null;
};

export function useReviewAndCoach({
  moveEvals,
  movesUci,
  ply,
  coachNotes,
  coachBusy,
  runCoach,
  openingText,
}: UseReviewAndCoachArgs) {
  const { review, evalSeries } = useReviewSummary(moveEvals);
  const coachMoments = useCoachMoments(movesUci, moveEvals);

  const { onGenerateNotes } = useCoachActions({
    coachBusy,
    runCoach,
    review: review
      ? {
          whiteAcc: review.whiteAcc ?? null,
          blackAcc: review.blackAcc ?? null,
          avgCplW: review.avgCplW ?? null,
          avgCplB: review.avgCplB ?? null,
        }
      : null,
    coachMoments,
    movesCount: movesUci.length,
    openingText,
  });

  const notesForPly = useCoachNotesForPly(ply, coachNotes, moveEvals.length);

  return { review, evalSeries, notesForPly, onGenerateNotes };
}
