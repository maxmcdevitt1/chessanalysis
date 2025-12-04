// webui/src/BoardPane.tsx — big board, tall eval bar to the right, large controls; badge top-right inside square
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from './chess-compat';
import EvalSparkline from './EvalSparkline';
import { TagBadge } from './TagBadges';

/* ----------------------------- Types & Props ------------------------------ */

type MoveEvalLite = {
  uci?: string;
  tag?: 'Genius'|'Best'|'Good'|'Mistake'|'Blunder'|'Book'|null;
  san?: string;
};

type BoardPaneProps = {
  fen: string;
  orientation: 'white' | 'black';

  evalCp: number | null;
  evalPending: boolean;
  // Only show per-move badges once an analysis pass has populated tags.
  hasAnalysis?: boolean;

  movesUci: string[];
  ply: number;

  onUserDrop: (from: string, to: string) => boolean;
  onRebuildTo: (ply: number) => void;
  onEngineMove: () => void;
  onNewGame: () => void;

  autoReply: boolean;
  setAutoReply: (v: boolean) => void;
  engineBusy: boolean;

  bestArrow?: { from: Square; to: Square } | null;
  onOrientationChange?: (o: 'white'|'black') => void;

  currentMoveEval?: MoveEvalLite | null;

  evalSeries?: Array<number | null>;
  showEvalGraph?: boolean;
  onToggleEvalGraph?: () => void;

  engineStrength?: number;
  onEngineStrengthChange?: (n: number) => void;

  // Book context for on-board badge
  bookMask?: boolean[];
  currentPly?: number;
  lastMove?: { from: string; to: string } | null;
  customSquareStyles?: Record<string, React.CSSProperties>;
};

/* --------------------------------- UI Kit -------------------------------- */

const ui = {
  row: { display: 'flex', gap: 14, flexWrap: 'wrap' as const, justifyContent: 'center' as const },
  col: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 } as React.CSSProperties,
  btn: {
    padding: '13px 22px',
    fontSize: 17,
    lineHeight: '21px',
    borderRadius: 12,
    border: '1px solid #565656',
    background: '#2f2f2f',
    color: '#eee',
    boxShadow: '0 2px 6px rgba(0,0,0,.35)',
    cursor: 'pointer',
  } as React.CSSProperties,
  btnGhost: {
    padding: '13px 22px',
    fontSize: 17,
    lineHeight: '21px',
    borderRadius: 12,
    border: '1px solid #4a4a4a',
    background: '#1f1f1f',
    color: '#ddd',
    cursor: 'pointer',
  } as React.CSSProperties,
  checkboxLabel: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, color: '#ddd' },
};

/* ----------------------------- Small helpers ----------------------------- */

function fileIdx(f: string) {
  return 'abcdefgh'.indexOf(f) + 1;
}

function RenderBadge({ tag, size = 24 }: { tag: MoveEvalLite['tag']; size?: number }) {
  return <TagBadge tag={tag ?? null} size={size} />;
}

/**
 * Fit the board to available space (container width minus eval column),
 * while also respecting the window height so it never shrinks too far.
 */
function useStableBoardWidth(minPx = 900, maxPx = 1340, initial = 1040) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState<number>(initial);

  useEffect(() => {
    if (!ref.current) return;
    let raf = 0;
    const EVAL_RIGHT_COL = 160; // eval bar + label + gutter
    const GUTTER = 28;

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const availW = Math.floor(entry.contentRect.width - (EVAL_RIGHT_COL + GUTTER));
        const availH = Math.floor(window.innerHeight - 140); // leave more vertical room for a taller board
        const target = Math.max(minPx, Math.min(maxPx, Math.min(availW, availH)));
        const even = Math.floor(target / 2) * 2; // crisp squares
        setW(prev => (Math.abs(prev - even) >= 2 ? even : prev));
      });
    });

    ro.observe(ref.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [minPx, maxPx]);

  return { containerRef: ref, boardWidth: w };
}

/** last numeric in an array (used for eval fallback) */
function lastNumber(a?: Array<number | null>): number | null {
  if (!a || !a.length) return null;
  for (let i = a.length - 1; i >= 0; i--) {
    const v = a[i];
    if (typeof v === 'number' && isFinite(v)) return v;
  }
  return null;
}

