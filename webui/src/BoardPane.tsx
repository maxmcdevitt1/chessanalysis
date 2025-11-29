// webui/src/BoardPane.tsx — absolute-positioned badge sized to square (no clipping)
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from './chess-compat';

import EvalSparkline from './EvalSparkline';
import { BookBadge, BestBadge, MistakeBadge, BlunderBadge, BrilliantBadge, GoodBadge } from './TagBadges';

type MoveEvalLite = { uci?: string; tag?: 'Genius'|'Best'|'Good'|'Mistake'|'Blunder'|'Book'; san?: string; };
type BoardPaneProps = {
  fen: string; orientation: 'white' | 'black';
  evalCp: number | null; evalPending: boolean;
  movesUci: string[]; ply: number;
  onUserDrop: (from: string, to: string) => boolean;
  onRebuildTo: (ply: number) => void;
  onEngineMove: () => void; onNewGame: () => void;
  autoReply: boolean; setAutoReply: (v: boolean) => void; engineBusy: boolean;
  bestArrow?: { from: Square; to: Square } | null; onOrientationChange?: (o: 'white'|'black') => void;
  currentMoveEval?: MoveEvalLite | null;
  evalSeries?: Array<number | null>; showEvalGraph?: boolean; onToggleEvalGraph?: () => void;
  //engineStrength?: number; onEngineStrengthChange?: (n: number) => void;
};

function useStableBoardWidth(minPx = 600, maxPx = 980, initial = 760) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState<number>(Math.min(initial, maxPx));
  useEffect(() => {
    if (!ref.current) return;
    let raf = 0;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cw = Math.floor(entry.contentRect.width);
        const next = Math.max(minPx, Math.min(maxPx, cw));
        const q = Math.floor(next / 2) * 2;
        setW(prev => (Math.abs(prev - q) >= 2 ? q : prev));
      });
    });
    ro.observe(ref.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [minPx, maxPx]);
  return { containerRef: ref, boardWidth: w };
}

