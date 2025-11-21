// src/hooks/useGameState.js

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';

export default function useGameState(initialFen = null) {
  const chessRef = useRef(null);
  const [history, setHistory] = useState([]); // Array of SAN moves
  const [fenHistory, setFenHistory] = useState(['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1']); // Array of FEN strings
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);

  // Initialize chess instance once
  useEffect(() => {
    // Initialize Chess.js
    chessRef.current = new Chess(initialFen || undefined); 
    setHistory([]);
    setFenHistory([chessRef.current.fen()]);
    setCurrentMoveIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Function to update FEN history and current index
  const updateStateAfterMove = useCallback((newFen, moveSan) => {
    setHistory(prev => [...prev, { san: moveSan, color: chessRef.current.turn() === 'b' ? 'w' : 'b' }]);
    setFenHistory(prev => [...prev, newFen]);
    setCurrentMoveIndex(prev => prev + 1);
  }, []);

  // Handler for making a move (used by the Board component)
  const onMove = useCallback((source, target) => {
    if (!chessRef.current) return false;

    // Temporarily load the current position to make the move
    const currentFen = fenHistory[currentMoveIndex];
    chessRef.current.load(currentFen);

    try {
        const result = chessRef.current.move({ from: source, to: target, promotion: 'q' }); // Assume queen promotion
        if (result) {
            updateStateAfterMove(chessRef.current.fen(), result.san);
            return true;
        }
    } catch (e) {
        console.warn("Illegal move attempted:", e);
    }
    return false;
  }, [fenHistory, currentMoveIndex, updateStateAfterMove]);

  // Handler for loading a PGN file
  const loadPgn = useCallback((pgnText) => {
    if (!chessRef.current) return;
    
    // 1. Create a new, fresh engine for loading
    const tempChess = new Chess();
    if (tempChess.loadPgn(pgnText)) {
        // 2. Extract move and FEN history
        const moves = tempChess.history({ verbose: true });
        
        // 3. Reset the engine to the start and record FENs
        tempChess.reset();
        const newFenHistory = [tempChess.fen()];
        const newMoveHistory = [];
        
        moves.forEach(move => {
            tempChess.move(move);
            newFenHistory.push(tempChess.fen());
            newMoveHistory.push({ san: move.san, color: move.color });
        });
        
        // 4. Update state to reflect the new game
        chessRef.current.load(newFenHistory[newFenHistory.length - 1]);
        setHistory(newMoveHistory);
        setFenHistory(newFenHistory);
        setCurrentMoveIndex(newFenHistory.length - 1);
        console.log(`PGN loaded with ${newMoveHistory.length} moves.`);

    } else {
        console.error("Failed to load PGN.");
    }
  }, []);

  // Handler for navigating the game history
  const navigate = useCallback((delta) => {
    setFenHistory(prev => {
        const newIndex = Math.max(0, Math.min(prev.length - 1, currentMoveIndex + delta));
        setCurrentMoveIndex(newIndex);
        return prev;
    });
  }, [currentMoveIndex]);

  // Current FEN
  const fen = useMemo(() => {
    return fenHistory[currentMoveIndex] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  }, [fenHistory, currentMoveIndex]);

  // Derived convenience values
  const currentChess = useMemo(() => {
    // Create a temporary Chess object for getting legal moves/turn color of the current FEN
    if (fen) {
        const temp = new Chess(fen);
        return temp;
    }
    return new Chess(); // Default
  }, [fen]);
  
  const possibleMoves = useMemo(() => {
    return currentChess.moves({ verbose: true }).map(move => ({
        from: move.from,
        to: move.to
    }));
  }, [currentChess]);

  const turnColor = useMemo(() => {
    return currentChess.turn() === 'w' ? 'white' : 'black';
  }, [currentChess]);
  
  // Format history for commentary (san and color)
  const pgnMoves = useMemo(() => {
    return history.map((h, index) => ({
        move: index + 1, // 1-based move number
        san: h.san,
        color: h.color
    }));
  }, [history]);
  
  // Array of FENs for Stockfish
  const moveHistoryFens = useMemo(() => fenHistory, [fenHistory]);


  return {
    fen,
    moveHistory: moveHistoryFens, // Array of all FENs
    pgnMoves, // Array of {move, san, color} objects
    currentMoveIndex,
    loadPgn,
    navigate,
    onMove,
    turnColor,
    possibleMoves // Legal moves for the UI
  };
}
