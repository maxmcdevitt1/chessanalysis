import { describe, it, expect, vi } from 'vitest';

vi.mock('../../data/beginneropenings.json', () => ({
  default: {
    openings: [
      {
        name: 'Italian Game',
        eco: 'C50',
        side: 'White',
        lines: [
          { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
          { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
        ],
      },
    ],
  },
}));

import { bookMaskForHistory, bookLineForHistory } from '../bookIndex';

describe('bookIndex helpers', () => {
  it('returns a mask that stays true while moves follow the book', () => {
    const mask = bookMaskForHistory(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6']);
    expect(mask).toEqual([true, true, true, true, true, false]);
  });

  it('returns the deepest line metadata for a history prefix', () => {
    const line = bookLineForHistory(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(line?.name).toBe('Italian Game');
    expect(line?.eco).toBe('C50');
  });
});
