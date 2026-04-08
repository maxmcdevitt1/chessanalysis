import type { ChessInstance } from './chessHelpers';
import type { GameOverState } from '../types/game';

export function detectGameOverState(game: ChessInstance): GameOverState | null {
  if (game.isGameOver && !game.isGameOver()) return null;
  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'Black' : 'White';
    return { reason: 'checkmate', winner };
  }
  if (game.isStalemate()) return { reason: 'stalemate', winner: null };
  if (game.isInsufficientMaterial()) return { reason: 'insufficient', winner: null };
  if (game.isThreefoldRepetition()) return { reason: 'threefold', winner: null };
  if (game.isDraw()) return { reason: 'draw', winner: null };
  return null;
}
