// src/utils/analysis.js

const MISTAKE_THRESHOLD = 50;  // 0.50 pawn loss
const BLUNDER_THRESHOLD = 150; // 1.50 pawn loss

// Helper to normalize score to centipawns
const getScore = (evalObj) => {
    if (!evalObj) return 0;
    // Mate: return a high fixed value (e.g., 5000) for comparison
    if (evalObj.type === 'mate') return evalObj.value > 0 ? 5000 : -5000; 
    return evalObj.value; // Already in centipawns
};

// Helper to format score to string (e.g., 150 -> +1.5, -300 -> -3.0)
const formatScore = (evalObj) => {
    if (!evalObj) return '—';
    if (evalObj.type === 'mate') {
        return evalObj.value > 0 ? `#${evalObj.value}` : `#${evalObj.value}`;
    }
    const sign = evalObj.value >= 0 ? '+' : '';
    return `${sign}${(evalObj.value / 100).toFixed(2)}`;
};

export const generateCommentary = (currentIndex, moveHistory, pgnMoves, analyzedData) => {
    // Requires at least one move to analyze (index 1)
    if (currentIndex <= 0 || moveHistory.length < 2) return null;

    const currentFen = moveHistory[currentIndex];
    const prevFen = moveHistory[currentIndex - 1];
    
    const currentData = analyzedData[currentFen];
    const prevData = analyzedData[prevFen];
    const movePlayed = pgnMoves[currentIndex - 1]; // e.g., { move: 'e4' }

    // 1. Check if all necessary analysis data is present
    if (!currentData || !prevData || !currentData.eval || !prevData.eval) {
        return { 
            title: `Move ${currentIndex}`, 
            classification: "Awaiting Analysis", 
            text: "Stockfish is calculating lines for this position...", 
            score: '—',
            bestMove: '...',
            color: "#7f8c8d", // Grey
            arrow: [] 
        };
    }

    // 2. Calculate Score Swing
    const scoreCurrent = getScore(currentData.eval);
    const scorePrev = getScore(prevData.eval);
    
    // Determine whose move it was
    const isWhiteMove = movePlayed.color === 'w'; 
    
    // Calculate evaluation difference (loss/gain) from the perspective of the *player who moved*
    // If White moved, loss = (PrevScore - CurrentScore). If Black moved, loss = (CurrentScore - PrevScore).
    // To simplify: loss is always from the perspective of White being positive
    const diffRaw = scorePrev - scoreCurrent;
    // If it was Black's move, we flip the sign of the difference to reflect Black's gain/loss
    const diff = isWhiteMove ? diffRaw : -diffRaw; 

    // 3. Generate Text and Classification
    let classification = "Normal Move";
    let text = "The position remains relatively balanced.";
    let color = "#3498db"; // Blue/OK

    if (Math.abs(scoreCurrent) >= 4500) { // Check for mate
        classification = "Checkmate!";
        text = "This move leads to a forced checkmate! Brilliant play.";
        color = "#2ecc71"; // Green (Win)
    } else if (diff > BLUNDER_THRESHOLD) {
        classification = "BLUNDER 😵";
        text = `Catastrophic error! The evaluation dropped by ${(diff/100).toFixed(2)} pawns. You missed ${prevData.bestMove}.`;
        color = "#e74c3c"; // Red
    } else if (diff > MISTAKE_THRESHOLD) {
        classification = "Mistake 🤔";
        text = `Inaccuracy. You gave up ${(diff/100).toFixed(2)} evaluation points.`;
        color = "#e67e22"; // Orange
    } else if (diff < -50) { // Found a good move (gained 0.50 pawns from opponent's blunder)
        classification = "Great Move! 🏆";
        text = "You found a strong move that improves your position or punishes the opponent's previous move!";
        color = "#2ecc71"; // Green
    }
    
    // 4. Arrow Logic (Show the engine's best move from the *previous* position)
    const bestMoveUci = prevData.bestMove;
    const arrow = bestMoveUci ? 
        [bestMoveUci.substring(0,2), bestMoveUci.substring(2,4)] 
        : [];

    return {
        title: `Move ${movePlayed.move}: ${movePlayed.san}`,
        classification: classification,
        text: text,
        score: formatScore(currentData.eval),
        bestMove: prevData.bestMove || '...',
        color: color,
        arrow: arrow,
    };
};
