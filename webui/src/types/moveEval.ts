import type { UciScore } from '../ScoreHelpers';

export type MoveEval = {
  index: number;
  moveNo: number;
  side: 'White' | 'Black';
  san: string;
  uci: string;
  best?: string | null;
  cpBefore?: number | null;
  cpAfter?: number | null;
  cpAfterWhite?: number | null;
  bestCpBefore?: number | null;
  mateAfter?: number | null;
  afterScore?: UciScore | null;
  cpl?: number | null;
  tag?:
    | 'Genius'
    | 'Best'
    | 'Good'
    | 'Inaccuracy'
    | 'Mistake'
    | 'Blunder'
    | 'Book'
    | 'Review';
  symbol?: '!!' | '!' | '?!' | '!? ' | '?' | '??' | '';
  isBook?: boolean;
  fenBefore: string;
  fenAfter: string;
};

export type BadgeTag = MoveEval['tag'] | 'Book';
