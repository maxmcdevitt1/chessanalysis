import { describe, it, expect } from 'vitest';
import { extractMovesFromPgn } from '../usePgnImport';

describe('extractMovesFromPgn', () => {
  it('converts a PGN into UCI moves', () => {
    const text = `
      [Event "Casual"]
      [Site "?"]

      1. e4 e5 2. Nf3 Nc6 3. Bb5 a6
    `;
    const moves = extractMovesFromPgn(text);
    expect(moves).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6']);
  });

  it('returns an empty array for blank input', () => {
    expect(extractMovesFromPgn('   ')).toEqual([]);
  });
});
