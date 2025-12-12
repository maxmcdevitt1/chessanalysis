import { describe, it, expect } from 'vitest';
import { accuracyFromAvgCpl, acplFromAccuracy } from '../ScoreHelpers';

const approx = (value: number | null, target: number, tolerance = 0.2) => {
  expect(value).not.toBeNull();
  expect(Math.abs((value ?? 0) - target)).toBeLessThanOrEqual(tolerance);
};

describe('ScoreHelpers accuracy curve', () => {
  it('matches Lichess anchor samples', () => {
    approx(accuracyFromAvgCpl(91), 70);
    approx(accuracyFromAvgCpl(94), 69);
  });

  it('keeps sane bounds for very strong/weak games', () => {
    const high = accuracyFromAvgCpl(20);
    const mid = accuracyFromAvgCpl(100);
    const low = accuracyFromAvgCpl(200);

    expect(high && high > 95).toBe(true);
    expect(mid && low && mid > low).toBe(true);
    expect(low && low < 55).toBe(true);
  });

  it('round-trips accuracy ⇄ ACPL for key anchors', () => {
    approx(acplFromAccuracy(70), 91, 0.5);
    approx(acplFromAccuracy(69), 94, 0.5);
  });

  it('returns null for invalid inputs', () => {
    expect(accuracyFromAvgCpl(null)).toBeNull();
    expect(acplFromAccuracy(null)).toBeNull();
  });
});
