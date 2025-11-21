// src/utils/analysis.js

const MISTAKE_THRESHOLD = 50;  // 0.50 pawn loss
const BLUNDER_THRESHOLD = 150; // 1.50 pawn loss

// Helper to normalize score to centipawns
const getScore = (evalObj) => {
    if (!evalObj) return 0;
    if (evalObj.type === 'mate') return evalObj.value > 0 ? 2000 : -2000;
    return evalObj.value;
};

export const generateCommentary = (currentIndex, moveHistory, pgnMoves, analyzedData) => {
    if (currentIndex <= 0) return null;

    const currentFen = moveHistory[currentIndex];
    const prevFen = moveHistory[currentIndex - 1];
    
    const currentData = analyzedData[currentFen];
    const prevData = analyzedData[prevFen];
    const movePlayed = pgnMoves[currentIndex - 1]; // { move: 'e4' }

    // 1. Waiting for data
    if (!currentData?.eval || !prevData?.eval) {
        return { 
            title: "Analyzing...", 
            text: "Stockfish is calculating deep lines...", 
            arrow: [] 
        };
    }

    // 2. Calculate Score Swing
    const scoreCurrent = getScore(currentData.eval);
    const scorePrev = getScore(prevData.eval);
    
    // Determine turn: If 'w' is in prevFen, White just moved.
    const isWhiteTurn = prevFen.includes(' w '); 
    
    // Calculate diff from perspective of the player who moved
    const diff = isWhiteTurn ? (scorePrev - scoreCurrent) : (scoreCurrent - scorePrev);

    // 3. Generate Text
    let classification = "Normal Move";
    let text = "The position remains relatively balanced.";
    let color = "#bdc3c7"; // Grey

    if (diff > BLUNDER_THRESHOLD) {
        classification = "BLUNDER 😵";
        text = `Catastrophic error! The evaluation dropped by ${(diff/100).toFixed(2)} pawns.`;
        color = "#e74c3c"; // Red
    } else if (diff > MISTAKE_THRESHOLD) {
        classification = "Mistake 🤔";
        text = `Inaccuracy. You gave up ${(diff/100).toFixed(2)} evaluation points.`;
        color = "#e67e22"; // Orange
    } else if (diff < -50) {
        classification = "Great Move! 🏆";
        text = "You found a strong move that improves your position!";
        color = "#2ecc71"; // Green
    }

    // 4. Arrow Logic (Show what the engine wanted)
    const bestMove = prevData.bestMove;
    const arrow = bestMove ? 
        [bestMove.substring(0,2), bestMove.substring(2,4)] 
        : [];

    return {
        title: `Move ${Math.ceil(currentIndex/2)}: ${movePlayed?.move}`,
        classification,
        text,
        score: (scoreCurrent / 100).toFixed(2),
        bestMove: bestMove,
        arrow: [arrow],
        color
    };
};
