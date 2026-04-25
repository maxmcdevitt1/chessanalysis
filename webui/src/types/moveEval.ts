export type MoveEval = {
  index: number;
  moveNo: number;
  side: 'White' | 'Black';
  san: string;
  uci: string;
  best?: string | null;
  /** White-POV centipawns before the move (engine best). */
  cpBefore?: number | null;
  /** White-POV centipawns after the played move. */
  cpAfterWhite?: number | null;
  mateAfter?: number | null;
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
