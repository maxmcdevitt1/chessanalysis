import { useCallback, useMemo, useRef, useState } from 'react';
import { Chess } from '../chess-compat';
import type { EngineAdapter, EngineAnalysis } from '../engine/types';
import { createOpeningBook } from '../book/bookIndex';
import { bandPlayElo, type StrengthBandId } from '../strengthBands';
import type { MoveEval } from '../types/moveEval';
import { safeMove } from '../utils/chessHelpers';
import {
  bestScoreFromInfos,
  cpFromEval,
  extractScore,
} from '../utils/evalScoring';
import {
  sameBaseMove,
} from '../utils/bookUtils';
import {
  maybeGeniusTag,
  severityTag,
  symbolFor,
} from '../utils/moveAnnotations';
import type { PushToastArgs } from './useToasts';
import type { BatchAnalysisResult } from './useBatchAnalysis';
import { deriveBookMoves } from './useOpeningBookMoves';

export type UseAnalysisControllerArgs = {
  engine: EngineAdapter | null;
  movesUci: string[];
  engineBand: StrengthBandId;
  setMoveEvals: React.Dispatch<React.SetStateAction<MoveEval[]>>;
  batchAnalysis: BatchAnalysisResult;
  notify: (args: PushToastArgs) => number;
  setSuspendEval: (flag: boolean) => void;
};

export type AnalysisController = {
  analyzePgn: () => Promise<void>;
  analyzePgnFast: () => Promise<void>;
  stopAnalyze: () => void;
  analyzing: boolean;
  progress: number | null;
};

/** Build a MoveEval record from White-POV centipawn values. */
function buildMoveRecord(params: {
  index: number;
  mover: 'w' | 'b';
  san: string;
  uci: string;
  best: string | null;
  cpBeforeWhite: number | null;
  cpAfterWhite: number | null;
  mateAfter: number | null;
  cpl: number | null;
  isBookMove: boolean;
  deliveredMate: boolean;
  fenBefore: string;
  fenAfter: string;
}): MoveEval {
  const {
    index, mover, san, uci, best,
    cpBeforeWhite, cpAfterWhite, mateAfter,
    cpl, isBookMove, deliveredMate, fenBefore, fenAfter,
  } = params;

  let tag: MoveEval['tag'];
  if (deliveredMate) tag = 'Best';
  else if (isBookMove) tag = 'Book';
  else if (cpl != null && cpl <= 35 && cpBeforeWhite != null) tag = 'Best';
  else tag = severityTag(cpl);

  const genius = maybeGeniusTag({ mover, cpl, mateAfter, cpBeforeWhite, isBookMove });
  if (genius) tag = genius;

  return {
    index,
    moveNo: Math.floor(index / 2) + 1,
    side: mover === 'w' ? 'White' : 'Black',
    san,
    uci,
    best,
    cpBefore: cpBeforeWhite,
    cpAfterWhite,
    mateAfter,
    cpl,
    tag,
    symbol: symbolFor(tag),
    fenBefore,
    fenAfter,
  };
}

