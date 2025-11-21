// src/components/Board.jsx
// Overwrite with this content. This is a fully self-contained, functional
// chessboard implementation that uses SVGs for pieces and Tailwind CSS for styling.

import React, { useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

// Piece SVGs (Self-contained within the component file)
const Piece = ({ type, color }) => {
    const pieces = {
        // Standard chess piece symbols (using Unicode or a simple SVG path would be better,
        // but for a robust single-file implementation, we use Emojis/Unicode for simplicity)
        // Note: For a true chess app, use high-quality SVGs. Here, we use a simple text representation.
        P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔', // White
        p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚'  // Black
    };
    
    // Convert 'wP' to 'P', 'bN' to 'n' for the lookup
    const pieceKey = color === 'white' ? type.toUpperCase() : type.toLowerCase();
    const symbol = pieces[pieceKey] || '';

    // If using the standard piece notation, color styling is not needed, but we keep it
    // for future SVG integration.
    const pieceColorClass = color === 'white' ? 'text-white' : 'text-black';

    return (
        <div className={`text-4xl sm:text-5xl md:text-6xl flex justify-center items-center h-full w-full select-none cursor-grab font-serif ${pieceColorClass}`}>
            {symbol}
        </div>
    );
};

// Main Board Component
function Board(props) {
    const {
        orientation = 'white', // 'white' or 'black'
        onMove, // function(from, to)
        fen, // standard FEN string
        movable = { dests: {} }, // { dests: { e2: ['e3', 'e4'] } }
        lastMove = [], // [from, to] of the last move
        arrows = [], // [from, to] of the analysis arrow
    } = props;

    // Local state for dragging and square selection
    const [selectedSquare, setSelectedSquare] = useState(null);

    // FEN Parsing to piece map
    const pieceMap = useMemo(() => {
        if (!fen) return {};
        const [boardFen] = fen.split(' ');
        const map = {};
        const ranks = boardFen.split('/');

        for (let r = 0; r < 8; r++) {
            const rank = ranks[r];
            let file = 0;
            for (let i = 0; i < rank.length; i++) {
                const char = rank[i];
                if (/\d/.test(char)) {
                    // It's a number, skip files
                    file += parseInt(char, 10);
                } else {
                    // It's a piece
                    const square = `${String.fromCharCode(97 + file)}${8 - r}`;
                    map[square] = char;
                    file++;
                }
            }
        }
        return map;
    }, [fen]);

    // Generate square coordinates (a1, b1, ..., h8)
    const squares = useMemo(() => {
        const s = [];
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                s.push(`${String.fromCharCode(97 + f)}${8 - r}`);
            }
        }
        return orientation === 'black' ? s.reverse() : s; // Reverse for black perspective
    }, [orientation]);
    
    // --- Square Click / Move Handling ---
    const handleSquareClick = useCallback((square) => {
        if (!onMove) return;

        // 1. If a square is already selected
        if (selectedSquare) {
            const possibleDests = movable.dests[selectedSquare] || [];
            
            // a) If the clicked square is a valid destination for the selected piece
            if (possibleDests.includes(square)) {
                onMove(`${selectedSquare}${square}`); // UCI format, e.g., e2e4
                setSelectedSquare(null);
            } 
            // b) If the clicked square contains a piece of the current player (new selection)
            else if (pieceMap[square] && ((movable.color === 'w' && pieceMap[square] === pieceMap[square].toUpperCase()) || (movable.color === 'b' && pieceMap[square] === pieceMap[square].toLowerCase()))) {
                setSelectedSquare(square); // Change selection
            }
            // c) Clicked outside of valid move/own piece -> Deselect
            else {
                setSelectedSquare(null);
            }
        } 
        // 2. If no square is selected
        else {
            // Select the square only if it contains a piece of the current player
            if (pieceMap[square] && ((movable.color === 'w' && pieceMap[square] === pieceMap[square].toUpperCase()) || (movable.color === 'b' && pieceMap[square] === pieceMap[square].toLowerCase()))) {
                setSelectedSquare(square);
            }
        }
    }, [selectedSquare, onMove, movable.dests, movable.color, pieceMap]);


    // --- Rendering Logic ---

    // Function to determine square color
    const getSquareColor = (square) => {
        const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
        const rank = parseInt(square[1], 10);
        const isLight = (file + rank) % 2 === 1;
        // Using Tailwind for colors
        return isLight ? 'bg-amber-100' : 'bg-amber-700';
    };

    // Function to determine square background highlight
    const getHighlightClass = (square) => {
        if (selectedSquare === square) {
            return 'ring-4 ring-cyan-500/80 shadow-inner shadow-cyan-600/50'; // Selected
        }
        if (lastMove.includes(square)) {
            return 'bg-yellow-300/50 dark:bg-yellow-800/50'; // Last move
        }
        return '';
    };

    // Render the potential moves dots
    const renderMoveDots = (square) => {
        if (selectedSquare && (movable.dests[selectedSquare] || []).includes(square)) {
            const isCapture = pieceMap[square];
            return (
                <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
                    <div className={`
                        w-3 h-3 rounded-full 
                        ${isCapture ? 'border-4 border-red-500/80 bg-red-900/40 w-full h-full' : 'bg-gray-900/50 w-3 h-3'}
                        ${isCapture ? 'mix-blend-multiply opacity-50' : ''}
                    `} />
                </div>
            );
        }
        return null;
    };

    // Fallback: Use simple highlighting for the best move arrow start and end squares
    const getArrowClass = (square) => {
        if (arrows.length === 2 && arrows[0] === square) {
            return 'shadow-lg shadow-green-500/50 ring-4 ring-green-600/60'; // Arrow start
        }
        if (arrows.length === 2 && arrows[1] === square) {
            return 'shadow-lg shadow-blue-500/50 ring-4 ring-blue-600/60'; // Arrow end
        }
        return '';
    }


    // --- Main Render ---
    return (
        <div className="flex flex-col items-center justify-center p-4">
            <div 
                className={`grid grid-cols-8 grid-rows-8 w-[min(700px,90vw)] h-[min(700px,90vw)] shadow-2xl border-2 border-gray-900/50 ${orientation === 'black' ? '' : ''}`}
                role="grid"
                aria-label={`Chess board for ${orientation} player`}
            >
                {squares.map((square, index) => {
                    const pieceChar = pieceMap[square];
                    
                    return (
                        <div
                            id={`square-${square}`}
                            key={square}
                            className={`
                                relative 
                                w-full h-full 
                                flex justify-center items-center 
                                transition-all duration-100 ease-in-out
                                ${getSquareColor(square)} 
                                ${getHighlightClass(square)}
                                ${getArrowClass(square)}
                                cursor-pointer
                                ${orientation === 'black' && 'rotate-180'}
                            `}
                            onClick={() => handleSquareClick(square)}
                            role="gridcell"
                            aria-label={square}
                        >
                            {/* Square Label (optional, for debug or accessibility) */}
                            {/* Ranks on A-file, Files on 1-rank */}
                            {(square.startsWith('a') && orientation === 'white') && (
                                <div className={`absolute top-0 left-0 text-xs p-1 opacity-70 ${getSquareColor(square).includes('100') ? 'text-gray-700' : 'text-gray-100'}`}>
                                    {square[1]}
                                </div>
                            )}
                            {(square.endsWith('1') && orientation === 'white') && (
                                <div className={`absolute bottom-0 right-0 text-xs p-1 opacity-70 ${getSquareColor(square).includes('100') ? 'text-gray-700' : 'text-gray-100'}`}>
                                    {square[0]}
                                </div>
                            )}
                            
                            {/* Piece */}
                            {pieceChar && 
                                <div className={`${orientation === 'black' && 'rotate-180'}`}>
                                    <Piece type={pieceChar} color={pieceChar === pieceChar.toUpperCase() ? 'white' : 'black'} />
                                </div>
                            }
                            
                            {/* Move Dot */}
                            {renderMoveDots(square)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// PropTypes definitions
Board.propTypes = {
    orientation: PropTypes.oneOf(['white', 'black']),
    onMove: PropTypes.func,
    fen: PropTypes.string,
    movable: PropTypes.shape({
        dests: PropTypes.objectOf(PropTypes.arrayOf(PropTypes.string)),
        color: PropTypes.oneOf(['w', 'b']),
    }),
    lastMove: PropTypes.arrayOf(PropTypes.string),
    arrows: PropTypes.arrayOf(PropTypes.string),
};

export default React.memo(Board);
