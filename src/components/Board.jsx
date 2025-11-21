import React from "react";
import Chessground from "@bezalel6/react-chessground";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

const Board = ({ fen, arrows = [], onMove, turnColor, possibleMoves }) => {
  return (
    <div className="board-container">
      <Chessground
        width={700}
        height={700}
        fen={fen}
        viewOnly={false}
        turnColor={turnColor}
        movable={{
          free: false,
          color: turnColor,
          dests: possibleMoves,
          showDests: true,
        }}
        onMove={(from, to) => onMove(from, to)}
        drawable={{
          autoShapes: arrows.map((a) => ({
            orig: a[0],
            dest: a[1],
            brush: "green",
          })),
        }}
      />
    </div>
  );
};

export default Board;
