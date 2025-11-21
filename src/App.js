import React, { useEffect } from 'react';
import  useGameState  from './hooks/useGameState';
import  useStockfish  from './hooks/useStockfish';
import { generateCommentary } from './utils/analysis';

import Board from './components/Board';
import Controls from './components/Controls';
import Commentary from './components/Commentary';
import EvalBar from './components/EvalBar'; 
import './App.css';

function App() {
  // 1. Load Game Logic (Includes new interaction props)
  const { 
      fen, 
      moveHistory, 
      pgnMoves, 
      currentMoveIndex, 
      loadPgn, 
      navigate, 
      onMove, 
      turnColor, 
      possibleMoves // <--- Legal moves for the UI
  } = useGameState();
  
  // 2. Load Engine Logic
  const { analyzedData, isAnalyzing, progress, startAnalysis } = useStockfish();

  // 3. Analysis Auto-Queue FIX (The crucial block)
  useEffect(() => {
      // If the FEN changes (manual move/navigation) and we don't have analysis data 
      // for it, queue it for Stockfish analysis immediately, provided the engine isn't busy.
      if (fen && !analyzedData[fen] && !isAnalyzing) {
          console.log(`Auto-queuing new position: ${fen}`);
          // startAnalysis expects an array of FENs
          startAnalysis([fen]);
      }
      // Dependency array includes 'fen' to re-run on every move.
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]); 

  // 4. Generate Commentary & Visuals
  const commentary = generateCommentary(currentMoveIndex, moveHistory, pgnMoves, analyzedData);
  const arrows = commentary?.arrow || [];
  
  // Convert score string (e.g., "1.50") back to centipawns (150) for the EvalBar
  const currentScore = commentary ? parseFloat(commentary.score) * 100 : 0;

  // 5. Handlers
  const handleUpload = (pgnText) => {
    console.log("--- PGN Upload Started ---");
    console.log("PGN content received (first 200 chars):\n", pgnText.substring(0, 200));
    console.log("--------------------------");
    // --- END UPDATED DEBUG LOG ---
    loadPgn(pgnText);
    

  };

  return (
    <div className="app-layout">
      {/* --- LEFT SIDEBAR --- */}
      <aside className="sidebar">
        <h1>♟️ Chess Insights</h1>
        
        <Controls 
            onUpload={handleUpload}
            onPrev={() => navigate(-1)}
            onNext={() => navigate(1)}
            onAnalyze={() => startAnalysis(moveHistory)}
            canAnalyze={moveHistory.length > 0}
            isAnalyzing={isAnalyzing}
            progress={progress}
        />

        <Commentary data={commentary} />
      </aside>

      {/* --- MAIN BOARD AREA --- */}
      <main className="board-area">
        {/* The Evaluation Thermometer */}
        <EvalBar currentScore={currentScore} />
        
        {/* The Chess Board (Now fully interactive) */}
        <Board 
            fen={fen} 
            arrows={arrows} 
            onMove={onMove} 
            turnColor={turnColor} 
            possibleMoves={possibleMoves} 
        />
      </main>
    </div>
  );
}

export default App;
