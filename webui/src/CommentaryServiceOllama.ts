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
  /**
   * Finalize opening AFTER full analysis.
   * - Extend the opening prefix up to MAX_OPENING_PLIES while |Δcp| <= DELTA_CP_TOL
   *   (so early neutral theory moves that were missed get marked as Book).
   * - Then clamp: remove any later 'Book' tags so opening is a single prefix.
   */
  function finalizeOpeningPrefix(moments: any[], opts?: { MAX_OPENING_PLIES?: number; DELTA_CP_TOL?: number }) {
    if (!Array.isArray(moments) || !moments.length) return;
    const MAX_OPENING_PLIES = opts?.MAX_OPENING_PLIES ?? 20; // 10 full moves
    const DELTA_CP_TOL = opts?.DELTA_CP_TOL ?? 30;           // <= 0.30 pawns considered "book-like"

    let i = 0;
    // 1) Extend prefix while moves are "book-like"
    for (; i < moments.length && i < MAX_OPENING_PLIES; i++) {
      const m = moments[i] || {};
      const tag = (m.tag || '').toString();
      const hasCp = Number.isFinite(m?.cpBefore) && Number.isFinite(m?.cpAfter);
      const delta = hasCp ? Math.abs(m.cpAfter - m.cpBefore) : null;
      const bookLike = tag === 'Book' || (delta != null && delta <= DELTA_CP_TOL);
      if (bookLike) {
        m.tag = 'Book';
        m.isBook = true;
      } else {
        break; // first non-book-like move ends the opening
      }
    }
    // 2) Strip any later 'Book' tags
    for (let j = i; j < moments.length; j++) {
      const m = moments[j];
      if (m && m.tag === 'Book') { m.tag = undefined; m.isBook = false; }
    }
  }

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
    // Sanitize payload after full analysis, before IPC to coach
    finalizeOpeningPrefix(safe.moments);
    if (!window?.electron?.invoke) {
      console.warn('[coach] electron.invoke missing; coach offline');
      return { offline: true };
    }
    const res = await window.electron.invoke('coach:generate', { inputs: safe });
    if (!res) {
      return { offline: true, error: 'no-response' } as any;
    }
    if ((res as any).offline === true) {
      return { offline: true, error: (res as any)?.error || 'offline' } as any;
    }
    if (!Array.isArray((res as any).notes)) return { offline: true, error: 'no-notes' } as any;
    return res as CoachResult;
  } catch (e: any) {
    console.error('[coach/ui] ipc error', e);
    return { offline: true, error: String(e?.message || e) };
  }
}
