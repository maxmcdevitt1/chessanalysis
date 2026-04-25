import { describe, it, expect } from 'vitest';
import { severityTag } from '../moveAnnotations';

describe('severityTag', () => {
  it('treats small CPL losses as good', () => {
    expect(severityTag(null)).toBe('Review');
    expect(severityTag(5)).toBe('Good');
    expect(severityTag(10)).toBe('Good');
  });

  it('classifies inaccuracies, mistakes, and blunders correctly', () => {
    // 11–49 → Inaccuracy
    expect(severityTag(20)).toBe('Inaccuracy');
    expect(severityTag(49)).toBe('Inaccuracy');
    // 50–149 → Mistake
    expect(severityTag(50)).toBe('Mistake');
    expect(severityTag(149)).toBe('Mistake');
    // ≥ 150 → Blunder
    expect(severityTag(150)).toBe('Blunder');
    expect(severityTag(500)).toBe('Blunder');
  });
});
