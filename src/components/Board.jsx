// src/components/Board.jsx
// Overwrite with this content. This version focuses on stable callbacks and memoized config.
// Adjust imports to match your project (chessground/react wrappers) if necessary.

import React, { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
// import Chessground or the wrapper used by the project
// import { Chessground } from 'some-chessground-wrapper';

function Board(props) {
  const {
    orientation = 'white',
    onMove, // should be function(from, to)
    position, // fen or object expected by your board lib
    movable = {},
    highlight = {},
  } = props;

  // Create stable move handler
  const handleMove = useCallback((from, to) => {
    // Defensive: ensure onMove is callable and arguments are valid
    try {
      if (typeof onMove === 'function') onMove(from, to);
    } catch (err) {
      console.error('Board.onMove handler error', err);
    }
  }, [onMove]);

  // Memoize configuration object so board library doesn't see a new object each render
  const boardConfig = useMemo(() => {
    return {
      orientation,
      position,
      movable,
      highlight,
      onMove: handleMove,
    };
  }, [orientation, position, movable, highlight, handleMove]);

  // Render chessboard using the boardConfig
  // Replace the <div> and the commented component below with the actual board component your project uses.
  return (
    <div className="board-wrapper" role="region" aria-label="Chess board">
      {/* Example: <Chessground {...boardConfig} /> */}
      {/* If using a different component, pass boardConfig props similarly but ensure they are memoized. */}
      <div>Board placeholder — replace with real Chessboard component and pass boardConfig</div>
    </div>
  );
}

Board.propTypes = {
  orientation: PropTypes.oneOf(['white', 'black']),
  onMove: PropTypes.func,
  position: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  movable: PropTypes.object,
  highlight: PropTypes.object,
};

export default React.memo(Board);

