import { describe, it, expect, vi } from 'vitest';
import { executeEngineMove } from '../useEngineReply';
import type { StrengthBandId } from '../../strengthBands';

function createBaseArgs(overrides: Partial<Parameters<typeof executeEngineMove>[0]> = {}) {
  const defaults = {
    engineBand: 'club' as StrengthBandId,
    movesUci: ['e2e4'],
    ply: 1,
    getFen: () => 'fen-main',
    fallbackFen: 'fen-fallback',
    pickMove: vi.fn().mockResolvedValue({ uci: 'c7c5' }),
    applyMoveWithTrim: vi.fn().mockReturnValue(true),
    clockRunning: false,
    startClock: vi.fn(),
    setEngineError: vi.fn(),
    pushToast: vi.fn(),
    randomMove: vi.fn().mockReturnValue(null),
  };
  return Object.assign(defaults, overrides);
}

describe('executeEngineMove', () => {
  it('applies the move returned by the picker', async () => {
    const args = createBaseArgs();
    await executeEngineMove(args);
    expect(args.applyMoveWithTrim).toHaveBeenCalledWith('c7c5');
    expect(args.startClock).toHaveBeenCalled();
    expect(args.pushToast).not.toHaveBeenCalled();
  });

  it('falls back to a random legal move when picker yields nothing', async () => {
    const args = createBaseArgs({
      pickMove: vi.fn().mockResolvedValue(null),
      randomMove: vi.fn().mockReturnValue('g1f3'),
    });
    await executeEngineMove(args);
    expect(args.applyMoveWithTrim).toHaveBeenCalledWith('g1f3');
    expect(args.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'warning' })
    );
  });

  it('surfaces an error toast when no move is available', async () => {
    const args = createBaseArgs({
      pickMove: vi.fn().mockResolvedValue(null),
      randomMove: vi.fn().mockReturnValue(null),
    });
    await executeEngineMove(args);
    expect(args.applyMoveWithTrim).not.toHaveBeenCalled();
    expect(args.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error' })
    );
  });
});
