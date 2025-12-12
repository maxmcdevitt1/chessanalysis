export type GameOverState = {
  reason: 'checkmate' | 'stalemate' | 'threefold' | 'fifty-move' | 'insufficient' | 'draw' | 'agreement' | 'flag' | 'resign';
  winner?: 'White' | 'Black' | null;
};