/* ------------------------------ Eval bar --------------------------------- */
/** Shows a number consistently: if pending and cp available, append " …" instead of hiding it. */
function EvalBar({ cp, pending, height }: { cp: number | null; pending: boolean; height: number }) {
  const capped = cp == null ? 0 : Math.max(-1000, Math.min(1000, cp));
  const whitePct = Math.max(0, Math.min(100, 50 + capped / 20));
  const blackPct = 100 - whitePct;
  const barHeight = Math.max(260, Math.floor(height)); // tall, but never tiny

  const num = cp == null ? null : (cp / 100).toFixed(1);
  const label = num != null ? `${cp >= 0 ? '+' : ''}${num}${pending ? ' …' : ''}` : (pending ? '…' : '—');

  return (
    <div style={{ display:'flex', gap:14, alignItems:'center' }}>
      <div style={{
        width: 34,
        height: barHeight,
        border: '2px solid #444',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: '#000',
      }}>
        <div style={{ flexBasis: `${whitePct}%`, background: '#fff' }} />
        <div style={{ flexBasis: `${blackPct}%`, background: '#000' }} />
      </div>
      <div style={{ fontSize: 16, color: '#ddd', minWidth: 56 }}>
        {label}
        <div style={{ opacity: .6, fontSize: 14 }}>Eval</div>
      </div>
    </div>
  );
}

/* ---------------------------------- View ---------------------------------- */

