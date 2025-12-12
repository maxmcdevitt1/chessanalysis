import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { GameOverState } from '../types/game';
import type { MoveEval } from '../types/moveEval';

export type ExecuteUserMoveArgs = {
  uci: string;
  applyMoveWithTrim: (uci: string) => boolean;
  markUserMoved: () => void;
  clockRunning: boolean;
  startClock: () => void;
};

export function executeUserMove({
  uci,
  applyMoveWithTrim,
  markUserMoved,
  clockRunning,
  startClock,
}: ExecuteUserMoveArgs): boolean {
  const ok = applyMoveWithTrim(uci);
  if (ok) {
    markUserMoved();
    if (!clockRunning) startClock();
  }
  return ok;
}

export type UsePlayerControlsArgs = {
  applyMoveWithTrim: (uci: string) => boolean;
  markUserMoved: () => void;
  clockRunning: boolean;
  startClock: () => void;
  pauseClock: () => void;
  setGameOver: (state: GameOverState | null) => void;
  setAutoReply: (value: boolean) => void;
  gameOver: GameOverState | null;
  beginMatch: () => void;
  resignMatch: () => void;
  resetGameState: () => void;
  resetClocksToStart: () => void;
  markMatchNotStarted: () => void;
  setMoveEvals: Dispatch<SetStateAction<MoveEval[]>>;
  onUserMove?: () => void;
};

export function usePlayerControls({
  applyMoveWithTrim,
  markUserMoved,
  clockRunning,
  startClock,
  pauseClock,
  setGameOver,
  setAutoReply,
  gameOver,
  beginMatch,
  resignMatch,
  resetGameState,
  resetClocksToStart,
  markMatchNotStarted,
  setMoveEvals,
  onUserMove,
}: UsePlayerControlsArgs) {
  const onUserDrop = useCallback(
    (from: string, to: string) => {
      const ok = executeUserMove({
        uci: `${from}${to}`,
        applyMoveWithTrim,
        markUserMoved,
        clockRunning,
        startClock,
      });
      if (ok) onUserMove?.();
      return ok;
    },
    [applyMoveWithTrim, markUserMoved, clockRunning, startClock, onUserMove]
  );

  const onApplyBookMove = useCallback(
    (uci: string) => {
      const ok = executeUserMove({
        uci,
        applyMoveWithTrim,
        markUserMoved,
        clockRunning,
        startClock,
      });
      if (ok) onUserMove?.();
    },
    [applyMoveWithTrim, markUserMoved, clockRunning, startClock, onUserMove]
  );

  const onOfferDraw = useCallback(() => {
    if (gameOver) return;
    setGameOver({ reason: 'agreement', winner: null });
    setAutoReply(false);
    pauseClock();
  }, [gameOver, setGameOver, setAutoReply, pauseClock]);

  const onBeginMatch = useCallback(() => {
    beginMatch();
  }, [beginMatch]);

  const onResign = useCallback(() => {
    resignMatch();
  }, [resignMatch]);

  const onNewGame = useCallback(() => {
    resetGameState();
    setMoveEvals([]);
    setGameOver(null);
    resetClocksToStart();
    markMatchNotStarted();
    onUserMove?.();
  }, [resetGameState, setMoveEvals, setGameOver, resetClocksToStart, markMatchNotStarted, onUserMove]);

  return {
    onUserDrop,
    onApplyBookMove,
    onOfferDraw,
    onBeginMatch,
    onResign,
    onNewGame,
  };
}
