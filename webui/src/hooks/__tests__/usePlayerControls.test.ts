import { describe, it, expect, vi } from 'vitest';
import { executeUserMove } from '../usePlayerControls';

const baseArgs = () => ({
  uci: 'e2e4',
  applyMoveWithTrim: vi.fn().mockReturnValue(true),
  markUserMoved: vi.fn(),
  clockRunning: false,
  startClock: vi.fn(),
});

describe('executeUserMove', () => {
  it('marks the user moved and starts the clock after a successful move', () => {
    const args = baseArgs();
    const ok = executeUserMove(args);
    expect(ok).toBe(true);
    expect(args.applyMoveWithTrim).toHaveBeenCalledWith('e2e4');
    expect(args.markUserMoved).toHaveBeenCalled();
    expect(args.startClock).toHaveBeenCalled();
  });

  it('does not restart the clock if it is already running', () => {
    const args = { ...baseArgs(), clockRunning: true };
    executeUserMove(args);
    expect(args.startClock).not.toHaveBeenCalled();
  });

  it('returns false and skips side effects on illegal moves', () => {
    const args = baseArgs();
    args.applyMoveWithTrim.mockReturnValue(false);
    const ok = executeUserMove(args);
    expect(ok).toBe(false);
    expect(args.markUserMoved).not.toHaveBeenCalled();
    expect(args.startClock).not.toHaveBeenCalled();
  });
});
