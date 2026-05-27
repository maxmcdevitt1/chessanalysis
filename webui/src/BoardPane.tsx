// webui/src/BoardPane.tsx — big board, tall eval bar to the right, large controls; badge top-right inside square
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from './chess-compat';
import EvalSparkline from './EvalSparkline';
import { TagBadge } from './TagBadges';
import type { CoachMomentNote, CoachMoveNote } from './types/coach';

function clampSentences(text: string | undefined, limit: number) {
  if (!text) return '';
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return text.trim();
  return parts.slice(0, Math.max(1, limit)).join(' ');
}

/* ----------------------------- Types & Props ------------------------------ */

type MoveEvalLite = {
  uci?: string;
  tag?: 'Genius'|'Best'|'Good'|'Inaccuracy'|'Mistake'|'Blunder'|'Book'|'Review'|null;
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
  onOfferDraw?: () => void;
  onBeginMatch?: () => void;
  onResign?: () => void;
  onNewGame: () => void;

  autoReply: boolean;
  setAutoReply: (v: boolean) => void;
  engineBusy: boolean;
  gameOver?: { reason: string; winner?: 'White' | 'Black' | null } | null;

  bestArrow?: { from: Square; to: Square } | null;
  onOrientationChange?: (o: 'white'|'black') => void;

  currentMoveEval?: MoveEvalLite | null;

  evalSeries?: Array<number | null>;
  showEvalGraph?: boolean;
  onToggleEvalGraph?: () => void;

  // Book context for on-board badge
  bookMask?: boolean[];
  currentPly?: number;
  lastMove?: { from: string; to: string } | null;
  customSquareStyles?: Record<string, React.CSSProperties>;

  // Player info
  whiteName?: string;
  blackName?: string;
  whiteAcc?: number | null;
  blackAcc?: number | null;
  whiteEstElo?: number | null;
  blackEstElo?: number | null;
  engineTargetElo?: number | null;
  engineTargetLabel?: string | null;
  engineTargetRange?: [number, number] | null;
  timeControlMinutes?: number;
  onTimeControlChange?: (n: number) => void;
  clockMs?: { w: number; b: number };
  clockRunning?: boolean;
  matchStarted?: boolean;
  engineError?: string | null;
  coachMomentNote?: CoachMomentNote | null;
  coachMoveNote?: CoachMoveNote | null;
  coachBoxOffset?: number;
};

/* --------------------------------- UI Kit -------------------------------- */

const ui = {
  row: { display: 'flex', gap: 14, flexWrap: 'wrap' as const, justifyContent: 'center' as const },
  col: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 } as React.CSSProperties,
  btn: {
    padding: '11px 14px',
    fontSize: 15,
    lineHeight: '19px',
    borderRadius: 12,
    border: '1px solid #1f2a3a',
    background: 'linear-gradient(180deg, #1f2b3d, #0f172a)',
    color: '#e9f1ff',
    boxShadow: '0 10px 26px rgba(0,0,0,.35)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontWeight: 600,
    letterSpacing: '0.2px',
  } as React.CSSProperties,
  btnIcon: {
    padding: '10px',
    width: 46,
    height: 46,
    minWidth: 46,
    borderRadius: 12,
    border: '1px solid #1f2a3a',
    background: 'linear-gradient(180deg, #1f2b3d, #0f172a)',
    color: '#e9f1ff',
    boxShadow: '0 10px 26px rgba(0,0,0,.35)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  select: {
    padding: '8px 10px',
    borderRadius: 10,
    background: '#0b1220',
    color: '#e9f1ff',
    border: '1px solid #203046',
    fontSize: 14,
  } as React.CSSProperties,
  pill: {
    padding: '8px 10px',
    borderRadius: 10,
    background: '#0b1220',
    border: '1px solid #203046',
    color: '#d7e5ff',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 14,
    boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
  } as React.CSSProperties,
  controlGrid: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 10,
    alignItems: 'stretch',
  } as React.CSSProperties,
  status: { fontSize: 12, color: '#9ca3af' },
  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 14px',
    borderRadius: 12,
    border: '1px solid #1f2a3a',
    background: '#0c1526',
    color: '#d7e5ff',
    cursor: 'pointer',
    boxShadow: '0 10px 26px rgba(0,0,0,.35)',
    userSelect: 'none' as const,
  } as React.CSSProperties,
};

