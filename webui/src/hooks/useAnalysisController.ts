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
  evalForMover,
  extractScore,
  lastScoreCp,
} from '../utils/evalScoring';
import {
  sameBaseMove,
} from '../utils/bookUtils';
import {
  cpAfterWhiteValue,
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

        const beforeCpEngine = cpFromEval(bestScore); // POV = mover (side to move before)
        const afterCpEngine = cpFromEval(afterScore); // POV = opponent (side to move after)

        const beforeForMover = beforeCpEngine;
        const afterForMover = afterCpEngine == null ? null : -afterCpEngine; // flip opponent POV to mover POV
        const bestForMover = beforeForMover;

        const cpBeforeWhite =
          beforeCpEngine == null ? null : (mover === 'w' ? beforeCpEngine : -beforeCpEngine);
        // Store cpAfter as opponent POV; also keep White POV.
        let cpAfterStored = afterCpEngine;
        let cpAfterWhite =
          afterCpEngine == null ? null : (nextSide === 'w' ? afterCpEngine : -afterCpEngine);

        let cpl: number | null = deliveredMate
          ? 0
          : (Number.isFinite(beforeForMover) && Number.isFinite(afterForMover)
              ? Math.max(0, Math.round((beforeForMover as number) - (afterForMover as number)))
              : null);
        if (deliveredMate) {
          cpAfterStored = mover === 'w' ? -10000 : 10000;
          cpAfterWhite = mover === 'w' ? 10000 : -10000;
        }

        const seqBefore = movesUci.slice(0, i);
        const candidatesUci = deriveBookMoves(book, seqBefore, fenBefore, mover);
        let isBookMove = Array.isArray(candidatesUci) && candidatesUci.includes(playedUci);
        const playedIsBest = sameBaseMove(playedUci, bestMoveUci);
        // If engine agrees the move is best, only fill missing CPL; avoid clamping real loss.
        if (playedIsBest && cpl == null) cpl = 0;
        // If the move dumps significant CPL, don't treat it as book even if it appears in the tree.
        if (isBookMove && cpl != null && cpl >= 50) isBookMove = false;

        const bestCpBeforeMover = Number.isFinite(bestForMover) ? bestForMover : null;

        let tag: MoveEval['tag'];
        if (deliveredMate) tag = 'Best';
        else if (isBookMove) tag = 'Book';
        else if (playedIsBest && (cpl == null || cpl <= 35) && bestCpBeforeMover != null) tag = 'Best';
        else tag = severityTag(cpl);

        const genius = maybeGeniusTag({
          mover,
          cpl,
          mateAfter,
          cpBeforeWhite,
          isBookMove,
        });
        if (genius) tag = genius;

        const symbol = symbolFor(tag);

        results.push({
          index: i,
          moveNo: Math.floor(i / 2) + 1,
          side: mover === 'w' ? 'White' : 'Black',
          san,
          uci: playedUci,
          best: bestMoveUci,
          cpBefore: cpBeforeWhite,
          cpAfter: cpAfterStored,
          // optional convenience for charts expecting White POV:
          cpAfterWhite: cpAfterWhite,
          bestCpBefore: bestCpBeforeMover,
          mateAfter,
          cpl,
          tag,
          symbol,
          fenBefore,
          fenAfter,
        });

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

        const afterForNext = evalForMover(afterScore, nextSide);

        const beforeCpEngine = cpFromEval(bestScore); // POV = mover (side to move before)
        const afterCpEngine = cpFromEval(afterScore);  // POV = opponent (side to move after)

        const cpBeforeWhite =
          beforeCpEngine == null ? null : (mover === 'w' ? beforeCpEngine : -beforeCpEngine);
        let cpAfterStored = afterCpEngine;
        let cpAfterWhite =
          afterCpEngine == null ? null : (nextSide === 'w' ? afterCpEngine : -afterCpEngine);

        const beforeForMover = beforeCpEngine;
        const afterForMover = afterCpEngine == null ? null : -afterCpEngine; // flip opponent POV to mover POV
        const bestForMover = beforeForMover;

        let cpl: number | null = info.isMate
          ? 0
          : (Number.isFinite(beforeForMover) && Number.isFinite(afterForMover)
              ? Math.max(0, Math.round((beforeForMover as number) - (afterForMover as number)))
              : null);
        if (info.isMate) {
          cpAfterStored = mover === 'w' ? -10000 : 10000;
          cpAfterWhite = mover === 'w' ? 10000 : -10000;
        }

        const bestCpBeforeMover = Number.isFinite(bestForMover) ? bestForMover : null;
        const seqBefore = movesUci.slice(0, i);
        const candidatesUci = deriveBookMoves(book, seqBefore, info.fenBefore, mover);
        let isBookMove = Array.isArray(candidatesUci) && candidatesUci.includes(info.uci);
        const playedIsBest = sameBaseMove(info.uci, bestMoveUci);
        // Avoid flagging best-line moves as blunders when the after-eval is noisy.
        if (playedIsBest) {
          if (cpl == null) cpl = 0;
          else cpl = Math.min(cpl, 8);
        }
        // Do not mark as book if CPL is large even when tree contains it.
        if (isBookMove && cpl != null && cpl >= 50) isBookMove = false;

        let tag: MoveEval['tag'];
        if (info.isMate) tag = 'Best';
        else if (isBookMove) tag = 'Book';
        else if (playedIsBest && (cpl == null || cpl <= 35) && bestCpBeforeMover != null) tag = 'Best';
        else tag = severityTag(cpl);

        const genius = maybeGeniusTag({
          mover,
          cpl,
          mateAfter: info.isMate ? -1 : mateAfter,
          cpBeforeWhite,
          isBookMove,
        });
        if (genius) tag = genius;

        const symbol = symbolFor(tag);

        const afterScoreObj =
          (afterScore?.mate != null && Number.isFinite(afterScore.mate))
            ? ({ type: 'mate', value: afterScore.mate } as const)
            : (Number.isFinite(afterForNext)
                ? ({ type: 'cp', value: afterForNext } as const)
                : null);

        out.push({
          index: i,
          moveNo: Math.floor(i / 2) + 1,
          side: info.side,
          san: info.san,
          uci: info.uci,
          best: bestMoveUci,
          cpBefore: cpBeforeWhite,
          cpAfter: cpAfterStored,
          // optional white-POV value for display components
          cpAfterWhite,
          afterScore: afterScoreObj,
          bestCpBefore: bestCpBeforeMover,
          mateAfter,
          cpl,
          tag,
          symbol,
          fenBefore: info.fenBefore,
          fenAfter: info.fenAfter,
        });

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
