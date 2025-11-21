import React, { useEffect } from "react";
import useGameState from "./hooks/useGameState";
import useStockfish from "./hooks/useStockfish";
import { generateCommentary } from "./utils/analysis";

import Board from "./components/Board";
import Controls from "./components/Controls";
import Commentary from "./components/Commentary";
import EvalBar from "./components/EvalBar";

import "./App.css";

function App() {
  const {
    fen,
    moveHistory,
    pgnMoves,
    currentMoveIndex,
    loadPgn,
    navigate,
    onMove,
    turnColor,
    possibleMoves,
  } = useGameState();

  const {
    analyzedData = {},
    isAnalyzing,
    progress = { current: 0, total: 0 },
    startAnalysis,
  } = useStockfish();

  useEffect(() => {
    if (!fen || isAnalyzing) return;
    if (!analyzedData || typeof analyzedData !== "object") return;

    if (!analyzedData[fen]) {
      startAnalysis([fen]);
    }
  }, [fen, analyzedData, isAnalyzing, startAnalysis]);

  const commentary = generateCommentary(
    currentMoveIndex,
    moveHistory,
    pgnMoves,
    analyzedData
  );

  const arrows =
    commentary?.arrow && commentary.arrow.length ? [commentary.arrow] : [];
  const currentScore =
    commentary && commentary.score ? parseFloat(commentary.score) * 100 : 0;

  const handleUpload = (text) => {
    loadPgn(text);
  };

  return (
    <div className="app-root">
      <div className="app-layout">
        {/* LEFT SIDEBAR */}
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

        {/* RIGHT SIDE: BOARD + EVAL BAR */}
        <main className="board-area">
          <div className="board-wrapper">
            <EvalBar currentScore={currentScore} />

            <Board
              fen={fen}
              arrows={arrows}
              onMove={onMove}
              turnColor={turnColor}
              possibleMoves={possibleMoves}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
