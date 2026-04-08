import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectOpeningFromBook } from '../../utils/openingBook';

const MOCK_BOOK = {
  root: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq',
  nodes: {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq': {
      depth: 0,
      moves: [{ uci: 'e2e4', next: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq', w: 1 }],
    },
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq': {
      depth: 1,
      labels: [{ eco: 'C20', name: 'King\'s Pawn Game', variation: 'Open Game' }],
      moves: [{ uci: 'c7c5', next: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq', w: 1 }],
    },
  },
};

describe('detectOpeningFromBook', () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => MOCK_BOOK,
    }));
  });

  it('detects labels and masks that follow the book', async () => {
    const res = await detectOpeningFromBook(['e2e4']);
    expect(res.ready).toBe(true);
    expect(res.mask).toEqual([true]);
    expect(res.depth).toBe(1);
    expect(res.label).toEqual({ eco: 'C20', name: 'King\'s Pawn Game', variation: 'Open Game' });
  });

  it('flags moves outside of book as non-opening', async () => {
    const res = await detectOpeningFromBook(['a2a4']);
    expect(res.mask).toEqual([false]);
    expect(res.depth).toBe(0);
    expect(res.label).toBeNull();
  });
});
