import React from 'react';

type Note = { type: 'intro'|'move'|'summary'; text: string; moveIndex?: number };

export default function CoachMoveList({
  notes,
  currentPly,
  onJumpToPly,
  style,
}: {
  notes: Note[];
  currentPly: number;               // 1-based ply pointer in your app
  onJumpToPly: (idx: number) => void; // idx is 0-based moveIndex
  style?: React.CSSProperties;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const moves = React.useMemo(
    () => notes
      .filter(n => n.type === 'move' && Number.isInteger(n.moveIndex))
      .sort((a, b) => (a.moveIndex! - b.moveIndex!)),
    [notes]
  );
  const extras = React.useMemo(
    () => notes.filter(n => n.type !== 'move'),
    [notes]
  );

  const activeIdx = Math.max(0, currentPly - 1);
  const activeRow = React.useMemo(
    () => moves.findIndex(n => n.moveIndex === activeIdx),
    [moves, activeIdx]
  );

  const movesRef = React.useRef(moves);
  const activeRowRef = React.useRef(activeRow);
  const onJumpRef = React.useRef(onJumpToPly);
  React.useEffect(() => { movesRef.current = moves; }, [moves]);
  React.useEffect(() => { activeRowRef.current = activeRow; }, [activeRow]);
  React.useEffect(() => { onJumpRef.current = onJumpToPly; }, [onJumpToPly]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Only handle j/k and Home/End here; let Arrow keys fall through to board navigation.
      if (e.key === 'j') {
        const next = Math.min(movesRef.current.length - 1, activeRowRef.current + 1);
        if (next >= 0) onJumpRef.current(movesRef.current[next].moveIndex!);
      } else if (e.key === 'k') {
        const prev = Math.max(0, activeRowRef.current - 1);
        if (prev >= 0) onJumpRef.current(movesRef.current[prev].moveIndex!);
      } else if (e.key === 'Home') {
        if (movesRef.current.length) onJumpRef.current(movesRef.current[0].moveIndex!);
      } else if (e.key === 'End') {
        if (movesRef.current.length) onJumpRef.current(movesRef.current[movesRef.current.length - 1].moveIndex!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // subscribe once with refs

  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLDivElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeRow]);

  return (
    <div
      ref={listRef}
      style={{
        border:'1px solid #333',
        borderRadius:10,
        padding:10,
        background:'#1b1b1b',
        maxHeight:260,
        overflow:'auto',
        ...style,
      }}
    >
      <div style={{ fontWeight:600, marginBottom:8 }}>Coach review (j/k to scroll)</div>
      {moves.map((n, i) => {
        const isActive = i === activeRow;
        return (
          <div
            key={n.moveIndex}
            data-active={isActive ? 'true' : undefined}
            onClick={() => onJumpToPly(n.moveIndex!)}
            style={{
              cursor:'pointer',
              marginBottom:6,
              padding:'6px 8px',
              borderRadius:6,
              background: isActive ? '#2a2a2a' : 'transparent',
              border: isActive ? '1px solid #555' : '1px solid transparent',
              color:'#ddd',
              fontSize:14,
              lineHeight:'18px',
              userSelect:'none',
            }}
            title={`Move #${(n.moveIndex ?? -1) + 1}`}
          >
            {(n.moveIndex ?? 0) + 1}. {n.text}
          </div>
        );
      })}
      {!moves.length && extras.map((n, i) => (
        <div key={`extra-${i}`} style={{ marginBottom:6, color:'#ddd', fontSize:14, lineHeight:'18px' }}>
          {n.text}
        </div>
      ))}
      {!moves.length && !extras.length && <div style={{ opacity:.6, fontSize:13 }}>No coach notes yet.</div>}
    </div>
  );
}