/* ----------------------------- Small helpers ----------------------------- */

function fileIdx(f: string) {
  return 'abcdefgh'.indexOf(f) + 1;
}

function Icon({ name, size = 18 }: { name:
  'play'|'begin'|'clock'|'rewind'|'back'|'forward'|'end'|'plus'|'cpu'|'handshake'|'flag'|'repeat'|'knight'|'flip'|'kingW'|'kingB';
  size?: number;
}) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor' };
  switch (name) {
    case 'play':
    case 'begin':
      return <svg {...common}><path d="M7 5l12 7-12 7V5z" /></svg>;
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M12 7v6l4 2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>;
    case 'rewind':
      return <svg {...common}><path d="M7 12l9-6v12l-9-6z" /><path d="M6 6v12" stroke="currentColor" strokeWidth="2" /></svg>;
    case 'back':
      return <svg {...common}><path d="M16 6l-9 6 9 6V6z" /></svg>;
    case 'forward':
      return <svg {...common}><path d="M8 6l9 6-9 6V6z" /></svg>;
    case 'end':
      return <svg {...common}><path d="M18 6v12" stroke="currentColor" strokeWidth="2" /><path d="M8 6l9 6-9 6V6z" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
    case 'cpu':
      return <svg {...common}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
    case 'handshake':
      return <svg {...common}><path d="M7 13l2.5 2.5a2 2 0 002.8 0l2.2-2.2L17 14l2-2-2-2-2 1-2-2-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>;
    case 'flag':
      return <svg {...common}><path d="M6 4v16M8 4h8l-2 3 2 3H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>;
    case 'repeat':
      return <svg {...common}><path d="M4 11V7a1 1 0 011-1h10l-2-2 2 2-2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M20 13v4a1 1 0 01-1 1H9l2 2-2-2 2-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>;
    case 'knight':
      return <svg {...common}><path d="M16 5l-6 3-2 4 2 2v3H7v2h10v-2h-3v-5l3-3-1-4z" /></svg>;
    case 'flip':
      return <svg {...common}><path d="M7 10h8l-2-2 2 2-2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M17 14H9l2 2-2-2 2-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>;
    case 'kingW':
      return <svg {...common}><path d="M12 5v4M10 7h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M8 11h8l-1 6H9l-1-6z" /></svg>;
    case 'kingB':
      return <svg {...common}><path d="M12 6v3M11 7h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M8 10h8l-1 6H9l-1-6z" fill="currentColor" /></svg>;
    default:
      return null;
  }
}