export function useAnalysisController({
  engine,
  movesUci,
  engineBand,
  setMoveEvals,
  batchAnalysis,
  notify,
  setSuspendEval,
}: UseAnalysisControllerArgs): AnalysisController {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const book = useMemo(() => createOpeningBook(), []);

  const cleanup = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    batchAnalysis.cancel();
    engine?.cancelAll?.();
    setAnalyzing(false);
    setSuspendEval(false);
    setProgress(null);
  }, [batchAnalysis, setSuspendEval, engine]);

  const analyzePgn = useCallback(async () => {
    if (!engine) {
      notify({ message: 'Engine unavailable for analysis', variant: 'error' });
      return;
    }
    if (movesUci.length === 0) {
      alert('Load or paste a PGN first');
      return;
    }
    cleanup();
    engine?.cancelAll?.();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSuspendEval(true);
    setAnalyzing(true);
    setProgress(0);
    setMoveEvals([]);

    const results: MoveEval[] = [];
    const g = new Chess();

    try {
      for (let i = 0; i < movesUci.length; i++) {
        if (controller.signal.aborted) break;
        const fenBefore = g.fen();

        let before: EngineAnalysis | null = null;
        try {
          before = await engine.analyse({
            fen: fenBefore,
            multipv: 2,
            movetime: 320,
            signal: controller.signal,
          });
        } catch {
          if (controller.signal.aborted) return;
        }

        const bestScore = bestScoreFromInfos(before?.infos);
        const bestMoveUci = before?.infos?.[0]?.move ?? null;

        const playedUci = movesUci[i];
        const mv = safeMove(g, playedUci);
        const san = mv?.san || '(?)';
        const fenAfter = g.fen();
        const deliveredMate = g.isCheckmate();

        let after: EngineAnalysis | null = null;
        try {
          after = await engine.analyse({
            fen: fenAfter,
            multipv: 2,
            movetime: 260,
            signal: controller.signal,
          });
        } catch {
          if (controller.signal.aborted) return;
        }

        const afterScore = bestScoreFromInfos(after?.infos);
        const mateAfter = (afterScore?.mate != null && Number.isFinite(afterScore.mate)) ? afterScore.mate : null;

        const mover = i % 2 === 0 ? 'w' : 'b';
        const nextSide = mover === 'w' ? 'b' : 'w';

        const beforeCpEngine = cpFromEval(bestScore);  // mover POV
        const afterCpEngine = cpFromEval(afterScore);   // opponent (next mover) POV

        const cpBeforeWhite = beforeCpEngine == null ? null : (mover === 'w' ? beforeCpEngine : -beforeCpEngine);
        let cpAfterWhite = afterCpEngine == null ? null : (nextSide === 'w' ? afterCpEngine : -afterCpEngine);

        // mover-POV CPL
        const beforeForMover = beforeCpEngine;
        const afterForMover = afterCpEngine == null ? null : -afterCpEngine;
        let cpl: number | null = deliveredMate
          ? 0
          : (Number.isFinite(beforeForMover) && Number.isFinite(afterForMover)
              ? Math.max(0, Math.round((beforeForMover as number) - (afterForMover as number)))
              : null);

        if (deliveredMate) {
          cpAfterWhite = mover === 'w' ? 10000 : -10000;
        }

        const seqBefore = movesUci.slice(0, i);
        const candidatesUci = deriveBookMoves(book, seqBefore, fenBefore, mover);
        let isBookMove = Array.isArray(candidatesUci) && candidatesUci.includes(playedUci);
        const playedIsBest = sameBaseMove(playedUci, bestMoveUci);
        if (playedIsBest && cpl == null) cpl = 0;
        if (isBookMove && cpl != null && cpl >= 50) isBookMove = false;

        results.push(buildMoveRecord({
          index: i,
          mover,
          san,
          uci: playedUci,
          best: bestMoveUci,
          cpBeforeWhite,
          cpAfterWhite,
          mateAfter,
          cpl,
          isBookMove,
          deliveredMate,
          fenBefore,
          fenAfter,
        }));

        if (controller.signal.aborted) break;
        setProgress(Math.round(((i + 1) / movesUci.length) * 100));
        if (i % 5 === 0) {
          setMoveEvals([...results]);
          await new Promise((r) => setTimeout(r, 0));
          if (controller.signal.aborted) break;
        }
      }
      if (!controller.signal.aborted) {
        setMoveEvals(results);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[analyzePgn] error', err);
      const msg = err instanceof Error ? err.message : String(err);
      notify({ message: `Analysis failed: ${msg}`, variant: 'error' });
    } finally {
      cleanup();
    }
  }, [engine, movesUci, cleanup, setMoveEvals, notify, setSuspendEval, book]);

  const analyzePgnFast = useCallback(async () => {
    if (!movesUci.length) {
      alert('Load or paste a PGN first');
      return;
    }
    cleanup();
    engine?.cancelAll?.();
    const controller = new AbortController();
    controllerRef.current = controller;

    setSuspendEval(true);
    setAnalyzing(true);
    setProgress(0);
    setMoveEvals([]);

    try {
      const seq: Array<{
        fenBefore: string;
        fenAfter: string;
        uci: string;
        san: string;
        side: 'White' | 'Black';
        isMate: boolean;
      }> = [];
      const g = new Chess();
      for (let i = 0; i < movesUci.length; i++) {
        const fenBefore = g.fen();
        const mv = safeMove(g, movesUci[i]);
        if (!mv) break;
        const fenAfter = g.fen();
        seq.push({
          fenBefore,
          fenAfter,
          uci: movesUci[i],
          san: mv.san || '(?)',
          side: i % 2 === 0 ? 'White' : 'Black',
          isMate: g.isCheckmate(),
        });
      }
      if (!seq.length) return;

      const elo = bandPlayElo(engineBand);
      const results = await batchAnalysis.run({ movesUci, elo, options: { strong: true } });

      const out: MoveEval[] = [];
      for (let i = 0; i < seq.length; i++) {
        if (controller.signal.aborted) break;
        const info = seq[i];
        const cur = results[i];
        const next = results[i + 1];
        const bestMoveUci = cur?.bestMove || null;

        const mover = info.side === 'White' ? 'w' : 'b';
        const nextSide = mover === 'w' ? 'b' : 'w';
        const bestScore = extractScore(cur?.score);
        const afterScore = extractScore(next?.score);
        const mateAfter = (afterScore?.mate != null && Number.isFinite(afterScore.mate)) ? afterScore.mate : null;

        const beforeCpEngine = cpFromEval(bestScore);  // mover POV
        const afterCpEngine = cpFromEval(afterScore);   // opponent (next mover) POV

        const cpBeforeWhite = beforeCpEngine == null ? null : (mover === 'w' ? beforeCpEngine : -beforeCpEngine);
        let cpAfterWhite = afterCpEngine == null ? null : (nextSide === 'w' ? afterCpEngine : -afterCpEngine);

        const beforeForMover = beforeCpEngine;
        const afterForMover = afterCpEngine == null ? null : -afterCpEngine;
        let cpl: number | null = info.isMate
          ? 0
          : (Number.isFinite(beforeForMover) && Number.isFinite(afterForMover)
              ? Math.max(0, Math.round((beforeForMover as number) - (afterForMover as number)))
              : null);

        if (info.isMate) {
          cpAfterWhite = mover === 'w' ? 10000 : -10000;
        }

        const seqBefore = movesUci.slice(0, i);
        const candidatesUci = deriveBookMoves(book, seqBefore, info.fenBefore, mover);
        let isBookMove = Array.isArray(candidatesUci) && candidatesUci.includes(info.uci);
        const playedIsBest = sameBaseMove(info.uci, bestMoveUci);
        if (playedIsBest) {
          if (cpl == null) cpl = 0;
          else cpl = Math.min(cpl, 8);
        }
        if (isBookMove && cpl != null && cpl >= 50) isBookMove = false;

        out.push(buildMoveRecord({
          index: i,
          mover,
          san: info.san,
          uci: info.uci,
          best: bestMoveUci,
          cpBeforeWhite,
          cpAfterWhite,
          mateAfter: info.isMate ? -1 : mateAfter,
          cpl,
          isBookMove,
          deliveredMate: info.isMate,
          fenBefore: info.fenBefore,
          fenAfter: info.fenAfter,
        }));

        if (i % 5 === 0) {
          setProgress(Math.round(((i + 1) / seq.length) * 100));
          setMoveEvals([...out]);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (!controller.signal.aborted) {
        setProgress(100);
        setMoveEvals(out);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[analyzePgnFast] error', err);
      notify({
        message: `Fast analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        variant: 'error',
      });
    } finally {
      cleanup();
    }
  }, [movesUci, cleanup, setMoveEvals, engineBand, batchAnalysis, notify, setSuspendEval, book]);

  const stopAnalyze = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return {
    analyzePgn,
    analyzePgnFast,
    stopAnalyze,
    analyzing,
    progress,
  };
}
