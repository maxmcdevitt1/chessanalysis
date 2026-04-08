import { useCallback, useState } from 'react';
import { generateCoachNotes } from '../CommentaryServiceOllama';
import type { CoachInputs, CoachMoveNote, CoachMomentNote, CoachSections } from '../types/coach';

export function useCoach() {
  const [sections, setSections] = useState<CoachSections | null>(null);
  const [moveNotes, setMoveNotes] = useState<CoachMoveNote[]>([]);
  const [momentNotes, setMomentNotes] = useState<CoachMomentNote[]>([]);
  const [isRunning, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (inputs: CoachInputs) => {
    setRunning(true);
    setError(null);
    try {
      const res = await generateCoachNotes(inputs);
      if (!res || (res as any).offline) {
        const reason = (res as any)?.reason || 'offline';
        setSections(null);
        setMoveNotes([]);
        setMomentNotes([]);
        setError(`Coach unavailable (${reason})`);
        return null;
      }
      setSections(res.sections ?? null);
      setMoveNotes(res.moves ?? []);
      setMomentNotes(res.momentNotes ?? []);
      return res.sections ?? null;
    } catch (err: any) {
      setSections(null);
      setMoveNotes([]);
      setMomentNotes([]);
      setError(err?.message ?? String(err));
      throw err;
    } finally {
      setRunning(false);
    }
  }, []);

  const reset = useCallback(() => {
    setSections(null);
    setMoveNotes([]);
    setMomentNotes([]);
    setError(null);
  }, []);

  return { sections, moveNotes, momentNotes, isRunning, error, run, reset };
}
