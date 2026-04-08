import { describe, it, expect, vi } from 'vitest';
import { createBotPicker } from '../../botPicker.ts';
import type { EngineAdapter, EngineAnalysis } from '../../engine/types';
import { createMulberry32 } from '../../utils/rng';
import { Chess } from '../../chess-compat';

const START_FEN = new Chess().fen();
const noopBook = {
  lookup: () => [],
  pick: () => null,
};

type EngineMock = EngineAdapter & {
  analyse: ReturnType<typeof vi.fn>;
};

function makeEngineMock(responses: EngineAnalysis[] | EngineAnalysis): EngineMock {
  const list = Array.isArray(responses) ? responses.slice() : [responses];
  let call = 0;
  return {
    analyse: vi.fn(() =>
      Promise.resolve(list[Math.min(call++, list.length - 1)])
    ),
    reviewFast: vi.fn(async () => []),
    identifyOpening: vi.fn(async () => null),
    dispose: vi.fn(),
  };
}

describe('createBotPicker', () => {
  it('computes candidate pool drops from engine info', async () => {
    const analysis: EngineAnalysis = {
      sideToMove: 'w',
      infos: [
        { move: 'e2e4', multipv: 1, depth: 12, score: { type: 'cp', value: 80 } },
        { move: 'd2d4', multipv: 2, depth: 12, score: { type: 'cp', value: 50 } },
        { move: 'g1f3', multipv: 3, depth: 12, score: { type: 'cp', value: 20 } },
      ],
    };
    const engine = makeEngineMock(analysis);
    const picker = createBotPicker({
      engine,
      rng: createMulberry32(7),
      book: noopBook,
    });

    const pick = await picker.pickMove({ fen: START_FEN, elo: 1500 });

    expect(engine.analyse).toHaveBeenCalledTimes(1);
    expect(pick.meta.candidatePool).toEqual([
      { move: 'e2e4', cp: 80, drop: 0 },
      { move: 'd2d4', cp: 50, drop: 30 },
      { move: 'g1f3', cp: 20, drop: 60 },
    ]);
    expect(['e2e4', 'd2d4', 'g1f3']).toContain(pick.uci);
  });

  it('bumps MultiPV when engine returns no candidates before succeeding', async () => {
    const responses: EngineAnalysis[] = [
      { sideToMove: 'w', infos: [] },
      {
        sideToMove: 'w',
        infos: [{ move: 'c2c4', multipv: 1, depth: 10, score: { type: 'cp', value: 30 } }],
      },
    ];
    const engine = makeEngineMock(responses);
    const picker = createBotPicker({
      engine,
      rng: createMulberry32(11),
      book: noopBook,
    });

    const pick = await picker.pickMove({ fen: START_FEN, elo: 1600 });

    expect(engine.analyse).toHaveBeenCalledTimes(2);
    expect(pick.uci).toBe('c2c4');
    expect(pick.meta.multipvBumps.length + pick.meta.timeExtensions.length).toBeGreaterThan(0);
  });

  it('respects explicit seeds for reproducible move selection', async () => {
    const analysis: EngineAnalysis = {
      sideToMove: 'w',
      infos: [
        { move: 'g1f3', multipv: 1, depth: 8, score: { type: 'cp', value: 40 } },
        { move: 'c2c4', multipv: 2, depth: 8, score: { type: 'cp', value: 40 } },
      ],
    };
    const engine = makeEngineMock(analysis);
    const picker = createBotPicker({
      engine,
      rng: createMulberry32(1),
      book: noopBook,
    });

    const first = await picker.pickMove({ fen: START_FEN, elo: 1200, seed: 1337 });
    const second = await picker.pickMove({ fen: START_FEN, elo: 1200, seed: 1337 });
    const other = await picker.pickMove({ fen: START_FEN, elo: 1200, seed: 9001 });

    expect(first.uci).toBe(second.uci);
    expect(first.meta.seed).toBe(1337);
    expect(second.meta.seed).toBe(1337);
    expect(other.meta.seed).toBe(9001);
  });
});
