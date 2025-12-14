// Canonical coach-related types shared between hooks, services, and UI.

export type SummaryStats = {
  opening?: string | null;
  whiteAcc?: number | null;
  blackAcc?: number | null;
  avgCplW?: number | null;
  avgCplB?: number | null;
  estEloWhite?: number | null;
  estEloBlack?: number | null;
  result?: string | null;
};

export type MomentItem = {
  index: number; // ply index (0-based)
  moveNo: number;
  side: 'W' | 'B';
  san: string;
  tag: string;
  fenBefore?: string;
  fenAfter?: string;
  cpBefore?: number | null;
  cpAfter?: number | null;
  deltaCp?: number | null;
  best?: string | null;
  bestSan?: string | null;
  evalBeforeLabel?: string | null;
  evalAfterLabel?: string | null;
  phase?: 'opening' | 'middlegame' | 'endgame';
  positionSummary?: string;
  kingSafety?: string;
  materialEdge?: number | null;
  centerSummary?: string;
  structureTag?: string;
  tacticSummary?: string;
  motifs?: string[];
};

export type CoachSections = {
  executiveSummary: string;
  openingReview: string;
  middlegameReview: string;
  endgameReview: string;
  keyMoments: string[];
  lessons: string[];
};

export type CoachMoveNote = {
  moveIndex: number;
  moveNo: number;
  side: 'W' | 'B';
  san: string;
  text: string;
  tag?: string;
  deltaCp?: number | null;
  whyLine?: string | null;
};

export type CoachMomentNote = {
  moveIndex: number;
  moveNo: number;
  side: 'W' | 'B';
  san: string;
  label: 'Best' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder' | 'Book';
  why: string;
  opponentIdea?: string;
  refutation?: string;
  betterPlan?: string;
  principle?: string;
  pv?: string;
  evalBeforeLabel?: string | null;
  evalAfterLabel?: string | null;
};

export type CoachInputs = {
  summary?: SummaryStats | null;
  moments: MomentItem[];
  totalPlies?: number;
  pgn?: string | null;
  evalSummary?: string[];
};

export type CoachResult =
  | { sections: CoachSections; moves?: CoachMoveNote[]; momentNotes?: CoachMomentNote[]; offline?: false }
  | { offline: true; reason?: string; error?: string; sections?: CoachSections; moves?: CoachMoveNote[]; momentNotes?: CoachMomentNote[] };
