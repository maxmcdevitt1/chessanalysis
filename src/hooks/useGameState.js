// src/hooks/useGameState.js
// Replace the previous file with this content.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// If the project uses chess.js, ensure it is installed: `npm install chess.js`
// Import may be 'chess.js' or 'chess.js'. Adjust according to your package version.
import { Chess } from 'chess.js';

export default function useGameState(initialFen = null) {
  // Keep a mutable chess engine instance in a ref to avoid re-creating or mutating state directly.
  const chessRef = useRef(null);
  const [history, setHistory] = useState([]);
  const [lastMove, setLastMove] = useState(null);

  // initialize chess instance once
  useEffect(() => {
    chessRef.current = new Chess(initialFen || undefined);
    // initialize history from starting position if any
    setHistory([]);
    setLastMove(null);

    return () => {
      // no special cleanup needed for chess.js, but nullify ref to avoid accidental reuse after unmount
      chessRef.current = null;
    };
    // Only run once per mount. If you want initialFen to reinitialize, remove eslint ignore and add initialFen to deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const makeMove = useCallback((move) => {
    // move can be a SAN or an object recognized by chess.js, so avoid mutating state directly.
    if (!chessRef.current) return false;
    const result = chessRef.current.move(move);
    if (result) {
      // copy the SAN into history immutably
      setHistory((prev) => [...prev, result.san]);
      setLastMove(result);
      return true;
    }
    return false;
  }, []);

  const undo = useCallback(() => {
    if (!chessRef.current) return null;
    const undone = chessRef.current.undo();
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      return next;
    });
    setLastMove(null);
    return undone;
  }, []);

  const reset = useCallback((fen) => {
    if (!chessRef.current) {
      chessRef.current = new Chess(fen || undefined);
    } else {
      chessRef.current.load(fen || undefined);
    }
    setHistory([]);
    setLastMove(null);
  }, []);

  const fen = useMemo(() => {
    return chessRef.current ? chessRef.current.fen() : null;
  }, [history]); // recompute FEN when history changes (moves made/undone)

  // Derived convenience values
  const turn = useMemo(() => {
    if (!chessRef.current) return null;
    return chessRef.current.turn();
  }, [history]);

  return {
    makeMove,
    undo,
    reset,
    fen,
    history,
    lastMove,
    turn,
    // expose internal ref only for advanced uses; avoid mutating it externally
    _internal: { chessRef },
  };
}

