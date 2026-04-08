import { Chess } from './chess-compat';
import { createOpeningBook, type OpeningBook } from './book/bookIndex';
import {
  DEFAULT_PICKER_CONFIG,
  type PickerConfig,
  bandFromElo,
  clampElo,
  devBandIncludes,
  imperfectionForElo,
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

type DevState = {
  avgGap: number | null;
  kScale: number;
  dropAdj: number;
  lastHistoryLen: number;
};

const MOVE_TIME_POINTS: Array<[number, number]> = [
  [400, 120],
  [600, 160],
  [800, 210],
  [1000, 320],
  [1300, 500],
  [1700, 850],
  [2000, 1200],
  [2300, 1600],
  [2500, 1900],
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function movetimeForElo(eloRaw: number) {
  const e = clampElo(eloRaw);
  for (let i = 0; i < MOVE_TIME_POINTS.length - 1; i++) {
    const [e0, t0] = MOVE_TIME_POINTS[i];
    const [e1, t1] = MOVE_TIME_POINTS[i + 1];
    if (e >= e0 && e <= e1) {
      const k = (e - e0) / (e1 - e0);
      return Math.round(lerp(t0, t1, k));
    }
  }
  return MOVE_TIME_POINTS[MOVE_TIME_POINTS.length - 1][1];
}

function multiPvFor(elo: number, ms: number, config: PickerConfig) {
  const band = bandFromElo(elo, config);
  if (ms < 80) return 1;
  let mpv =
    band.id === 'beginner' ? (ms < 200 ? 3 : 4) :
    band.id === 'developing' ? (ms < 250 ? 5 : 6) :
    band.id === 'intermediate' ? (ms < 260 ? 3 : 5) :
    band.id === 'advanced' ? 2 : 1;
  const bandMin =
    band.id === 'beginner' ? 4 :
    band.id === 'developing' ? 5 :
    band.id === 'intermediate' ? 3 :
    1;
  mpv = Math.max(mpv, bandMin);
  return Math.min(mpv, band.multipvCap);
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
  const rows: EngineCand[] = [];
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
    const idx = Math.floor(rng.next() * moves.length);
    return moves[idx];
  } catch {
    return null;
  }
}

function devReset(): DevState {
  return { avgGap: null, kScale: 1, dropAdj: 0, lastHistoryLen: 0 };
}

function devTuneState(state: DevState, elo: number, historyLen: number, cfg: PickerConfig) {
  if (historyLen <= 1 || historyLen < state.lastHistoryLen || !devBandIncludes(elo, cfg)) {
    state.avgGap = null;
    state.kScale = 1;
    state.dropAdj = 0;
  }
  state.lastHistoryLen = historyLen;
}

function devPhaseWeight(historyLen: number, cfg: PickerConfig): number {
  if (historyLen <= 0) return 1;
  const span = Math.max(1, cfg.devBand.phase.maxPlies);
  if (historyLen >= span) return 0;
  return clamp((span - historyLen) / span, 0, 1);
}

function devTuning(
  state: DevState,
  params: { elo: number; ms: number; multiPv: number; baseMaxDrop: number; baseK: number; historyLen: number },
  cfg: PickerConfig
) {
  if (!devBandIncludes(params.elo, cfg)) {
    return { ms: params.ms, multiPv: params.multiPv, maxDrop: params.baseMaxDrop, k: params.baseK };
  }
  const tuned = { ...params };
  const dev = cfg.devBand;
  let tunedMs = Math.max(tuned.ms, cfg.devBand.phase.maxMs);
  let tunedMpv = Math.min(tuned.multiPv, dev.phase.multiPvCap);
  const dropAdj = clamp(state.dropAdj, dev.minDrop - params.baseMaxDrop, dev.maxDrop - params.baseMaxDrop);
  let drop = clamp(params.baseMaxDrop + dropAdj, dev.minDrop, dev.maxDrop);
  let kBase = params.baseK * state.kScale;
  const phase = devPhaseWeight(params.historyLen, cfg);
  if (phase > 0) {
    tunedMs = Math.min(tunedMs, dev.phase.maxMs);
    tunedMpv = Math.min(tunedMpv, dev.phase.multiPvCap);
    drop = Math.min(dev.maxDrop, drop + phase * dev.phase.extraDrop);
    const kScale = 1 - (1 - dev.phase.kScale) * phase;
    kBase *= kScale;
  }
  const [kMin, kMax] = cfg.devBand.kRangeScale.map((v) => v * params.baseK) as [number, number];
  const k = clamp(kBase, kMin, kMax);
  return { ms: tunedMs, multiPv: tunedMpv, maxDrop: drop, k };
}

function devUpdateAfterPick(state: DevState, gapCp: number, cfg: PickerConfig) {
  const dev = cfg.devBand;
  state.avgGap = Number.isFinite(state.avgGap)
    ? (state.avgGap! * 0.9 + gapCp * 0.1)
    : gapCp;
  if (!Number.isFinite(state.avgGap)) return;
  const err = dev.targetGapCp - state.avgGap!;
  if (!Number.isFinite(err) || Math.abs(err) < 1) return;
  const adjust = clamp(err / dev.targetGapCp, -1, 1);
  const nextK = state.kScale - adjust * dev.kAdjustStep;
  const nextDropAdj = state.dropAdj + adjust * dev.dropAdjustStep;
  state.kScale = clamp(nextK, dev.kRangeScale[0], dev.kRangeScale[1]);
  state.dropAdj = clamp(nextDropAdj, dev.minDrop - dev.maxDrop, dev.maxDrop - dev.minDrop);
}

function devNoisyPick(cands: PickerCand[], bestCp: number, rng: RNG, cfg: PickerConfig): string | null {
  if (!cands.length) return null;
  if (rng.next() > cfg.devBand.noiseRate) return null;
  const dropList = cands
    .map((c) => ({ ...c, drop: bestCp - c.score.cp }))
    .filter((c) => c.drop >= cfg.devBand.noiseMinDrop)
    .sort((a, b) => b.drop - a.drop);
  if (!dropList.length) return null;
  const span = Math.min(dropList.length, cfg.devBand.noiseTake);
  const pick = dropList[Math.floor(rng.next() * span)];
  return pick?.move ?? null;
}

function devForcedRandom(fen: string, cands: PickerCand[], bestCp: number, rng: RNG, cfg: PickerConfig): string | null {
  if (!cands.length) return null;
  if (rng.next() > cfg.devBand.forcedRandomRate) return null;
  const drops = cands
    .map((c) => ({ ...c, drop: bestCp - c.score.cp }))
    .filter((c) => c.drop >= cfg.devBand.forcedRandomMinDrop)
    .sort((a, b) => b.drop - a.drop);
  if (drops.length) return drops[0].move;
  const exclude = new Set(cands.map((c) => c.move));
  return randomLegalMove(fen, rng, exclude);
}

function maybeImperfectMove(fen: string, cands: PickerCand[], bestCp: number, elo: number, rng: RNG, cfg: PickerConfig): { move: string; reason: string } | null {
  const profile = imperfectionForElo(elo, cfg);
  if (!profile) return null;
  if (rng.next() > profile.rate) return null;
  const sorted = cands
    .map((c) => ({ ...c, drop: bestCp - c.score.cp }))
    .filter((c) => c.drop > 0)
    .sort((a, b) => b.drop - a.drop);
  const targetPool = sorted.filter(
    (c) => c.drop >= profile.minDrop && (profile.maxDrop <= 0 || c.drop <= profile.maxDrop)
  );
  const selectionPool = targetPool.length ? targetPool : sorted;
  if (selectionPool.length) {
    const span = Math.max(1, Math.min(selectionPool.length, profile.takeWorst));
    const pool = selectionPool.slice(0, span);
    const pick = pool[Math.floor(rng.next() * pool.length)];
    if (pick) return { move: pick.move, reason: 'imperfection:drop' };
  }
  if (profile.randomLegalRate > 0 && rng.next() < profile.randomLegalRate) {
    const exclude = new Set(cands.map((c) => c.move));
    const random = randomLegalMove(fen, rng, exclude);
    if (random) return { move: random, reason: 'imperfection:randomLegal' };
  }
  return null;
}

export function createBotPicker(deps: CreateBotPickerDeps) {
  const engine = deps.engine;
  const book = deps.book ?? createOpeningBook();
  const baseRng = deps.rng ?? createMathRandomRng();
  const logger = deps.logger;
  const config = deps.config ?? DEFAULT_PICKER_CONFIG;
  let disposed = false;
  const devState: DevState = devReset();

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
    const meta: PickMeta = {
      seed: seedValue,
      band: band.id,
      historyLength: history.length,
      msBudget: 0,
      multipv: 0,
      k: 0,
      maxDrop: 0,
      dropRelaxations: [],
      multipvBumps: [],
      timeExtensions: [],
      usedBook: false,
      candidatePool: [],
      evalDrops: [],
      temperature: 0,
    };
    const startAt = Date.now();
    const msBudget = Math.min(movetimeForElo(elo), config.globalTimeCapMs);
    let ms = Math.max(band.movetimeFloorMs, msBudget);
    let multiPvBudget = multiPvFor(elo, ms, config);
    const baseMaxDrop = band.baseMaxDrop;
    let k = band.k;
    if (devBandIncludes(elo, config)) {
      devTuneState(devState, elo, history.length, config);
      const tuned = devTuning(devState, {
        elo,
        ms,
        multiPv: multiPvBudget,
        baseMaxDrop,
        baseK: band.k,
        historyLen: history.length,
      }, config);
      ms = tuned.ms;
      multiPvBudget = tuned.multiPv;
      meta.maxDrop = tuned.maxDrop;
      k = tuned.k;
    } else {
      devState.lastHistoryLen = history.length;
      meta.maxDrop = baseMaxDrop;
    }
    meta.msBudget = ms;
    meta.multipv = multiPvBudget;
    meta.k = k;
    meta.temperature = k;

    throwIfAborted(args.signal);

    let widenedDrop = meta.maxDrop;
    const dropSteps = band.widening.dropStepsCp.slice();
    const multipvSteps = band.widening.multiPvIncrements.slice();
    const timeSteps = band.widening.timeExtensionsMs.slice();
    let currentMultiPv = multiPvBudget;
    let currentMs = ms;

    const finalize = (result: PickedMove): PickedMove => {
      const payload = {
        band: band.id,
        reason: result.reason,
        msBudget: meta.msBudget,
        finalMs: currentMs,
        multipv: currentMultiPv,
        dropCap: meta.maxDrop,
        historyLen: history.length,
        widenedDropSteps: meta.dropRelaxations.length,
        multipvBumps: meta.multipvBumps.length,
        timeExtensions: meta.timeExtensions.length,
        candidateCount: meta.candidatePool.length,
        usedBook: meta.usedBook,
        elapsedMs: Date.now() - startAt,
        aborted: !!args.signal?.aborted,
      };
      log('info', '[picker]', payload);
      return result;
    };

    const favorCommon = band.id === 'beginner' || band.id === 'developing' || band.id === 'intermediate';
    const bookExit = band.book.exitEarly ?? (devBandIncludes(elo, config) ? config.devBand.bookExit : undefined);
    const bookPick = book.pick({
      side: sideToMove,
      history,
      fen,
      maxPlies: band.book.maxPlies ?? config.defaultBookMaxPlies,
      topLines: band.book.topLines,
      favorCommon,
      rng,
      exitEarly: bookExit,
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

    let pickerPool: PickerCand[] = [];
    let bestCp = 0;
    while (true) {
      throwIfAborted(args.signal);
      const analysis = await engine.analyse({
        fen,
        multipv: currentMultiPv,
        movetime: currentMs,
        signal: args.signal,
      });
      throwIfAborted(args.signal);
      const cands = toEngineCands(analysis.infos);
      if (!cands.length) {
        if (multipvSteps.length) {
          const inc = multipvSteps.shift()!;
          currentMultiPv = Math.min(band.multipvCap, currentMultiPv + inc);
          meta.multipvBumps.push(currentMultiPv);
          continue;
        }
        if (timeSteps.length) {
          const next = Math.min(config.globalTimeCapMs, currentMs + timeSteps.shift()!);
          if (next !== currentMs) {
            currentMs = next;
            meta.timeExtensions.push(currentMs);
          }
          continue;
        }
        break;
      }

      bestCp = cands[0].score.cp;
      const pool = cands.map((cand) => ({
        ...cand,
        drop: Math.max(0, bestCp - cand.score.cp),
      }));
      meta.candidatePool = pool.map((c) => ({ move: c.move, cp: c.score.cp, drop: c.drop }));
      meta.evalDrops = pool.slice(0, 5).map((c) => ({ move: c.move, drop: c.drop }));

      pickerPool = pool.filter((cand) => cand.drop <= widenedDrop);
      if (pickerPool.length) break;

      if (dropSteps.length) {
        const extra = dropSteps.shift()!;
        widenedDrop += extra;
        meta.dropRelaxations.push(extra);
        pickerPool = pool.filter((cand) => cand.drop <= widenedDrop);
        if (pickerPool.length) break;
      }

      if (multipvSteps.length) {
        const inc = multipvSteps.shift()!;
        currentMultiPv = Math.min(band.multipvCap, currentMultiPv + inc);
        meta.multipvBumps.push(currentMultiPv);
        continue;
      }
      if (timeSteps.length) {
        const next = Math.min(config.globalTimeCapMs, currentMs + timeSteps.shift()!);
        if (next !== currentMs) {
          currentMs = next;
          meta.timeExtensions.push(currentMs);
        }
        continue;
      }
      pickerPool = pool;
      break;
    }
    meta.maxDrop = widenedDrop;

    if (!pickerPool.length) {
      const fallback = randomLegalMove(fen, rng);
      if (fallback) {
        return finalize({ uci: fallback, reason: 'engine:fallback', meta });
      }
      throw new Error('engine returned no candidates');
    }

    const devBand = devBandIncludes(elo, config);
    if (devBand) {
      const forced = devForcedRandom(fen, pickerPool, bestCp, rng, config);
      if (forced) {
        meta.usedImperfection = 'dev-forced';
        return finalize({ uci: forced, reason: 'engine:devForced', meta });
      }
      const noisy = devNoisyPick(pickerPool, bestCp, rng, config);
      if (noisy) {
        meta.usedImperfection = 'dev-noise';
        return finalize({ uci: noisy, reason: 'engine:devNoise', meta });
      }
    }

    const imperfect = maybeImperfectMove(fen, pickerPool, bestCp, elo, rng, config);
    if (imperfect) {
      meta.usedImperfection = imperfect.reason;
      return finalize({ uci: imperfect.move, reason: `engine:${imperfect.reason}`, meta });
    }

    const weights = pickerPool.map((cand) => Math.exp(-k * Math.max(0, cand.drop)));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    let choice = pickerPool[pickerPool.length - 1];
    for (let i = 0; i < pickerPool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        choice = pickerPool[i];
        break;
      }
    }
    if (devBand) {
      devUpdateAfterPick(devState, bestCp - choice.score.cp, config);
    }
    return finalize({
      uci: choice.move,
      reason: 'engine:weighted',
      meta,
    });
  };

  const dispose = () => {
    disposed = true;
  };

  return { pickMove, dispose };
}
