import type { CoachInputs } from '../types/coach';
import type { MoveEval } from '../types/moveEval';
import { useReviewSummary } from './useReviewSummary';
import { useCoachMoments } from './useCoachData';
import { useCoachActions } from './useCoachActions';
import type { GameOverState } from '../types/game';

export type UseReviewAndCoachArgs = {
  moveEvals: MoveEval[];
  movesUci: string[];
  coachBusy: boolean;
  runCoach: (inputs: CoachInputs) => Promise<any>;
  openingText: string | null;
  gameOver: GameOverState | null;
  pgn: string | null;
};

function resultFromGameOver(state: GameOverState | null): string | null {
  if (!state) return null;
  if (state.reason === 'stalemate' || state.reason === 'draw' || state.reason === 'threefold' || state.reason === 'fifty-move' || state.reason === 'insufficient' || state.reason === 'agreement') {
    return '½-½';
  }
  if (state.winner === 'White') return '1-0';
  if (state.winner === 'Black') return '0-1';
  return null;
}

export function useReviewAndCoach({
  moveEvals,
  movesUci,
  coachBusy,
  runCoach,
  openingText,
  gameOver,
  pgn,
}: UseReviewAndCoachArgs) {
  const { review, evalSeries } = useReviewSummary(moveEvals);
  const coachMoments = useCoachMoments(movesUci, moveEvals);
  const resultTag = resultFromGameOver(gameOver);

  const { onGenerateNotes } = useCoachActions({
    coachBusy,
    runCoach,
    review: review
      ? {
          whiteAcc: review.whiteAcc ?? null,
          blackAcc: review.blackAcc ?? null,
          avgCplW: review.avgCplW ?? null,
          avgCplB: review.avgCplB ?? null,
          estEloWhite: review.estEloWhite ?? null,
          estEloBlack: review.estEloBlack ?? null,
          result: resultTag,
        }
      : null,
    coachMoments,
    movesCount: movesUci.length,
    openingText,
    pgn,
  });

  return { review, evalSeries, onGenerateNotes };
}
