import { useState, useMemo, useEffect } from 'react';
import { Chess } from 'chess.js';

// --- HELPER: Convert chess.js moves into Chessground's destination Map ---
const calcDests = (chess) => {
    const dests = new Map();
    // Get all legal moves in verbose format
    chess.moves({ verbose: true }).forEach(m => {
        // Initialize the array for the source square if it doesn't exist
        if (!dests.has(m.from)) dests.set(m.from, []);
        // Add the destination square
        dests.get(m.from).push(m.to);
    });
    return dests;
};

export function useGameState() {
    // Initialize Chess instance using useMemo to keep it stable
    const game = useMemo(() => new Chess(), []);
    
    // Core state for the game position and history
    const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const [moveHistory, setMoveHistory] = useState(['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1']);
    const [pgnMoves, setPgnMoves] = useState([]);
    const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
    
    // State to hold legal moves for the UI (Chessground)
    const [possibleMoves, setPossibleMoves] = useState(new Map());


    // --- 1. INITIALIZATION and FEN Change Handler ---
    // Runs once on mount to set initial legal moves
    useEffect(() => {
        // Ensure the game object is synced and calculate initial moves
        game.load(fen); 
        setPossibleMoves(calcDests(game));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); 


    // --- 2. HANDLE MANUAL MOVES (Drag-and-Drop) ---
    const onMove = (from, to) => {
        // 1. Sync internal game instance to the current visual board state (critical for navigation/overwrite)
        game.load(fen);

        try {
            // 2. Attempt the move (default to Queen promotion for simplicity)
            const moveResult = game.move({ from, to, promotion: 'q' });

            if (moveResult) {
                const newFen = game.fen();
                
                // 3. Update History: Overwrite any moves that existed after the current index
                const newHistory = moveHistory.slice(0, currentMoveIndex + 1);
                newHistory.push(newFen);
                
                const newPgnMoves = pgnMoves.slice(0, currentMoveIndex);
                newPgnMoves.push({ move: moveResult.san });

                // 4. Update State
                setFen(newFen);
                setMoveHistory(newHistory);
                setPgnMoves(newPgnMoves);
                setCurrentMoveIndex(newHistory.length - 1);
                
                // 5. Recalculate valid moves for the new position
                setPossibleMoves(calcDests(game)); 
                return true;
            }
        } catch (e) {
            // console.error("Illegal move attempted:", e);
            return false; // Invalid move
        }
        return false;
    };

    // --- 3. PGN LOADING (with Robust Parsing) ---
    const sanitizePgn = (rawPgn) => {
        // Aggressively strip headers, comments, variations, and normalize whitespace
        let clean = rawPgn.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').replace(/\(.*?\)/g, '').replace(/\$\d+/g, '').replace(/\s+/g, ' ').trim();
        return clean;
    };

    const loadPgn = (pgnText) => {
        try {
            // Strategy 1: Try standard load
            try { game.loadPgn(pgnText); } 
            catch (e1) { 
                // Strategy 2: If standard fails, try sanitized load with dummy headers
                const clean = sanitizePgn(pgnText);
                const dummyPgn = `[Event "Analysis"]\n\n${clean}`;
                
                try { game.loadPgn(dummyPgn); }
                catch (e2) { 
                     // Strategy 3: Try legacy load (for older chess.js versions)
                    if (typeof game.load_pgn === 'function') {
                        game.load_pgn(dummyPgn);
                    } else {
                        throw new Error("All parsing attempts failed.");
                    }
                }
            }

            const history = game.history({ verbose: true });
            if (history.length === 0) { 
                throw new Error("No moves found in PGN.");
            }

            // Rebuild history stack
            game.reset();
            const fens = [game.fen()];
            const cleanMoves = [];

            history.forEach(move => {
                game.move(move);
                fens.push(game.fen());
                cleanMoves.push({ move: move.san });
            });

            setMoveHistory(fens);
            setPgnMoves(cleanMoves);
            setFen(fens[0]); // Go to start FEN
            setCurrentMoveIndex(0); 
            
            // Recalculate valid moves for the initial position
            game.reset();
            setPossibleMoves(calcDests(game));
            
            return true;
            
        } catch (error) {
            console.error("CRITICAL PGN ERROR:", error);
            alert("Failed to parse PGN. Ensure the text contains numbered moves (e.g., '1. e4 e5').");
            return false;
        }
    };

    // --- 4. NAVIGATION ---
    const navigate = (delta) => {
        const next = currentMoveIndex + delta;
        if (next >= 0 && next < moveHistory.length) {
            const nextFen = moveHistory[next];
            setCurrentMoveIndex(next);
            setFen(nextFen);
            
            // Update valid moves for the navigated position
            game.load(nextFen);
            setPossibleMoves(calcDests(game));
        }
    };

    // Derived state for Chessground
    const turnColor = fen.split(' ')[1] === 'w' ? 'white' : 'black';

    return { 
        fen, 
        moveHistory, 
        pgnMoves, 
        currentMoveIndex, 
        loadPgn, 
        navigate,
        onMove,       
        turnColor,
        possibleMoves
    };
}