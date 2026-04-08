import { memo, useMemo } from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import type { MoveEval } from '../types/moveEval';

type MovesTableProps = {
  moves: MoveEval[];
  bookMask: boolean[];
  bookDepth: number;
  onJump: (ply: number) => void;
  currentPly: number;
  height?: number;
};

const HEADER_LABELS = ['#', 'SAN', 'Best', 'Eval', 'Tag'];
const ROW_HEIGHT = 34;

function tagColor(tag: MoveEval['tag'] | 'Opening') {
  if (tag === 'Blunder') return '#d70a0aff';
  if (tag === 'Mistake') return '#f28b3c';
  if (tag === 'Inaccuracy') return '#f4c430';
  if (tag === 'Best' || tag === 'Genius') return '#6dd679';
  if (tag === 'Book' || tag === 'Opening') return '#aa8e68ff';
  return '#cfd5dd';
}

function beforeAfterDeltaWhite(m: MoveEval): number | null {
  const moverIsWhite = m.side === 'White';
  const afterWhite = (() => {
    if (typeof m?.cpAfterWhite === 'number') return m.cpAfterWhite;
    if (typeof m?.cpAfter === 'number') {
      return moverIsWhite ? -m.cpAfter : m.cpAfter;
    }
    return null;
  })();
  const beforeWhite = (() => {
    if (typeof m?.cpBefore === 'number') return m.cpBefore;
    if (typeof m?.bestCpBefore === 'number') {
      return moverIsWhite ? m.bestCpBefore : -m.bestCpBefore;
    }
    return null;
  })();
  if (afterWhite == null || beforeWhite == null) return null;
  return afterWhite - beforeWhite;
}

function formatDelta(cpDelta: number | null) {
  if (cpDelta == null || !isFinite(cpDelta)) return '—';
  const pawns = cpDelta / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

const MovesTable = memo(function MovesTable({
  moves,
  bookMask,
  bookDepth,
  onJump,
  currentPly,
  height = 520,
}: MovesTableProps) {
  const itemData = useMemo(() => ({
    moves,
    bookMask,
    bookDepth,
    onJump,
    currentPly,
  }), [moves, bookMask, bookDepth, onJump, currentPly]);

  const Row = ({ index, style, data }: ListChildComponentProps<typeof itemData>) => {
    const move = data.moves[index];
    if (!move) return null;
    const isOpening = (index < data.bookMask.length ? data.bookMask[index] : index < data.bookDepth);
    const tag = isOpening ? 'Book' : (move.tag || 'Good');
    const isActive = index === data.currentPly - 1;
    return (
      <div
        style={{
          ...style,
          display: 'grid',
          gridTemplateColumns: '36px 1fr 1fr 80px 70px',
          gap: 6,
          padding: '0 6px',
          alignItems: 'center',
          background: isActive ? '#24221f' : 'transparent',
          cursor: 'pointer',
        }}
        onClick={() => data.onJump(index + 1)}
      >
        <div style={{ color: '#cfd5dd', fontSize: 13 }}>{move.moveNo}</div>
        <div style={{ color: '#f7f7f7', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {move.san}
        </div>
        <div style={{ color: '#aeb6c2', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {move.best || ''}
        </div>
        <div style={{ color: '#d5dce4', fontSize: 13 }}>
          {formatDelta(beforeAfterDeltaWhite(move))}
        </div>
        <div style={{ color: tagColor(tag), fontWeight: 600, fontSize: 13 }}>{tag}</div>
      </div>
    );
  };

  return (
    <div style={{
      width: '100%',
      background: '#1d1b18',
      border: '1px solid #2a2a2a',
      borderRadius: 10,
      padding: 12,
      height: '100%',
      minHeight: 0,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: '#eee' }}>Moves</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr 1fr 80px 70px',
        gap: 6,
        padding: '0 6px',
        color: '#aaa',
        fontSize: 12,
        borderBottom: '1px solid #2f2f2f',
      }}>
        {HEADER_LABELS.map((h) => (
          <div key={h} style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</div>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <List
          height={height}
          itemSize={ROW_HEIGHT}
          width="100%"
          itemCount={moves.length}
          itemData={itemData}
        >
          {Row}
        </List>
      </div>
    </div>
  );
});

export default MovesTable;
