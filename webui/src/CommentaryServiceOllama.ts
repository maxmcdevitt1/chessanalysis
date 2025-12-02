// Thin web client that packages inputs for the coach and calls Electron via IPC.
import type { SummaryStats, MomentItem } from './types'; // adjust to your actual types

export type CoachInputs = {
  summary: Partial<SummaryStats>;
  moments: MomentItem[];   // must include .index (ply index), .san, .tag, cpBefore, cpAfter, etc.
  pgn?: string;
  totalPlies?: number;     // pass total plies so bridge can clamp moveIndex
};

export type CoachResult = { notes: Array<{ type: 'intro'|'move'|'summary'; text: string; moveIndex?: number }> } | { offline: true };

declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, payload?: any) => Promise<any>;
    };
  }
}

export async function generateCoachNotes(inputs: CoachInputs): Promise<CoachResult> {
  try {
    // Ensure backend can synthesize 1 note PER PLY:
    //  - always pass moments[]
    //  - always pass totalPlies (fallback to movesUci.length or moments.length)
    const moveCount =
      Number.isInteger((inputs as any)?.totalPlies) ? (inputs as any).totalPlies :
      Array.isArray(inputs.moments) ? inputs.moments.length :
      Array.isArray((inputs as any)?.movesUci) ? (inputs as any).movesUci.length : 0;
    const safe = {
      ...inputs,
      moments: Array.isArray(inputs.moments) ? inputs.moments : [],
      totalPlies: Math.max(1, moveCount),
    };
    if (!window?.electron?.invoke) {
      console.warn('[coach] electron.invoke missing; coach offline');
      return { offline: true };
    }
    const res = await window.electron.invoke('coach:generate', { inputs: safe });
    if (!res) return { offline: true };
    if ('offline' in res) return { offline: true };
    if (!Array.isArray(res.notes)) return { offline: true };
    return res as CoachResult;
  } catch {
    return { offline: true };
  }
}
