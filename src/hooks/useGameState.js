// src/hooks/useGameState.js
import { useState, useMemo, useCallback } from "react";
import { Chess, SQUARES } from "chess.js";

/* ---------------------------------------------------
   Generate legal moves for Chessground
--------------------------------------------------- */
const calcDests = (game) => {
  const dests = new Map();
  const squares = SQUARES || [];

  squares.forEach((square) => {
    const moves = game.moves({ square, verbose: true });
    if (moves.length > 0) {
      dests.set(
        square,
        moves.map((m) => m.to)
      );
    }
  });

  return dests;
};

/* ---------------------------------------------------
   Clean PGN input (remove headers, comments, NAGs, etc.)
--------------------------------------------------- */
const sanitizePgn = (rawPgn) => {
  let clean = rawPgn
    .replace(/\[.*?\]/g, "") // headers
    .replace(/\{.*?\}/g, "") // comments
    .replace(/\(.*?\)/g, "") // variations
    .replace(/\$\d+/g, "") // NAGs
    .replace(/\s+/g, " ") // normalize spaces
    .trim();

  return clean;
};

/* ---------------------------------------------------
   Main hook
--------------------------------------------------- */
export default function useGameState() {
  // A stable chess instance across renders
  const game = useMemo(() => new Chess(), []);

  // Current position
  const [fen, setFen] = useState(game.fen());

  // Array of all FEN positions in move history
  const [moveHistory, setMoveHistory] = useState([game.fen()]);

  // SAN moves list
  const [pgnMoves, setPgnMoves] = useState([]);

  // Index into moveHistory (0 = start position)
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);

  // Legal moves for Chessground
  const [possibleMoves, setPossibleMoves] = useState(calcDests(game));

  // Whose turn is it?
  const turnColor = fen.includes(" w ") ? "white" : "black";

  /* ---------------------------------------------------
     Load a PGN file or pasted PGN string
  --------------------------------------------------- */
  const loadPgn = useCallback(
    (pgnText) => {
      // First try raw PGN
      let loaded = game.loadPgn(pgnText);

      if (!loaded) {
        // Try cleaned PGN wrapped with dummy header
        const clean = sanitizePgn(pgnText);
        loaded = game.loadPgn(`[Event "?"]\n\n${clean}`);
      }

      if (!loaded) {
        throw new Error("Failed to parse PGN");
      }

      const headers = game.header();
      const hasCustomStart = headers.SetUp === "1" && headers.FEN;
      const startFen = hasCustomStart ? headers.FEN : new Chess().fen();

      // Build move history and FEN list manually from the parsed PGN
      const verbose = game.history({ verbose: true });
      const replay = new Chess(startFen);
      const fens = [replay.fen()];
      const moves = [];

      verbose.forEach((move) => {
        replay.move(move);
        moves.push(move.san);
        fens.push(replay.fen());
      });

      // Update state
      setMoveHistory(fens);
      setPgnMoves(moves);
      setFen(fens[0]);
      setCurrentMoveIndex(0);

      // Reset main game to starting position of PGN and compute moves
      game.load(startFen);
      setPossibleMoves(calcDests(game));
    },
    [game]
  );

  /* ---------------------------------------------------
     When user drags a piece on the board
  --------------------------------------------------- */
  const onMove = useCallback(
    (from, to) => {
      const legal = game.move({ from, to });
      if (!legal) return;

      const newFen = game.fen();

      // Append new position to history
      const nextHistory = [
        ...moveHistory.slice(0, currentMoveIndex + 1),
        newFen,
      ];

      const nextPgn = [
        ...pgnMoves.slice(0, currentMoveIndex),
        legal.san,
      ];

      setMoveHistory(nextHistory);
      setPgnMoves(nextPgn);
      setCurrentMoveIndex(nextHistory.length - 1);
      setFen(newFen);
      setPossibleMoves(calcDests(game));
    },
    [game, moveHistory, pgnMoves, currentMoveIndex]
  );

  /* ---------------------------------------------------
     Navigate through moves (-1 back, +1 forward)
  --------------------------------------------------- */
  const navigate = useCallback(
    (direction) => {
      const idx = currentMoveIndex + direction;

      if (idx < 0 || idx >= moveHistory.length) return;

      const nextFen = moveHistory[idx];
      setCurrentMoveIndex(idx);
      setFen(nextFen);

      game.load(nextFen);
      setPossibleMoves(calcDests(game));
    },
    [currentMoveIndex, moveHistory, game]
  );

  /* ---------------------------------------------------
     Expose everything needed by the app
  --------------------------------------------------- */
  return {
    fen,
    moveHistory,
    pgnMoves,
    currentMoveIndex,
    possibleMoves,
    turnColor,
    loadPgn,
    navigate,
    onMove,
  };
}
