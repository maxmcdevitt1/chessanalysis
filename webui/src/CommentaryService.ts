// webui/src/CommentaryService.ts
// Generic interface for commentary providers.

export type Moment = {
  index: number;        // ply index (0-based)
  moveNo: number;       // 1..n
  side: 'White' | 'Black';
  san: string;
  tag: 'Book' | 'Best' | 'Good' | 'Mistake' | 'Blunder';
  cpBefore?: number | null; // white POV (UI)
  cpAfter?: number | null;  // white POV (UI)
  dWin?: number | null;     // optional ΔWin% if you calculate it
  best?: string | null;     // best UCI from MultiPV1
  pv?: string | null;       // optional SAN PV text
};

export type GameSummary = {
  opening?: string | null;
  whiteAcc?: number | null;
  blackAcc?: number | null;
  avgCplW?: number | null;
  avgCplB?: number | null;
};

export type CommentaryBlock = {
  intro: string;  // 2–4 sentences summarizing the game
  perMove: Array<{ ply: number; text: string }>; // one sentence per selected move
  closing: string; // 1–2 sentences about what decided the game
};

export interface CommentaryService {
  commentGame(input: {
    pgn?: string;
    summary: GameSummary;
    moments: Moment[]; // typically all non-book moves (or all moves if you prefer)
  }): Promise<CommentaryBlock>;
}
