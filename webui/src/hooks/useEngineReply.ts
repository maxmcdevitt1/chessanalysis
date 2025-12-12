import { useCallback, useEffect, useRef } from 'react';
import type { Chess } from '../chess-compat';
import type { StrengthBandId } from '../strengthBands';
import { bandPlayElo } from '../strengthBands';
import { randomLegalMoveFromFen } from '../utils/bookUtils';
import type { PushToastArgs } from './useToasts';

type PickMoveFn = (args: {
  fen: string;
  elo: number;
  history: string[];
  timeoutMs: number;
}) => Promise<{ uci: string } | null>;

export type UseEngineReplyOptions = {
  engineBand: StrengthBandId;
  movesUci: string[];
  ply: number;
  fenFallback: string;
  game: Chess;
  pickMove: PickMoveFn;
  engineBusy: boolean;
  autoReply: boolean;
  gameOver: boolean;
  clockRunning: boolean;
  startClock: () => void;
  applyMoveWithTrim: (uci: string) => boolean;
  setEngineError: (msg: string | null) => void;
  pushToast: (args: PushToastArgs) => number;
  setSuspendEval: (value: boolean) => void;
};

export function useEngineReply({
  engineBand,
  movesUci,
  ply,
  fenFallback,
  game,
  pickMove,
  engineBusy,
  autoReply,
  gameOver,
  clockRunning,
  startClock,
  applyMoveWithTrim,
  setEngineError,
  pushToast,
  setSuspendEval,
}: UseEngineReplyOptions) {
  const userMovedRef = useRef(false);

  const markUserMoved = useCallback(() => {
    userMovedRef.current = true;
  }, []);

  const engineMove = useCallback(async () => {
    if (engineBusy || gameOver) return;
    await executeEngineMove({
      engineBand,
      movesUci,
      ply,
      getFen: () => game.fen(),
      fallbackFen: fenFallback,
      pickMove,
      applyMoveWithTrim,
      clockRunning,
      startClock,
      setEngineError,
      pushToast,
    });
  }, [
    engineBusy,
    gameOver,
    engineBand,
    movesUci,
    ply,
    game,
    fenFallback,
    pickMove,
    applyMoveWithTrim,
    clockRunning,
    startClock,
    setEngineError,
    pushToast,
  ]);

  useEffect(() => {
    if (!autoReply) return;
    if (!userMovedRef.current) return;
    if (engineBusy) return;
    if (gameOver) return;
    userMovedRef.current = false;
    let active = true;
    setSuspendEval(true);
    (async () => {
      try {
        await engineMove();
      } finally {
        if (active) setSuspendEval(false);
      }
    })();
    return () => {
      active = false;
      setSuspendEval(false);
    };
  }, [autoReply, engineBusy, gameOver, engineMove, setSuspendEval, ply]);

  return { engineMove, markUserMoved };
}

export type ExecuteEngineMoveOptions = {
  engineBand: StrengthBandId;
  movesUci: string[];
  ply: number;
  getFen: () => string;
  fallbackFen: string;
  pickMove: PickMoveFn;
  applyMoveWithTrim: (uci: string) => boolean;
  clockRunning: boolean;
  startClock: () => void;
  setEngineError: (msg: string | null) => void;
  pushToast: (args: PushToastArgs) => number;
  randomMove?: (fen: string) => string | null;
};

export async function executeEngineMove({
  engineBand,
  movesUci,
  ply,
  getFen,
  fallbackFen,
  pickMove,
  applyMoveWithTrim,
  clockRunning,
  startClock,
  setEngineError,
  pushToast,
  randomMove = randomLegalMoveFromFen,
}: ExecuteEngineMoveOptions) {
  try {
    setEngineError(null);
    let fenNow: string;
    try {
      fenNow = getFen();
    } catch {
      fenNow = fallbackFen;
    }

    const elo = bandPlayElo(engineBand);
    const history = movesUci.slice(0, ply);
    const timeoutMs = Math.max(8000, 2000 + (elo || 0));
    let result: Awaited<ReturnType<typeof pickMove>> | null = null;
    try {
      result = await pickMove({ fen: fenNow, elo, history, timeoutMs });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : err?.message ?? 'Engine picker failed';
      console.error('[engineMove] picker error', err);
      setEngineError(msg || 'Engine picker failed');
    }

    let uci = result?.uci || '';
    if (!uci) {
      const fallback = randomMove(fenNow);
      if (fallback) {
        console.warn('[engineMove] using fallback legal move', fallback);
        uci = fallback;
        pushToast({ message: 'Engine timed out — using a random legal move.', variant: 'warning' });
      }
    }

    if (!uci) {
      pushToast({ message: 'Engine failed to find a legal move.', variant: 'error' });
      return;
    }
    const ok = applyMoveWithTrim(uci);
    if (ok && clockRunning === false) startClock();
  } catch (err) {
    console.error('[engineMove] error', err);
    const msg = err instanceof Error ? err.message : String(err);
    setEngineError(msg);
    pushToast({ message: `Engine error: ${msg}`, variant: 'error' });
  }
}
