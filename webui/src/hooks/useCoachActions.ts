import { useCallback } from 'react';
import type { CoachInputs } from './useCoach';

export type CoachReviewSummary = {
  whiteAcc: number | null;
  blackAcc: number | null;
  avgCplW: number | null;
  avgCplB: number | null;
} | null;

export type UseCoachActionsArgs = {
  coachBusy: boolean;
  runCoach: (inputs: CoachInputs) => Promise<any>;
  review: CoachReviewSummary;
  coachMoments: CoachInputs['moments'];
  movesCount: number;
  openingText: string | null;
};

export function buildCoachPayload({
  review,
  coachMoments,
  movesCount,
  openingText,
}: {
  review: CoachReviewSummary;
  coachMoments: CoachInputs['moments'];
  movesCount: number;
  openingText: string | null;
}): CoachInputs {
  const summary = review
    ? {
        opening: openingText || undefined,
        whiteAcc: review.whiteAcc ?? undefined,
        blackAcc: review.blackAcc ?? undefined,
        avgCplW: review.avgCplW ?? undefined,
        avgCplB: review.avgCplB ?? undefined,
      }
    : undefined;
  return {
    summary: summary ?? null,
    moments: coachMoments,
    totalPlies: Math.max(1, movesCount),
  };
}

export function useCoachActions({
  coachBusy,
  runCoach,
  review,
  coachMoments,
  movesCount,
  openingText,
}: UseCoachActionsArgs) {
  const onGenerateNotes = useCallback(async () => {
    if (coachBusy) return;
    const payload = buildCoachPayload({ review, coachMoments, movesCount, openingText });
    try {
      await runCoach(payload);
    } catch {
      // Errors bubble via hook state/toasts.
    }
  }, [coachBusy, review, coachMoments, movesCount, runCoach, openingText]);

  return { onGenerateNotes };
}
