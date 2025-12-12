import { describe, it, expect } from 'vitest';
import { severityTag } from '../moveAnnotations';

describe('severityTag', () => {
  it('treats small CPL losses as good', () => {
    expect(severityTag(null)).toBe('Review');
    expect(severityTag(20)).toBe('Good');
    expect(severityTag(80)).toBe('Good');
  });

  it('uses more forgiving bands for inaccuracies and mistakes', () => {
    expect(severityTag(120)).toBe('Inaccuracy');
    expect(severityTag(200)).toBe('Mistake');
    expect(severityTag(360)).toBe('Mistake');
    expect(severityTag(500)).toBe('Blunder');
  });
});
