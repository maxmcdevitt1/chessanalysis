import { useCallback } from 'react';
import type { CoachInputs } from '../types/coach';

export type CoachReviewSummary = {
  whiteAcc: number | null;
  blackAcc: number | null;
  avgCplW: number | null;
  avgCplB: number | null;
  estEloWhite?: number | null;
  estEloBlack?: number | null;
  result?: string | null;
} | null;

export type UseCoachActionsArgs = {
  coachBusy: boolean;
  runCoach: (inputs: CoachInputs) => Promise<any>;
  review: CoachReviewSummary;
  coachMoments: CoachInputs['moments'];
  movesCount: number;
  openingText: string | null;
  pgn: string | null;
};

function buildEvalSummary(moments: CoachInputs['moments']) {
  const enriched = moments.map((m) => {
    const before = Number(m?.cpBefore);
    const after = Number(m?.cpAfter);
    const delta = Number.isFinite(before) && Number.isFinite(after) ? after - before : null;
    return { ...m, delta, absDelta: delta == null ? 0 : Math.abs(delta) };
  });
  enriched.sort((a, b) => (b.absDelta || 0) - (a.absDelta || 0));
  const top = enriched.filter((m) => (m.absDelta || 0) >= 40).slice(0, 12);
  return top.map((m) => {
    const mover = m.side === 'W' ? 'White' : 'Black';
    const phase = m.phase || 'middlegame';
    const tag = m.tag || 'Move';
    const deltaStr = m.delta != null ? `${m.delta > 0 ? '+' : ''}${Math.round(m.delta)} cp` : 'n/a';
    const best = m.best ? `Better idea: ${m.best}.` : '';
    return `Move ${m.moveNo} (${mover} ${m.san}) [${tag}] in the ${phase} shifted eval ${deltaStr}. ${best}`.trim();
  });
}

export function buildCoachPayload({
  review,
  coachMoments,
  movesCount,
  openingText,
  pgn,
}: {
  review: CoachReviewSummary;
  coachMoments: CoachInputs['moments'];
  movesCount: number;
  openingText: string | null;
  pgn: string | null;
}): CoachInputs {
  const summary = review
    ? {
        opening: openingText || undefined,
        whiteAcc: review.whiteAcc ?? undefined,
        blackAcc: review.blackAcc ?? undefined,
        avgCplW: review.avgCplW ?? undefined,
        avgCplB: review.avgCplB ?? undefined,
        estEloWhite: review.estEloWhite ?? undefined,
        estEloBlack: review.estEloBlack ?? undefined,
        result: review.result ?? undefined,
      }
    : undefined;
  return {
    summary: summary ?? null,
    moments: coachMoments,
    totalPlies: Math.max(1, movesCount),
    pgn: pgn ?? undefined,
    evalSummary: buildEvalSummary(coachMoments),
  };
}

export function useCoachActions({
  coachBusy,
  runCoach,
  review,
  coachMoments,
  movesCount,
  openingText,
  pgn,
}: UseCoachActionsArgs) {
  const onGenerateNotes = useCallback(async () => {
    if (coachBusy) return;
    const payload = buildCoachPayload({ review, coachMoments, movesCount, openingText, pgn });
    try {
      await runCoach(payload);
    } catch {
      // Errors bubble via hook state/toasts.
    }
  }, [coachBusy, review, coachMoments, movesCount, runCoach, openingText, pgn]);

  return { onGenerateNotes };
}