function EvalBar({ cp, pending }: { cp: number | null; pending: boolean }) {
  const capped = cp == null ? 0 : Math.max(-1000, Math.min(1000, cp));
  const whitePct = Math.max(0, Math.min(100, 50 + capped / 20));
  const blackPct = 100 - whitePct;
  const label = pending ? '…' : cp == null ? '—' : `${cp > 0 ? '+' : ''}${((cp) / 100).toFixed(1)}`;
  return (
    <div style={{ display:'flex', gap:16, alignItems:'center' }}>
      <div style={{ width:36, height:560, border:'3px solid #444', borderRadius:10, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        <div style={{ flexBasis:`${whitePct}%`, background:'#fff' }}/>
        <div style={{ flexBasis:`${blackPct}%`, background:'#000' }}/>
      </div>
      <div style={{ fontSize:22, color:'#ddd', minWidth:80 }}>{label}<div style={{opacity:.6, fontSize:20}}>Eval</div></div>
    </div>
  );
}

function badgeNode(tag?: MoveEvalLite['tag'], size=44) {
  switch (tag) {
    case 'Genius': return <BrilliantBadge size={size}/>;
    case 'Best': return <BestBadge size={size}/>;
    case 'Good': return <GoodBadge size={size}/>;
    case 'Mistake': return <MistakeBadge size={size}/>;
    case 'Blunder': return <BlunderBadge size={size}/>;
    case 'Book': return <BookBadge size={size}/>;
    default: return null;
  }
}

function fileIdx(file: string) { return file.charCodeAt(0) - 96; }

export default function BoardPane(props: BoardPaneProps) {
  const {
    fen, orientation, evalCp, evalPending, movesUci, ply,
    onUserDrop, onRebuildTo, onEngineMove, onNewGame,
    autoReply, setAutoReply, engineBusy, bestArrow, onOrientationChange,
    currentMoveEval, evalSeries, showEvalGraph, onToggleEvalGraph,
    engineStrength, onEngineStrengthChange,
  } = props;

  const { containerRef, boardWidth } = useStableBoardWidth();
  const squareSize = boardWidth / 8;

  const fallbackUci = ply > 0 && movesUci[ply - 1] ? movesUci[ply - 1] : undefined;
  const destUci = currentMoveEval?.uci ?? fallbackUci;
  const destSquare = destUci ? destUci.slice(2, 4) : undefined;

  const badgeSize = Math.min(56, Math.max(28, Math.floor(squareSize * 0.66))); // <= square
  const offset = Math.max(2, Math.floor(squareSize * 0.06)); // tuck inside

  const badgePos = useMemo(() => {
    if (!destSquare || destSquare.length !== 2) return null;
    const file = destSquare[0].toLowerCase();
    const rank = Number(destSquare[1]);
    if (!'abcdefgh'.includes(file) || !Number.isFinite(rank)) return null;
    const col0 = fileIdx(file) - 1;
    const row0 = rank - 1;
    const col = orientation === 'white' ? col0 : 7 - col0;
    const row = orientation === 'white' ? 7 - row0 : row0;
    const x = col * squareSize; const y = row * squareSize;
    // place top-right of this square
    return {
      left: x + squareSize - badgeSize - offset,
      top: y + offset,
    };
  }, [destSquare, orientation, squareSize, badgeSize, offset]);

  const arrows = useMemo(
    () => (bestArrow ? [[bestArrow.from, bestArrow.to] as [Square, Square]] : []),
    [bestArrow?.from, bestArrow?.to]
  );

  async function onPieceDrop(from: string, to: string) { return onUserDrop(from, to); }

  const baseFont = 20;
  const btn: React.CSSProperties = { padding: '10px 14px', fontSize: baseFont, borderRadius: 8 };
  const sel: React.CSSProperties = { padding: '8px 12px', fontSize: baseFont, borderRadius: 8 };
  const labelStyle: React.CSSProperties = { fontSize: baseFont, fontWeight: 700 };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'auto 360px', gap:18, alignItems:'start' }}>
      <div>
        <div ref={containerRef} style={{ position:'relative', width:'100%', boxSizing:'border-box', overflow:'visible' }}>
          <Chessboard
            id="analysis-board" position={fen} onPieceDrop={onPieceDrop}
            boardOrientation={orientation} animationDuration={150}
            boardWidth={boardWidth}
            customBoardStyle={{ margin:'0 auto', overflow:'visible' as any }}
            customArrows={arrows}
          />
          {/* Absolute-positioned badge in board coords */}
          {badgePos && currentMoveEval?.tag ? (
            <div
              style={{
                position:'absolute',
                left: badgePos.left,
                top: badgePos.top,
                width: badgeSize,
                height: badgeSize,
                zIndex: 60,
                pointerEvents:'none',
              }}
            >
              {badgeNode(currentMoveEval?.tag, badgeSize)}
            </div>
          ) : null}
        </div>

        {/* Controls under the board */}
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop: 12 }}>
          <span style={labelStyle}>Play as</span>
          <select value={orientation} onChange={e => onOrientationChange?.(e.target.value as any)} style={sel}>
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>

          <button onClick={() => onRebuildTo(0)} style={btn} title="Start">«</button>
          <button onClick={() => onRebuildTo(Math.max(0, ply - 1))} style={btn} title="Prev">‹</button>
          <button onClick={() => onRebuildTo(Math.min(movesUci.length, ply + 1))} style={btn} title="Next">›</button>
          <button onClick={() => onRebuildTo(movesUci.length)} style={btn} title="End">»</button>

          <button onClick={onEngineMove} disabled={engineBusy} style={btn}>
            {engineBusy ? 'Engine…' : 'Engine Move'}
          </button>

          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', ...labelStyle }}>
            <input type="checkbox" checked={autoReply} onChange={e => setAutoReply(e.target.checked)} style={{ transform:'scale(1.25)' }} />
            Auto reply
          </label>

          <button onClick={onNewGame} style={btn}>New Game</button>
        </div>

        {/* Bigger sparkline under the board */}
        {Array.isArray(evalSeries) && evalSeries.length > 0 ? (
          <div style={{ marginTop: 12, maxWidth: boardWidth, fontSize: 20 }}>
            <button onClick={onToggleEvalGraph} style={{ fontSize: 20, padding: '6px 10px', marginBottom: 8 }} aria-label="Toggle evaluation graph">
              {showEvalGraph === false ? '▸ Show eval graph' : '▾ Hide eval graph'}
            </button>
            {(showEvalGraph !== false) && <EvalSparkline series={evalSeries} height={96} currentIndex={Math.max(0, ply - 1)} onClickIndex={(i) => onRebuildTo(i + 1)}     // click to jump
/>}
          </div>
        ) : null}
      </div>

      {/* Larger eval bar */}
      <div style={{ display:'flex', alignItems:'flex-start' }}>
        <EvalBar cp={evalCp} pending={evalPending} />
      </div>
    </div>
  );
}
