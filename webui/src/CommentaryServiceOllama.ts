// Thin web client that packages inputs for the coach and calls Electron via IPC.
import type { CoachInputs, CoachResult } from './types/coach';

declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, payload?: any) => Promise<any>;
    };
  }
}

export async function generateCoachNotes(inputs: CoachInputs): Promise<CoachResult> {
  try {
    const safe = {
      summary: inputs.summary ?? null,
      moments: Array.isArray(inputs.moments) ? inputs.moments : [],
      totalPlies: Math.max(1, inputs.totalPlies ?? (inputs.moments?.length ?? 1)),
      pgn: inputs.pgn ?? null,
      evalSummary: Array.isArray(inputs.evalSummary) ? inputs.evalSummary : [],
    };
    if (!window?.electron?.invoke) {
      console.warn('[coach] electron.invoke missing; coach offline');
      return { offline: true };
    }
    const res = await window.electron.invoke('coach:generate', { inputs: safe });
    if (!res) return { offline: true, reason: 'no-response' } as any;
    if ((res as any).offline === true) return { offline: true, reason: (res as any).reason || 'offline' } as any;
    if (!res.sections) return { offline: true, reason: 'no-sections' } as any;
    return {
      ...(res as CoachResult),
      moves: Array.isArray(res.moves) ? res.moves : [],
      momentNotes: Array.isArray((res as any).momentNotes) ? (res as any).momentNotes : [],
    };
  } catch (e: any) {
    console.error('[coach/ui] ipc error', e);
    return { offline: true, error: String(e?.message || e) };
  }
}
