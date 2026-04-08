import { describe, it, expect } from 'vitest';
import { buildCoachPayload } from '../useCoachActions';

describe('buildCoachPayload', () => {
  it('populates summary when review data is provided', () => {
    const payload = buildCoachPayload({
      review: { whiteAcc: 80, blackAcc: 70, avgCplW: 40, avgCplB: 60 },
      coachMoments: [{ index: 0, moveNo: 1, side: 'W', san: 'e4', tag: 'Best' }],
      movesCount: 6,
      openingText: 'Italian Game',
      pgn: '1. e4 e5',
    });
    expect(payload.summary).toEqual(
      expect.objectContaining({
        opening: 'Italian Game',
        whiteAcc: 80,
        avgCplB: 60,
      })
    );
    expect(payload.totalPlies).toBe(6);
  });

  it('falls back to null summary and clamps total plies to ≥1', () => {
    const payload = buildCoachPayload({
      review: null,
      coachMoments: [],
      movesCount: 0,
      openingText: null,
      pgn: null,
    });
    expect(payload.summary).toBeNull();
    expect(payload.totalPlies).toBe(1);
  });
});
