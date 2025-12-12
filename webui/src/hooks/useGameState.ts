import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from '../chess-compat';
import type { GameOverState } from '../types/game';
import type { ChessInstance } from '../utils/chessHelpers';
import { safeMove, withAutoQueen } from '../utils/chessHelpers';
import { detectGameOverState } from '../utils/gameOutcome';

export type UseGameStateOptions = {
  initialFen?: string;
  initialAutoReply?: boolean;
};

export type UseGameStateReturn = {
  moves: string[];
  fen: string;
  ply: number;
  autoReply: boolean;
  setAutoReply: (value: boolean) => void;
  gameOver: GameOverState | null;
  setGameOver: (state: GameOverState | null) => void;
  applyMove: (uci: string) => boolean;
  jumpToPly: (ply: number) => void;
  reset: () => void;
  loadMoves: (moves: string[]) => void;
  game: ChessInstance;
  fens: string[];
};

export function useGameState(opts: UseGameStateOptions = {}): UseGameStateReturn {
  const [moves, setMoves] = useState<string[]>([]);
  const [ply, setPly] = useState(0);
  const [autoReply, setAutoReply] = useState(opts.initialAutoReply ?? false);
  const [gameOver, setGameOver] = useState<GameOverState | null>(null);
  const gameRef = useRef<ChessInstance>(new Chess(opts.initialFen));
  const [fen, setFen] = useState<string>(gameRef.current.fen());
  const fenCacheRef = useRef<string[]>([fen]);

  const rebuildFenCache = useCallback((list: string[]) => {
    const g = new Chess(opts.initialFen);
    const cache = [g.fen()];
    for (const mv of list) {
      if (!safeMove(g, mv)) break;
      cache.push(g.fen());
    }
    fenCacheRef.current = cache;
  }, [opts.initialFen]);

  const setOutcome = useCallback((state: GameOverState | null) => {
    setGameOver(state);
    if (state) setAutoReply(false);
  }, []);

  const rebuildTo = useCallback((target: number, list?: string[]) => {
    const nextMoves = list ?? moves;
    const g = new Chess(opts.initialFen);
    for (let i = 0; i < target; i++) {
      const mv = nextMoves[i];
      if (!mv) break;
      if (!safeMove(g, mv)) break;
    }
    gameRef.current = g;
    setPly(target);
    const nextFen = g.fen();
    setFen(nextFen);
    const outcome = detectGameOverState(g);
    setOutcome(outcome);
  }, [moves, opts.initialFen, setOutcome]);

  const applyMove = useCallback((uciRaw: string) => {
    if (gameOver) return false;
    const g = gameRef.current;
    const uci = withAutoQueen(uciRaw, g);
    const mv = safeMove(g, uci);
    if (!mv) return false;
    const nextMoves = moves.slice(0, ply).concat([uci]);
    setMoves(nextMoves);
    setPly(nextMoves.length);
    const fenAfter = g.fen();
    setFen(fenAfter);
    fenCacheRef.current = fenCacheRef.current.slice(0, ply + 1).concat([fenAfter]);
    const outcome = detectGameOverState(g);
    setOutcome(outcome);
    return true;
  }, [gameOver, moves, ply, setOutcome]);

  const jumpToPly = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, moves.length));
    rebuildTo(clamped);
  }, [moves.length, rebuildTo]);

  const reset = useCallback(() => {
    const g = new Chess(opts.initialFen);
    gameRef.current = g;
    setMoves([]);
    setPly(0);
    setFen(g.fen());
    setOutcome(null);
    fenCacheRef.current = [g.fen()];
  }, [opts.initialFen, setOutcome]);

  const loadMoves = useCallback((list: string[]) => {
    const sanitized = Array.isArray(list) ? list.filter(Boolean) : [];
    setMoves(sanitized);
    rebuildFenCache(sanitized);
    rebuildTo(sanitized.length, sanitized);
  }, [rebuildFenCache, rebuildTo]);

  const fens = useMemo(() => {
    const cache = fenCacheRef.current;
    if (cache.length <= moves.length + 1) return cache;
    // keep cache trimmed to avoid unbounded growth when branching
    return cache.slice(0, moves.length + 1);
  }, [moves.length]);

  useEffect(() => {
    if (typeof opts.initialAutoReply === 'boolean') {
      setAutoReply(opts.initialAutoReply);
    }
  }, [opts.initialAutoReply]);

  return {
    moves,
    fen,
    ply,
    autoReply,
    setAutoReply,
    gameOver,
    setGameOver: setOutcome,
    applyMove,
    jumpToPly,
    reset,
    loadMoves,
    game: gameRef.current,
    fens,
  };
}
