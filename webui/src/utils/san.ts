import { Chess, MoveLike } from '../chess-compat';
function uciToMove(uci: string) {
  const from = uci.slice(0,2);
  const to   = uci.slice(2,4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  return { from, to, promotion } as Partial<MoveLike>;
}

export function computeSANForHistory(uciHistory: string[]): string[] {
  const chess = new Chess();
  const san: string[] = [];
  for (const uci of uciHistory) {
    const move = chess.move(uciToMove(uci));
    if (!move) { san.push('??'); continue; }
    san.push(move.san);
  }
  return san;
}
