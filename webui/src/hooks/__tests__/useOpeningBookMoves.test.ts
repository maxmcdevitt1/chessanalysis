import { describe, it, expect, vi } from 'vitest';
import { deriveBookMoves } from '../useOpeningBookMoves';
import type { Color } from '../../types/chess';
import type { OpeningBook } from '../../book/bookIndex';

function makeBook(lines: string[][]): OpeningBook {
  return {
    lookup: vi.fn().mockReturnValue(
      lines.map((moves) => ({ movesUci: moves }))
    ),
    pick: vi.fn(),
  } as unknown as OpeningBook;
}

describe('deriveBookMoves', () => {
  it('returns unique next moves for the given history', () => {
    const book = makeBook([
      ['e2e4', 'e7e5', 'g1f3'],
      ['e2e4', 'c7c5', 'g1f3'],
    ]);
    const moves = deriveBookMoves(book, ['e2e4'], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(moves.sort()).toEqual(['c7c5', 'e7e5']);
  });

  it('falls back to history parity when FEN is invalid', () => {
    const lookup = vi.fn().mockReturnValue([{ movesUci: ['e2e4'] }]);
    const book = { lookup, pick: vi.fn() } as unknown as OpeningBook;
    const moves = deriveBookMoves(book, [], 'invalid fen');
    expect(lookup).toHaveBeenCalledWith({ side: 'w', history: [] });
    expect(moves).toEqual(['e2e4']);
  });

  it('returns an empty list when the book has no candidates', () => {
    const book = { lookup: vi.fn().mockReturnValue([]), pick: vi.fn() } as unknown as OpeningBook;
    const moves = deriveBookMoves(book, ['e2e4'], 'fen');
    expect(moves).toEqual([]);
  });

  it('honours the side override when provided', () => {
    const lookup = vi.fn().mockImplementation(({ side }: { side: Color }) => {
      if (side === 'b') return [{ movesUci: ['d2d4', 'g7g6'] }];
      return [];
    });
    const book = { lookup, pick: vi.fn() } as unknown as OpeningBook;
    const moves = deriveBookMoves(book, ['d2d4'], 'fen', 'b');
    expect(lookup).toHaveBeenCalledWith({ side: 'b', history: ['d2d4'] });
    expect(moves).toEqual(['g7g6']);
  });
});
