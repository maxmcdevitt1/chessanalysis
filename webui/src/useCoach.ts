// webui/src/useCoach.ts
import { useState } from 'react';
import type { CommentaryBlock, GameSummary, Moment } from './CommentaryService';

export type MoveEvalLite = {
  index: number; moveNo: number; side: 'White'|'Black'; san: string;
  tag?: 'Book'|'Best'|'Good'|'Mistake'|'Blunder';
  cpBefore?: number|null; cpAfter?: number|null;
  dWin?: number|null; best?: string|null;
};

export function useCoachRunner(opts: {
  getMoments: () => Moment[];
  getSummary: () => GameSummary;
  getPgn?: () => string | undefined;
}) {
  const [coach, setCoach] = useState<CommentaryBlock | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachErr, setCoachErr] = useState<string | null>(null);

  async function runCoach() {
    setCoach(null); setCoachErr(null); setCoachBusy(true);
    try {
      const { CommentaryServiceOllama } = await import('./CommentaryServiceOllama');
      const svc = new CommentaryServiceOllama();
      const out = await svc.commentGame({
        pgn: opts.getPgn?.(),
        summary: opts.getSummary(),
        moments: opts.getMoments(),
      });
      setCoach(out);
    } catch (e:any) {
      setCoachErr(String(e?.message || e));
    } finally {
      setCoachBusy(false);
    }
  }

  return { coach, coachBusy, coachErr, runCoach };
}
