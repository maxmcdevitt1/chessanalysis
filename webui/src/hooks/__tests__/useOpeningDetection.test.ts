import { describe, it, expect } from 'vitest';
import { deriveBookDetection } from '../useOpeningDetection';

describe('deriveBookDetection', () => {
  it('derives mask/label from the book index', () => {
    const seed = deriveBookDetection(['e2e4', 'e7e5', 'g1f3']);
    expect(seed.mask.slice(0, 3)).toEqual([true, true, true]);
    expect(seed.depth).toBeGreaterThanOrEqual(3);
    expect(seed.label).toContain('('); // should include ECO code
  });

  it('returns empty data when history is off book', () => {
    const seed = deriveBookDetection(['a2a4', 'b7b5', 'h2h4', 'a7a5']);
    expect(seed.mask).toEqual([false, false, false, false]);
    expect(seed.fallback).toBeNull();
    expect(seed.label).toBe('');
  });
});
