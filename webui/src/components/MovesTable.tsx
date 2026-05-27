import { memo, useMemo, useRef, useEffect } from 'react';
import type { MoveEval } from '../types/moveEval';

type MovesTableProps = {
  moves: MoveEval[];
  bookMask: boolean[];
  bookDepth: number;
  onJump: (ply: number) => void;
  currentPly: number;
  height?: number;
};

type PairedRow = {
  moveNo: number;
  white: MoveEval | null;
  whitePly: number;
  black: MoveEval | null;
  blackPly: number;
};

function resolveTag(move: MoveEval | null, ply: number, bookMask: boolean[], bookDepth: number): MoveEval['tag'] | 'Book' | null {
  if (!move) return null;
  const inBook = ply - 1 < bookMask.length ? bookMask[ply - 1] : ply - 1 < bookDepth;
  if (inBook) return 'Book';
  return move.tag ?? null;
}

function qualityDot(tag: MoveEval['tag'] | 'Book' | null) {
  const colors: Record<string, string> = {
    Best:       '#4ade80',
    Genius:     '#4ade80',
    Good:       '#60a5fa',
    Inaccuracy: '#facc15',
    Mistake:    '#fb923c',
    Blunder:    '#f87171',
    Book:       '#a78bfa',
  };
  const c = tag ? (colors[tag] ?? null) : null;
  if (!c) return null;
  return (
    <span style={{
      display: 'inline-block',
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: c,
      flexShrink: 0,
      boxShadow: `0 0 4px ${c}88`,
    }} title={tag ?? ''} />
  );
}

const MovesTable = memo(function MovesTable({
  moves,
  bookMask,
  bookDepth,
  onJump,
  currentPly,
  height = 520,
}: MovesTableProps) {
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  const rows: PairedRow[] = useMemo(() => {
    const out: PairedRow[] = [];
    for (let i = 0; i < moves.length; i += 2) {
      const w = moves[i] ?? null;
      const b = moves[i + 1] ?? null;
      out.push({
        moveNo: w?.moveNo ?? Math.floor(i / 2) + 1,
        white: w,
        whitePly: i + 1,
        black: b,
        blackPly: i + 2,
      });
    }
    return out;
  }, [moves]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentPly]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#0e0e0e',
      borderRight: '1px solid #1a1a1a',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '1px solid #1a1a1a',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#555',
        display: 'grid',
        gridTemplateColumns: '28px 1fr 1fr',
        gap: 4,
      }}>
        <span>#</span>
        <span>White</span>
        <span>Black</span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {rows.length === 0 && (
          <div style={{ padding: '24px 14px', color: '#444', fontSize: 13, textAlign: 'center' }}>
            No moves yet
          </div>
        )}
        {rows.map((row) => {
          const wActive = currentPly === row.whitePly;
          const bActive = currentPly === row.blackPly;
          const wTag = resolveTag(row.white, row.whitePly, bookMask, bookDepth);
          const bTag = resolveTag(row.black, row.blackPly, bookMask, bookDepth);
          const rowActive = wActive || bActive;
          return (
            <div
              key={row.moveNo}
              ref={rowActive ? activeRowRef : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px 1fr 1fr',
                gap: 2,
                padding: '0 6px',
                background: rowActive ? '#171717' : 'transparent',
              }}
            >
              {/* Move number */}
              <div style={{
                padding: '6px 4px 6px 8px',
                fontSize: 12,
                color: '#444',
                fontVariantNumeric: 'tabular-nums',
                userSelect: 'none',
                alignSelf: 'center',
              }}>
                {row.moveNo}
              </div>

              {/* White move */}
              <MoveCell
                move={row.white}
                tag={wTag}
                active={wActive}
                onClick={() => row.white && onJump(row.whitePly)}
              />

              {/* Black move */}
              <MoveCell
                move={row.black}
                tag={bTag}
                active={bActive}
                onClick={() => row.black && onJump(row.blackPly)}
              />
            </div>
          );
        })}
        {/* spacer */}
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
});

function MoveCell({
  move,
  tag,
  active,
  onClick,
}: {
  move: MoveEval | null;
  tag: MoveEval['tag'] | 'Book' | null;
  active: boolean;
  onClick: () => void;
}) {
  if (!move) return <div />;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 6px',
        borderRadius: 5,
        cursor: 'pointer',
        background: active ? '#2a2a2a' : 'transparent',
        transition: 'background 80ms',
        fontSize: 13,
        fontWeight: active ? 700 : 400,
        color: active ? '#f0f0f0' : '#b0b0b0',
        fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {qualityDot(tag)}
      <span>{move.san}</span>
    </div>
  );
}

export default MovesTable;
