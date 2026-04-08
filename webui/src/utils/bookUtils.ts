import { Chess } from '../chess-compat';

export function sameBaseMove(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 4).toLowerCase() === b.slice(0, 4).toLowerCase();
}

export function randomLegalMoveFromFen(fen: string): string | null {
  try {
    const g = new Chess(fen);
    const moves = (g.moves({ verbose: true }) as any[]).map(
      (m) => `${m.from}${m.to}${m.promotion || ''}`
    );
    if (!moves.length) return null;
    const idx = Math.floor(Math.random() * moves.length);
    return moves[idx];
  } catch {
    return null;
  }
}
