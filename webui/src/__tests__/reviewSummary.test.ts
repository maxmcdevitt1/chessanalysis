import { describe, expect, it } from 'vitest';
import { deriveReviewSummary, type RollingStore } from '../utils/reviewSummary';
import type { MoveEval } from '../types/moveEval';

class MemoryStore implements RollingStore {
  #values: number[];
  constructor(initial: number[] = []) {
    this.#values = [...initial];
  }

  read() {
    return [...this.#values];
  }

  write(values: number[]) {
    this.#values = [...values];
  }
}

function makeMove(partial: Partial<MoveEval>): MoveEval {
  return {
    index: partial.index ?? 0,
    moveNo: partial.moveNo ?? 1,
    side: partial.side ?? 'White',
    san: partial.san ?? 'e4',
    uci: partial.uci ?? 'e2e4',
    fenBefore: partial.fenBefore ?? 'fen',
    fenAfter: partial.fenAfter ?? 'fen',
    ...partial,
  } as MoveEval;
}

describe('deriveReviewSummary', () => {
  it('summarises CPL and updates rolling history', () => {
    const store = new MemoryStore([5, 10]);
    // White: cpBefore=40, cpAfterWhite=20 → CPL=20
    // Black: cpBefore=30, cpAfterWhite=0  → CPL=0 (max(0, 0-30)=0, no improvement counted)
    const moves: MoveEval[] = [
      makeMove({
        index: 0,
        moveNo: 1,
        side: 'White',
        san: 'e4',
        cpBefore: 40,
        cpAfterWhite: 20,
        tag: 'Mistake',
      }),
      makeMove({
        index: 1,
        moveNo: 1,
        side: 'Black',
        san: 'e5',
        cpBefore: 30,
        cpAfterWhite: 0,
        tag: 'Best',
      }),
    ];

    const { summary, rollingHistory } = deriveReviewSummary(moves, { store });
    expect(summary).not.toBeNull();
    expect(summary?.avgCplW).toBe(20);
    expect(summary?.avgCplB).toBe(0);
    expect(summary?.quality.W.mistake).toBe(1);
    expect(summary?.quality.B.best).toBe(1);
    expect(summary?.rollingSamples).toBe(4);
    expect(rollingHistory).toEqual([5, 10, 20, 0]);
  });

  it('trims rolling history to the configured sample size', () => {
    const store = new MemoryStore([1, 2, 3]);
    // White: cpBefore=30, cpAfterWhite=10 → CPL=20
    // Black: cpBefore=15, cpAfterWhite=25 → CPL=10 (max(0, 25-15)=10)
    const moves: MoveEval[] = [
      makeMove({
        index: 0,
        moveNo: 1,
        side: 'White',
        cpBefore: 30,
        cpAfterWhite: 10,
      }),
      makeMove({
        index: 1,
        moveNo: 1,
        side: 'Black',
        cpBefore: 15,
        cpAfterWhite: 25,
      }),
    ];

    const { summary, rollingHistory } = deriveReviewSummary(moves, { store, maxSamples: 3 });
    expect(summary).not.toBeNull();
    expect(summary?.rollingSamples).toBe(3);
    expect(rollingHistory).toEqual([3, 20, 10]);
  });
});
