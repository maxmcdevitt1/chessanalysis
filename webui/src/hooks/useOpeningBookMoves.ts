import { useMemo } from 'react';
import { createOpeningBook, type OpeningBook } from '../book/bookIndex';
import { Chess } from '../chess-compat';
import type { Color } from '../types/chess';

export type UseOpeningBookMovesArgs = {
  movesUci: string[];
  ply: number;
  fen: string;
};

export function deriveBookMoves(
  book: OpeningBook,
  history: string[],
  fen: string,
  sideOverride?: Color
): string[] {
  let side: Color;
  if (sideOverride) {
    side = sideOverride;
  } else {
    try {
      const g = new Chess(fen);
      side = g.turn() as Color;
    } catch {
      side = history.length % 2 === 0 ? 'w' : 'b';
    }
  }
  const lines = book.lookup({ side, history });
  if (!lines.length) return [];
  const nextMoves = new Set<string>();
  const idx = history.length;
  for (const line of lines) {
    const uci = line.movesUci[idx];
    if (!uci) continue;
    nextMoves.add(uci);
  }
  return Array.from(nextMoves);
}

export function useOpeningBookMoves({
  movesUci,
  ply,
  fen,
}: UseOpeningBookMovesArgs): string[] {
  const book = useMemo(() => createOpeningBook(), []);
  return useMemo(() => {
    const history = movesUci.slice(0, ply);
    return deriveBookMoves(book, history, fen);
  }, [book, movesUci, ply, fen]);
}
