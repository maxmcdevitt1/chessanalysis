import { useCallback, useState } from 'react';
import { generateCoachNotes } from '../CommentaryServiceOllama';

export type CoachNote =
  | { type: 'intro'; text: string }
  | { type: 'move'; moveIndex: number; text: string }
  | { type: 'summary'; text: string };

export type CoachInputs = {
  summary?: {
    opening?: string;
    whiteAcc?: number | null;
    blackAcc?: number | null;
    avgCplW?: number | null;
    avgCplB?: number | null;
  } | null;
  moments: Array<{
    index: number;
    moveNo: number;
    side: 'W' | 'B';
    san: string;
    tag: string;
    cpBefore?: number | null;
    cpAfter?: number | null;
    best?: string | null;
  }>;
  totalPlies?: number;
};

export function useCoach() {
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const [isRunning, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (inputs: CoachInputs) => {
    setRunning(true);
    setError(null);
    try {
      const res = await generateCoachNotes(inputs);
      if (!res || (res as any).offline) {
        const reason = (res as any)?.reason || 'offline';
        setNotes([]);
        setError(`Coach unavailable (${reason})`);
        return null;
      }
      const list = Array.isArray(res.notes) ? res.notes : [];
      setNotes(list as CoachNote[]);
      return list;
    } catch (err: any) {
      setNotes([]);
      setError(err?.message ?? String(err));
      throw err;
    } finally {
      setRunning(false);
    }
  }, []);

  const reset = useCallback(() => {
    setNotes([]);
    setError(null);
  }, []);

  return { notes, isRunning, error, run, reset };
}
