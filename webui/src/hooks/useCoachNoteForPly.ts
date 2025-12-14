import { useMemo } from 'react';
import type { CoachMomentNote, CoachMoveNote } from '../types/coach';

export function useCoachNoteForPly(ply: number, notes: CoachMoveNote[] | null | undefined) {
  return useMemo(() => {
    const arr = Array.isArray(notes) ? notes : [];
    if (!arr.length || ply <= 0) return null;
    const idx = Math.max(0, ply - 1);
    return arr.find((n) => n.moveIndex === idx) || null;
  }, [ply, notes]);
}

export function useCoachMomentNoteForPly(ply: number, notes: CoachMomentNote[] | null | undefined) {
  return useMemo(() => {
    const arr = Array.isArray(notes) ? notes : [];
    if (!arr.length || ply <= 0) return null;
    const idx = Math.max(0, ply - 1);
    return arr.find((n) => n.moveIndex === idx) || null;
  }, [ply, notes]);
}
