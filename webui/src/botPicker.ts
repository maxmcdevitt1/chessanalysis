import { Chess } from './chess-compat';
import { createOpeningBook, type OpeningBook } from './book/bookIndex';
import {
  DEFAULT_PICKER_CONFIG,
  type PickerConfig,
  bandFromElo,
  clampElo,
} from './config/picker';
import type { EngineAdapter, EngineInfo } from './engine/types';
import type { Color, UciMove } from './types/chess';
import type { RNG } from './utils/rng';
import { createMathRandomRng, createMulberry32 } from './utils/rng';
import type { PickMeta, PickedMove, PickerCand } from './picker/types';
import type { EngineCand } from './picker/types';

export type Logger = {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

export type CreateBotPickerDeps = {
  engine: EngineAdapter;
  book?: OpeningBook;
  rng?: RNG;
  logger?: Logger;
  config?: PickerConfig;
};

export type PickMoveArgs = {
  fen: string;
  elo: number;
  history?: string[];
  signal?: AbortSignal;
  seed?: number | string;
};

export type PickMetaResult = PickMeta;

// Piecewise elo → target ACPL calibration curve.
const ACPL_TARGETS: Array<[number, number]> = [
  [400,  350],
  [600,  250],
  [800,  175],
  [1000, 125],
  [1200,  90],
  [1400,  60],
  [1600,  42],
  [1800,  26],
  [2000,  15],
  [2200,   7],
  [2500,   3],
];

function targetCplForElo(elo: number): number {
  const e = clampElo(elo);
  if (e <= ACPL_TARGETS[0][0]) return ACPL_TARGETS[0][1];
  for (let i = 0; i < ACPL_TARGETS.length - 1; i++) {
    const [e0, c0] = ACPL_TARGETS[i];
    const [e1, c1] = ACPL_TARGETS[i + 1];
    if (e >= e0 && e <= e1) {
      const t = (e - e0) / (e1 - e0);
      return c0 + t * (c1 - c0);
    }
  }
  return ACPL_TARGETS[ACPL_TARGETS.length - 1][1];
}

/**
 * Laplace-weighted move selection.
 * Weights peak at drop == targetCpl and decay exponentially away from it,
 * naturally producing the right mix of near-best and sub-optimal moves.
 */
function sampleByTargetCpl(cands: EngineCand[], bestCp: number, targetCpl: number, rng: RNG): string {
  if (cands.length === 1) return cands[0].move;
  const temp = Math.max(15, targetCpl * 0.35);
  const weights = cands.map((c) => {
    const drop = Math.max(0, bestCp - c.score.cp);
    return Math.exp(-Math.abs(drop - targetCpl) / temp);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i];
    if (r <= 0) return cands[i].move;
  }
  return cands[cands.length - 1].move;
}

const MOVE_TIME_POINTS: Array<[number, number]> = [
  [400,   75],
  [600,  110],
  [800,  160],
  [1000, 290],
  [1300, 480],
  [1700, 830],
  [2000, 1200],
  [2300, 1600],
  [2500, 1900],
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function movetimeForElo(eloRaw: number, globalCap: number) {
  const e = clampElo(eloRaw);
  for (let i = 0; i < MOVE_TIME_POINTS.length - 1; i++) {
    const [e0, t0] = MOVE_TIME_POINTS[i];
    const [e1, t1] = MOVE_TIME_POINTS[i + 1];
    if (e >= e0 && e <= e1) {
      const k = (e - e0) / (e1 - e0);
      return Math.min(globalCap, Math.round(lerp(t0, t1, k)));
    }
  }
  return Math.min(globalCap, MOVE_TIME_POINTS[MOVE_TIME_POINTS.length - 1][1]);
}

function multiPvForElo(elo: number): number {
  if (elo < 800)  return 6;
  if (elo < 1200) return 5;
  if (elo < 1600) return 4;
  if (elo < 2000) return 3;
  return 2;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
    throw err;
  }
}

function mateToCp(mate: number): number {
  const cp = 10000 - Math.min(99, Math.abs(mate)) * 100;
  return mate >= 0 ? cp : -cp;
}

function scoreToMoverCp(score: { type: 'cp' | 'mate'; value: number }): number {
  if (score.type === 'cp') return score.value;
  return mateToCp(score.value);
}

function toEngineCands(infos: EngineInfo[]): EngineCand[] {
  const bestByMove = new Map<UciMove, EngineCand>();
  for (const entry of infos) {
    if (!entry || typeof entry.move !== 'string' || !entry.score) continue;
    const cp = scoreToMoverCp(entry.score as any);
    if (!Number.isFinite(cp)) continue;
    const cand: EngineCand = { move: entry.move, score: { cp }, pv: entry.pv };
    const prev = bestByMove.get(entry.move);
    if (!prev || prev.score.cp < cand.score.cp) {
      bestByMove.set(entry.move, cand);
    }
  }
  const rows: EngineCand[] = [];
  bestByMove.forEach((value) => rows.push(value));
  rows.sort((a, b) => b.score.cp - a.score.cp);
  return rows;
}

function randomLegalMove(fen: string, rng: RNG, exclude: Set<string> = new Set()): string | null {
  try {
    const game = new Chess(fen);
    const moves = (game.moves({ verbose: true }) as any[])
      .map((m) => `${m.from}${m.to}${m.promotion || ''}`)
      .filter((uci) => !exclude.has(uci));
    if (!moves.length) return null;
    return moves[Math.floor(rng.next() * moves.length)];
  } catch {
    return null;
  }
}

export function createBotPicker(deps: CreateBotPickerDeps) {
  const engine = deps.engine;
  const book = deps.book ?? createOpeningBook();
  const baseRng = deps.rng ?? createMathRandomRng();
  const logger = deps.logger;
  const config = deps.config ?? DEFAULT_PICKER_CONFIG;
  let disposed = false;

  const log = (level: keyof Logger, ...args: unknown[]) => {
    if (logger && typeof logger[level] === 'function') {
      logger[level]!(...args);
    }
  };

  const pickMove = async (args: PickMoveArgs): Promise<PickedMove> => {
    if (disposed) throw new Error('bot picker disposed');
    const history = Array.isArray(args.history) ? args.history : [];
    const fen = args.fen;
    const elo = clampElo(args.elo);
    const band = bandFromElo(elo, config);
    const rng = args.seed != null ? createMulberry32(args.seed) : baseRng;
    const seedValue = args.seed ?? baseRng.seed;

    const game = new Chess(fen);
    const sideToMove: Color = (() => {
      try { return game.turn() as Color; } catch { return 'w'; }
    })();

    const ms = movetimeForElo(elo, config.globalTimeCapMs);
    const multiPv = multiPvForElo(elo);
    const targetCpl = targetCplForElo(elo);

    const meta: PickMeta = {
      seed: seedValue,
      band: band.id,
      historyLength: history.length,
      msBudget: ms,
      multipv: multiPv,
      k: 0,
      maxDrop: 0,
      dropRelaxations: [],
      multipvBumps: [],
      timeExtensions: [],
      usedBook: false,
      candidatePool: [],
      evalDrops: [],
      temperature: targetCpl,
    };
    const startAt = Date.now();

    const finalize = (result: PickedMove): PickedMove => {
      log('info', '[picker]', {
        band: band.id,
        reason: result.reason,
        ms,
        multipv: multiPv,
        targetCpl,
        historyLen: history.length,
        candidateCount: meta.candidatePool.length,
        usedBook: meta.usedBook,
        elapsedMs: Date.now() - startAt,
        aborted: !!args.signal?.aborted,
      });
      return result;
    };

    throwIfAborted(args.signal);

    const favorCommon = elo < 1400;
    const bookPick = book.pick({
      side: sideToMove,
      history,
      fen,
      maxPlies: band.book.maxPlies ?? config.defaultBookMaxPlies,
      topLines: band.book.topLines,
      favorCommon,
      rng,
      exitEarly: band.book.exitEarly,
    });
    if (bookPick) {
      meta.usedBook = true;
      meta.bookLine = { eco: bookPick.line.eco, name: bookPick.line.name, variation: bookPick.line.variation };
      return finalize({
        uci: bookPick.move,
        reason: `book:${bookPick.line.name || bookPick.line.eco}`,
        meta,
      });
    }

    throwIfAborted(args.signal);

    const analysis = await engine.analyse({
      fen,
      multipv: multiPv,
      movetime: ms,
      signal: args.signal,
    });

    throwIfAborted(args.signal);

    const cands = toEngineCands(analysis.infos);
    if (!cands.length) {
      const fallback = randomLegalMove(fen, rng);
      if (fallback) return finalize({ uci: fallback, reason: 'engine:fallback', meta });
      throw new Error('engine returned no candidates');
    }

    const bestCp = cands[0].score.cp;
    meta.candidatePool = cands.map((c) => ({ move: c.move, cp: c.score.cp, drop: Math.max(0, bestCp - c.score.cp) }));
    meta.evalDrops = meta.candidatePool.slice(0, 5).map((c) => ({ move: c.move, drop: c.drop }));

    const move = sampleByTargetCpl(cands, bestCp, targetCpl, rng);
    return finalize({ uci: move, reason: 'engine:laplace', meta });
  };

  const dispose = () => { disposed = true; };

  return { pickMove, dispose };
}