export default function BoardPane(props: BoardPaneProps) {
  const {
    fen, orientation, evalCp, evalPending, movesUci, ply,
    onUserDrop, onRebuildTo, onEngineMove, onNewGame,
    autoReply, setAutoReply, engineBusy, bestArrow,
    currentMoveEval, evalSeries, showEvalGraph,
    onOrientationChange, hasAnalysis,
  } = props;
  const { customSquareStyles, bookMask, currentPly, lastMove } = props;

  const { containerRef, boardWidth } = useStableBoardWidth();

  // Eval number to display: prefer live cp; else fallback to last known
  const evalCpDisplay = useMemo(() => {
    if (typeof evalCp === 'number' && isFinite(evalCp)) return evalCp;
    return lastNumber(evalSeries);
  }, [evalCp, evalSeries]);

  /* ---------- Badge: size + position (top-right inside destination square) ---------- */

  const squareSize = Math.floor(boardWidth / 8);
  const badgeSize = Math.min(54, Math.max(22, Math.floor(squareSize * 0.60))); // ~60% of a square
  const offset = Math.max(2, Math.floor(squareSize * 0.04));                    // hug top-right

  const destUci = currentMoveEval?.uci ?? (ply > 0 ? movesUci[ply - 1] : undefined);
  const destSquare = destUci ? destUci.slice(2, 4) : undefined;
  // Board overlays only after analysis; no book/other icons before that.
  const isBookMove = hasAnalysis && Array.isArray(bookMask) && typeof currentPly === 'number' && currentPly > 0 && !!bookMask[currentPly - 1];
  const overlayTag: MoveEvalLite['tag'] | null = hasAnalysis
    ? (isBookMove ? 'Book' : (currentMoveEval?.tag ?? null))
    : null;
  const badgeAnalysisReady = !!(hasAnalysis && Array.isArray(evalSeries) && evalSeries.length >= ply);
  const showBadge = !!(badgeAnalysisReady && overlayTag && destSquare && ply > 0);

  const badgePos = useMemo(() => {
    if (!showBadge || !destSquare || destSquare.length !== 2) return null;
    const file = destSquare[0].toLowerCase();
    const rank = Number(destSquare[1]);
    if (!'abcdefgh'.includes(file) || !Number.isFinite(rank)) return null;

    const col0 = fileIdx(file) - 1;  // 0..7 from white's left
    const row0 = rank - 1;           // 0..7 from white's bottom

    const col = orientation === 'white' ? col0 : 7 - col0;
    const row = orientation === 'white' ? 7 - row0 : row0;

    const left = col * squareSize + Math.max(0, squareSize - badgeSize - offset);
    const top  = row * squareSize + offset;

    return { left, top };
  }, [showBadge, destSquare, orientation, squareSize, badgeSize, offset]);

  /* ------------------------------ Arrows & Drops ------------------------------ */

  const arrows = useMemo(
    () => (bestArrow ? [[bestArrow.from, bestArrow.to] as [Square, Square]] : []),
    [bestArrow?.from, bestArrow?.to]
  );

  // Add a book badge to from/to squares if the current ply is still in book.
  const mergedSquareStyles = useMemo(() => {
    // Stop rendering book badges on squares to avoid stray glyphs.
    return customSquareStyles || {};
  }, [customSquareStyles]);

  async function onPieceDrop(from: string, to: string) { return onUserDrop(from, to); }

  /* ------------------------------ Layout numbers ------------------------------ */

  // Eval bar height slightly smaller than board height
  const evalBarHeight = Math.floor(boardWidth * 0.94);

  /* --------------------------------- Render --------------------------------- */

  return (
    <div style={{ display:'flex', gap:24, alignItems:'flex-start', maxWidth:'min(1500px, 96vw)', margin:'0 auto' }}>
      {/* LEFT: board + controls */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14, paddingTop: 10 }}>
        <div ref={containerRef} style={{ position:'relative', width: boardWidth, margin:'0 auto' }}>
          <Chessboard
            id="analysis"
            position={fen}
            boardOrientation={orientation}
            boardWidth={boardWidth}
            animationDuration={150}
            customBoardStyle={{ margin:'0 auto', overflow:'visible' as any }}
            customArrows={arrows}
            customSquareStyles={mergedSquareStyles}
            onPieceDrop={onPieceDrop}
          />

          {/* Badge overlay (non-interactive so it never blocks clicks) */}
          {badgePos && (
            <div
              style={{
                position: 'absolute',
                left: badgePos.left,
                top:  badgePos.top,
                width: badgeSize,
                height: badgeSize,
                pointerEvents: 'none',
              }}
            >
              <RenderBadge tag={overlayTag} size={badgeSize} />
            </div>
          )}
        </div>

        {/* Optional sparkline under the board */}
        {props.showEvalGraph !== false && evalSeries && evalSeries.length > 0 ? (
          <div style={{ width: boardWidth, padding:10, border:'1px solid #3a3a3a', borderRadius:10 }}>
            <EvalSparkline series={evalSeries} onClickIndex={(i)=>props.onRebuildTo(i+1)} />
          </div>
        ) : null}

        {/* Controls at the bottom of the column */}
        <div style={{ ...ui.col, width: boardWidth, gap: 12, marginTop: 6 }}>
          <div style={{ ...ui.row, justifyContent:'center', gap: 10, flexWrap: 'wrap' }}>
            <button style={ui.btnGhost} onClick={() => onRebuildTo(0)} disabled={ply === 0}>First</button>
            <button style={ui.btnGhost} onClick={() => onRebuildTo(Math.max(0, ply - 1))} disabled={ply === 0}>Back</button>
            <button style={ui.btnGhost} onClick={() => onRebuildTo(Math.min(movesUci.length, ply + 1))} disabled={ply >= movesUci.length}>Forward</button>
            <button style={ui.btnGhost} onClick={() => onRebuildTo(movesUci.length)} disabled={ply >= movesUci.length}>End</button>
            <button style={ui.btnGhost} onClick={onNewGame}>New</button>
          </div>
          <div style={{ ...ui.row, justifyContent:'center', gap: 12, flexWrap: 'wrap' }}>
            <button style={ui.btn} onClick={onEngineMove} disabled={engineBusy}>Engine Move</button>
            <label style={{ ...ui.checkboxLabel }}>
              <input type="checkbox" checked={autoReply} onChange={e => setAutoReply(e.target.checked)} />
              Auto reply
            </label>
            <button
              style={ui.btn}
              onClick={() => {
                onOrientationChange?.('black');
                if (ply === 0) onEngineMove();
              }}
              disabled={engineBusy || !onOrientationChange}
              title="Flip to Black and, if at start, let engine make the first move"
            >
              Play as Black
            </button>
            <button
              style={ui.btnGhost}
              onClick={() => onOrientationChange?.(orientation === 'white' ? 'black' : 'white')}
              disabled={!onOrientationChange}
              title="Flip board"
            >
              Flip
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: eval bar column — exactly next to the board, slightly shorter than board */}
      <div style={{
        display:'flex',
        alignItems:'flex-start',
        justifyContent:'flex-start',
        height: boardWidth, // align column height to board
        minWidth: 160,      // room for bar + labels
      }}>
        <EvalBar cp={evalCpDisplay} pending={Boolean(evalPending)} height={evalBarHeight} />
      </div>
    </div>
  );
}
