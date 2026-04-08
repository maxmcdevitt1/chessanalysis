import { useCallback, useEffect, useState } from 'react';
import type { Chess } from '../chess-compat';
import type { GameOverState } from '../types/game';

type ChessInstance = InstanceType<typeof Chess>;

export function useMatchClock({
  game,
  gameOver,
  setGameOver,
  setAutoReply,
}: {
  game: ChessInstance;
  gameOver: GameOverState | null;
  setGameOver: (state: GameOverState | null) => void;
  setAutoReply: (v: boolean) => void;
}) {
  const [timeControlMinutes, setTimeControlMinutes] = useState(10);
  const [clockMs, setClockMs] = useState<{ w: number; b: number }>({ w: 10 * 60000, b: 10 * 60000 });
  const [clockRunning, setClockRunning] = useState(false);
  const [matchStarted, setMatchStarted] = useState(false);

  const resetClocksToStart = useCallback(() => {
    const ms = Math.max(1, timeControlMinutes) * 60000;
    setClockMs({ w: ms, b: ms });
    setClockRunning(false);
    setMatchStarted(false);
  }, [timeControlMinutes]);

  useEffect(() => { resetClocksToStart(); }, [resetClocksToStart]);
  useEffect(() => { if (gameOver) setClockRunning(false); }, [gameOver]);

  useEffect(() => {
    if (!clockRunning || gameOver) return;
    const tickMs = 200;
    const id = setInterval(() => {
      const turn = game.turn?.() === 'b' ? 'b' : 'w';
      setClockMs((prev) => {
        const nextVal = Math.max(0, prev[turn] - tickMs);
        const next = { ...prev, [turn]: nextVal };
        if (nextVal <= 0) {
          const winner = turn === 'w' ? 'Black' : 'White';
          setGameOver({ reason: 'flag', winner });
          setClockRunning(false);
          setAutoReply(false);
        }
        return next;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [clockRunning, gameOver, game, setGameOver, setAutoReply]);

  const startClock = useCallback(() => {
    if (!matchStarted) return;
    setClockRunning(true);
  }, [matchStarted]);

  const pauseClock = useCallback(() => setClockRunning(false), []);
  const markMatchNotStarted = useCallback(() => { setClockRunning(false); setMatchStarted(false); }, []);

  const beginMatch = useCallback(() => {
    if (!matchStarted) {
      resetClocksToStart();
      setMatchStarted(true);
      setGameOver(null);
    }
    setClockRunning(true);
  }, [matchStarted, resetClocksToStart, setGameOver]);

  const resignMatch = useCallback(() => {
    if (gameOver) return;
    const turn = game.turn?.() === 'b' ? 'Black' : 'White';
    const winner = turn === 'White' ? 'Black' : 'White';
    setGameOver({ reason: 'resign', winner });
    setClockRunning(false);
    setAutoReply(false);
  }, [gameOver, game, setGameOver, setAutoReply]);

  return {
    timeControlMinutes,
    setTimeControlMinutes,
    clockMs,
    clockRunning,
    matchStarted,
    startClock,
    pauseClock,
    resetClocksToStart,
    markMatchNotStarted,
    beginMatch,
    resignMatch,
  };
}
