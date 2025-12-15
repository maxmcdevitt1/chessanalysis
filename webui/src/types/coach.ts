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

export type CoachSectionBlock =
  | { title: 'Executive Summary'; text: string }
  | { title: 'Opening Review'; text: string }
  | { title: 'Middlegame Review'; text: string }
  | { title: 'Endgame Review'; text: string }
  | { title: 'Key Moments & Turning Points'; bullets: string[] }
  | { title: 'Three Most Important Lessons'; bullets: string[] };

export type CoachSections = {
  executive: { text: string };
  opening: { text: string };
  middlegame: { text: string };
  endgame: { text: string };
  keyMoments: { bullets: string[] };
  lessons: { bullets: string[] };
};

export type CoachGate = {
  isQuiet: boolean;
  allowWhy: boolean;
  allowDetails: boolean;
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
  bubbleTitle?: string | null;
  gate?: CoachGate;
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
  gate?: CoachGate;
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