function PlayerBadge({
  side,
  name,
  acc,
  estElo,
  clockMs,
}: {
  side: 'white' | 'black';
  name: string;
  acc: number | null | undefined;
  estElo: number | null | undefined;
  clockMs?: number | null;
}) {
  const isWhite = side === 'white';
  const totalSeconds = clockMs != null && isFinite(clockMs) ? Math.max(0, Math.floor(clockMs / 1000)) : null;
  const clockStr = totalSeconds != null
    ? `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
    : null;
  const lowTime = totalSeconds != null && totalSeconds < 30;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 10px',
      borderRadius: 8,
      background: '#111',
      border: '1px solid #1e1e1e',
    }}>
      <div style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: isWhite ? '#f0f0f0' : '#222',
        border: `1px solid ${isWhite ? '#aaa' : '#555'}`,
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: '#d0d0d0' }}>{name}</span>
      {acc != null && (
        <span style={{ fontSize: 11, color: '#666', marginLeft: 2 }}>{Math.round(acc)}%</span>
      )}
      {estElo != null && (
        <span style={{ fontSize: 11, color: '#555' }}>~{Math.round(estElo)}</span>
      )}
      {clockStr && (
        <span style={{
          marginLeft: 4,
          fontSize: 13,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: lowTime ? '#f87171' : '#9ca3af',
          letterSpacing: '0.02em',
        }}>
          {clockStr}
        </span>
      )}
    </div>
  );
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
function EvalBar({ cp, pending, height }: { cp: number | null; pending: boolean; height: number }) {
  const capped = cp == null ? 0 : Math.max(-1000, Math.min(1000, cp));
  const whitePct = Math.max(3, Math.min(97, 50 + capped / 20));
  const num = cp == null ? null : (cp / 100).toFixed(1);
  const label = num != null ? `${cp! >= 0 ? '+' : ''}${num}` : '—';
  const isWhiteAhead = (cp ?? 0) >= 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height }}>
      {/* Score label */}
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: isWhiteAhead ? '#f0f0f0' : '#888',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
        opacity: pending ? 0.6 : 1,
      }}>
        {label}
      </div>
      {/* Bar */}
      <div style={{
        width: 10,
        flex: 1,
        borderRadius: 999,
        overflow: 'hidden',
        background: '#1c1c1c',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ flex: `0 0 ${100 - whitePct}%`, background: '#222', transition: 'flex 300ms ease' }} />
        <div style={{ flex: `0 0 ${whitePct}%`, background: '#e8e8e8', transition: 'flex 300ms ease', borderRadius: '0 0 999px 999px' }} />
      </div>
    </div>
  );
}

/* ---------------------------------- View ---------------------------------- */

export default function BoardPane(props: BoardPaneProps) {
  const {
    fen, orientation, evalCp, evalPending, movesUci, ply,
    onUserDrop, onRebuildTo, onEngineMove, onOfferDraw, onBeginMatch, onResign, onNewGame,
    autoReply, setAutoReply, engineBusy, bestArrow, gameOver, timeControlMinutes, onTimeControlChange,
    clockMs, clockRunning, matchStarted, engineError,
    currentMoveEval, evalSeries, showEvalGraph,
    onOrientationChange, hasAnalysis,
  coachMomentNote,
  coachMoveNote,
  coachBoxOffset,
  } = props;
  const { customSquareStyles, bookMask, currentPly, lastMove } = props;
  const {
    whiteName = 'White',
    blackName = 'Black',
    whiteAcc = null,
    blackAcc = null,
    whiteEstElo = null,
    blackEstElo = null,
    engineTargetElo = null,
    engineTargetLabel = null,
    engineTargetRange = null,
  } = props;

  const { containerRef, boardWidth } = useStableBoardWidth();
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  // Clear any pending click-selection when position changes (e.g., after a move).
  useEffect(() => { setSelectedSquare(null); }, [fen]);

  // Eval number to display: prefer live cp; else fallback to last known
  const evalCpDisplay = useMemo(() => {
    if (typeof evalCp === 'number' && isFinite(evalCp)) return evalCp;
    return lastNumber(evalSeries);
  }, [evalCp, evalSeries]);
  const isGameOver = !!gameOver;
  const btnStyle = (disabled?: boolean) => ({
    ...ui.btn,
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });
  const outcomeText = useMemo(() => {
    if (!gameOver) return null;
    const { reason, winner } = gameOver;
    if (reason === 'checkmate') return `${winner || 'Winner'} wins by checkmate`;
    if (reason === 'stalemate') return 'Draw by stalemate';
    if (reason === 'threefold') return 'Draw by threefold repetition';
    if (reason === 'fifty-move') return 'Draw by fifty-move rule';
    if (reason === 'insufficient') return 'Draw by insufficient material';
    if (reason === 'agreement') return 'Draw by agreement';
    if (reason === 'resign') return `${winner || 'Opponent'} wins by resignation`;
    if (reason === 'flag') return `${winner || 'Opponent'} wins on time`;
    return 'Draw';
  }, [gameOver]);

  const formatClock = (ms?: number | null) => {
    if (ms == null || !isFinite(ms)) return '--:--';
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

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
    const base = customSquareStyles ? { ...customSquareStyles } : {};
    const tag = hasAnalysis ? currentMoveEval?.tag : null;
    const square = destSquare?.toLowerCase?.();
    if (square && (tag === 'Best' || tag === 'Blunder')) {
      const color = tag === 'Best' ? 'rgba(46,204,113,0.55)' : 'rgba(231,76,60,0.55)';
      base[square] = {
        ...(base[square] || {}),
        boxShadow: `inset 0 0 0 4px ${color}`,
        background: `radial-gradient(circle at center, ${color} 0%, ${color} 40%, transparent 75%)`,
      };
    }
    if (selectedSquare) {
      const key = selectedSquare.toLowerCase();
      base[key] = {
        ...(base[key] || {}),
        boxShadow: 'inset 0 0 0 3px rgba(88,166,255,0.8)',
        background: 'radial-gradient(circle at center, rgba(88,166,255,0.25) 0%, rgba(88,166,255,0.18) 45%, transparent 70%)',
      };
    }
    return base;
  }, [customSquareStyles, hasAnalysis, currentMoveEval?.tag, destSquare, selectedSquare]);

  function onPieceDrop(from: string, to: string) {
    const ok = onUserDrop(from, to);
    if (ok) setSelectedSquare(null);
    return ok;
  }

  // Allow click-to-move: first click selects a source, second click attempts the move.
  function handleSquareClick(square: Square) {
    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }
    if (selectedSquare) {
      const ok = onUserDrop(selectedSquare, square);
      if (ok) {
        setSelectedSquare(null);
      } else {
        setSelectedSquare(square);
      }
      return;
    }
    setSelectedSquare(square);
  }

  /* ------------------------------ Layout numbers ------------------------------ */

  // Eval bar matches board height
  const evalBarHeight = boardWidth;
  // Make the eval graph taller but keep width aligned to the board.
  const sparklineWidth = boardWidth;
  const evalColWidth = 180;
  // Keep badges and main row aligned to the board (eval bar floats to the right).
  const layoutWidth = boardWidth;
  const graphOffset = 0;
  const coachOverlayWidth = Math.min(280, Math.max(220, Math.floor(boardWidth * 0.23)));
  const coachOverlayOutsideGap = coachBoxOffset ?? (coachOverlayWidth + 28);
  const coachOverlayDockInside = boardWidth < 760;
  const coachOverlayPositionStyle = coachOverlayDockInside
    ? { right: 12 }
    : { left: -coachOverlayOutsideGap };
  const keyframes = `
    @keyframes popFade {
      0% { transform: scale(0.9); opacity: 0; }
      30% { transform: scale(1.02); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
  `;

  /* --------------------------------- Render --------------------------------- */

  const EVAL_BAR_W = 14;
  const EVAL_GAP = 8;
  const boardSide = orientation === 'white' ? 'black' : 'white';
  const boardSideName = boardSide === 'white' ? whiteName : blackName;
  const boardSideAcc = boardSide === 'white' ? whiteAcc : blackAcc;
  const boardSideElo = boardSide === 'white' ? whiteEstElo : blackEstElo;
  const boardSideClock = boardSide === 'white' ? clockMs?.w : clockMs?.b;
  const bottomSide = orientation;
  const bottomName = bottomSide === 'white' ? whiteName : blackName;
  const bottomAcc = bottomSide === 'white' ? whiteAcc : blackAcc;
  const bottomElo = bottomSide === 'white' ? whiteEstElo : blackEstElo;
  const bottomClock = bottomSide === 'white' ? clockMs?.w : clockMs?.b;

  const iconBtn = (disabled = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 36, height: 36, borderRadius: 8,
    border: '1px solid #232323', background: '#141414',
    color: disabled ? '#333' : '#888',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 100ms, color 100ms',
    flexShrink: 0,
  });
  const textBtn = (disabled = false, accent = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    border: `1px solid ${accent ? '#1a3d2b' : '#222'}`,
    background: accent ? '#0a1f14' : '#131313',
    color: disabled ? '#333' : accent ? '#4ade80' : '#aaa',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 100ms',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: 0 }}>
      <style>{keyframes}</style>

      {/* Opponent badge (top) */}
      <div style={{ width: boardWidth + EVAL_BAR_W + EVAL_GAP, marginBottom: 6, paddingLeft: EVAL_BAR_W + EVAL_GAP }}>
        <PlayerBadge side={boardSide} name={boardSideName} acc={boardSideAcc} estElo={boardSideElo} clockMs={boardSideClock} />
      </div>

      {/* Board row: eval bar + board */}
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'row', gap: EVAL_GAP, alignItems: 'stretch', position: 'relative' }}>
        {/* Eval bar (left) */}
        <div style={{ width: EVAL_BAR_W, height: boardWidth, flexShrink: 0 }}>
          <EvalBar cp={evalCpDisplay} pending={Boolean(evalPending)} height={boardWidth} />
        </div>

        {/* Board */}
        <div style={{ position: 'relative', width: boardWidth, flexShrink: 0 }}>
          <Chessboard
            id="analysis"
            position={fen}
            boardOrientation={orientation}
            boardWidth={boardWidth}
            animationDuration={150}
            customBoardStyle={{ borderRadius: 4, overflow: 'hidden' }}
            customArrows={arrows as any}
            customSquareStyles={mergedSquareStyles}
            onPieceDrop={onPieceDrop}
            onSquareClick={handleSquareClick}
          />

          {/* Move quality badge */}
          {badgePos && (
            <div style={{ position: 'absolute', left: badgePos.left, top: badgePos.top, width: badgeSize, height: badgeSize, pointerEvents: 'auto' }}>
              <RenderBadge tag={overlayTag} size={badgeSize} />
            </div>
          )}

          {/* Coach overlay */}
          {(coachMomentNote || coachMoveNote) && (
            <div style={{
              position: 'absolute',
              top: Math.max(12, boardWidth * 0.08),
              ...coachOverlayPositionStyle,
              width: coachOverlayWidth,
              background: 'rgba(10,10,10,0.95)',
              border: '1px solid #2a2a2a',
              borderRadius: 10,
              padding: '10px 12px',
              color: '#d0d0d0',
              fontSize: 13,
              lineHeight: '20px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
              zIndex: 5,
            }}>
              {coachMomentNote ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12, marginBottom: 5, color: '#888' }}>
                    <span>Move {coachMomentNote.moveNo}{coachMomentNote.side === 'B' ? '…' : '.'} {coachMomentNote.san || '?'}</span>
                    {coachMomentNote.label ? <TagBadge tag={coachMomentNote.label as any} size={16} /> : null}
                  </div>
                  <div>{clampSentences(coachMomentNote.why, 2)}</div>
                </>
              ) : coachMoveNote ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12, marginBottom: 5, color: '#888' }}>
                    <span>{coachMoveNote.bubbleTitle || `Move ${coachMoveNote.moveNo}`}</span>
                    {coachMoveNote.tag ? <TagBadge tag={coachMoveNote.tag as any} size={16} /> : null}
                  </div>
                  <div>{coachMoveNote.text}</div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Player badge (bottom) */}
      <div style={{ width: boardWidth + EVAL_BAR_W + EVAL_GAP, marginTop: 6, paddingLeft: EVAL_BAR_W + EVAL_GAP }}>
        <PlayerBadge side={bottomSide} name={bottomName} acc={bottomAcc} estElo={bottomElo} clockMs={bottomClock} />
      </div>

      {/* Optional eval sparkline */}
      {props.showEvalGraph !== false && evalSeries && evalSeries.length > 0 && (
        <div style={{
          width: boardWidth,
          marginTop: 10,
          marginLeft: EVAL_BAR_W + EVAL_GAP,
          background: '#0d0d0d',
          border: '1px solid #1a1a1a',
          borderRadius: 8,
        }}>
          <EvalSparkline series={evalSeries} height={80} onClickIndex={(i) => props.onRebuildTo(i + 1)} />
        </div>
      )}

      {/* Game outcome banner */}
      {outcomeText && (
        <div style={{
          marginTop: 10,
          padding: '8px 16px',
          borderRadius: 8,
          background: '#111',
          border: '1px solid #2a2a2a',
          color: '#e0e0e0',
          fontSize: 13,
          fontWeight: 600,
          animation: 'popFade 0.5s ease',
        }}>
          {outcomeText}
        </div>
      )}

      {/* Navigation controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: EVAL_BAR_W + EVAL_GAP }}>
        <button style={iconBtn(ply === 0)} onClick={() => onRebuildTo(0)} disabled={ply === 0} title="First"><Icon name="rewind" size={16} /></button>
        <button style={iconBtn(ply === 0)} onClick={() => onRebuildTo(Math.max(0, ply - 1))} disabled={ply === 0} title="Back"><Icon name="back" size={16} /></button>
        <button style={iconBtn(ply >= movesUci.length)} onClick={() => onRebuildTo(Math.min(movesUci.length, ply + 1))} disabled={ply >= movesUci.length} title="Forward"><Icon name="forward" size={16} /></button>
        <button style={iconBtn(ply >= movesUci.length)} onClick={() => onRebuildTo(movesUci.length)} disabled={ply >= movesUci.length} title="Last"><Icon name="end" size={16} /></button>
        <div style={{ width: 1, height: 24, background: '#222', margin: '0 4px' }} />
        <button style={iconBtn(false)} onClick={() => onOrientationChange?.(orientation === 'white' ? 'black' : 'white')} title="Flip board"><Icon name="flip" size={16} /></button>
        <button style={iconBtn(false)} onClick={onNewGame} title="New game"><Icon name="plus" size={16} /></button>
      </div>

      {/* Game action controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center', marginLeft: EVAL_BAR_W + EVAL_GAP }}>
        {/* Time + Begin */}
        <select
          value={timeControlMinutes ?? 10}
          onChange={(e) => onTimeControlChange?.(Number(e.target.value) || 10)}
          style={{
            padding: '5px 8px', borderRadius: 7, background: '#111', color: '#888',
            border: '1px solid #222', fontSize: 12, cursor: 'pointer',
          }}
          disabled={isGameOver}
        >
          {[3, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m}m</option>)}
        </select>
        <button style={textBtn(isGameOver || !!clockRunning, true)} onClick={onBeginMatch} disabled={isGameOver || !!clockRunning}>
          <Icon name="play" size={14} />{matchStarted ? 'Resume' : 'Begin'}
        </button>
        <button style={textBtn(engineBusy || isGameOver)} onClick={onEngineMove} disabled={engineBusy || isGameOver}>
          <Icon name="cpu" size={14} />Engine
        </button>
        <button
          style={textBtn(engineBusy || !onOrientationChange || isGameOver)}
          onClick={() => { onOrientationChange?.('black'); if (ply === 0) onEngineMove(); }}
          disabled={engineBusy || !onOrientationChange || isGameOver}
        >
          <Icon name="knight" size={14} />Play as Black
        </button>
        <label style={{ ...textBtn(isGameOver), cursor: isGameOver ? 'not-allowed' : 'pointer' }}>
          <input type="checkbox" checked={autoReply} onChange={e => setAutoReply(e.target.checked)} disabled={isGameOver} style={{ accentColor: '#4ade80', margin: 0 }} />
          <Icon name="repeat" size={14} />Auto
        </label>
        <button style={textBtn(isGameOver || !onResign)} onClick={onResign} disabled={isGameOver || !onResign}>
          <Icon name="flag" size={14} />Resign
        </button>
      </div>

      {engineError && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#f87171' }}>Engine: {engineError}</div>
      )}
    </div>
  );
}
