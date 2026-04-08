import { Chess } from '../chess-compat';
import type { Square } from '../chess-compat';

export type ChessInstance = InstanceType<typeof Chess>;

export function uciToMove(uci: string) {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = (uci[4] as any) || undefined;
  return { from, to, promotion };
}

export function safeMove(game: ChessInstance, uci: string) {
  try {
    const obj = uciToMove(uci) as any;
    return (Chess as any).prototype.move.call(game, obj);
  } catch {
    return null;
  }
}

export function withAutoQueen(uci: string, game: ChessInstance): string {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const p = game.get(from);
  if (!p || p.type !== 'p') return uci;
  if ((p.color === 'w' && to[1] === '8') || (p.color === 'b' && to[1] === '1')) {
    if (uci.length === 4) return uci + 'q';
  }
  return uci;
}
