import React from 'react';
import CoachMoveList from './CoachMoveList';
import type { CoachNote } from '../useCoach';

export type CoachPanelProps = {
  notes: CoachNote[];
  activeNotes?: CoachNote[] | null;
  busy?: boolean;
  error?: string | null;
  onGenerate?: () => void;
  onJumpToPly?: (ply: number) => void;
  currentPly: number;
};

export default function CoachPanel({
  notes,
  activeNotes,
  busy = false,
  error,
  onGenerate,
  onJumpToPly,
  currentPly,
}: CoachPanelProps) {
  const activeKey = (n: CoachNote) =>
    `${n?.type}:${n?.type === 'move' ? n.moveIndex : ''}:${n?.text || ''}`;
  const activeList = (activeNotes || []).map((n, i) => (
    <div key={`${activeKey(n)}-${i}`} style={{ lineHeight: '18px' }}>
      {n.type === 'move'
        ? <>
            <strong>Move {(n.moveIndex ?? 0) + 1}:</strong> {n.text}
          </>
        : n.text}
    </div>
  ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Coach</div>
        <button
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #333',
            background: busy ? '#2a2a2a' : '#1f1f1f',
            color: '#eee',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
          onClick={() => !busy && onGenerate?.()}
          disabled={busy}
        >
          {busy ? 'Generating…' : 'Generate notes'}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 13, color: '#f28b3c' }}>{error}</div>
      )}
      {busy && (
        <div style={{ fontSize: 13, color: '#bdbdbd' }}>The coach is analysing this game…</div>
      )}
      {!!activeList.length && (
        <div style={{
          border: '1px dashed #444',
          borderRadius: 6,
          padding: '6px 10px',
          color: '#ddd',
          fontSize: 13,
        }}>
          {activeList}
        </div>
      )}
      <CoachMoveList
        notes={notes}
        currentPly={currentPly}
        onJumpToPly={(idx) => onJumpToPly?.(idx + 1)}
      />
      {!notes.length && (
        <div style={{ fontSize: 13, color: '#8f8f8f' }}>No coach notes yet.</div>
      )}
    </div>
  );
}
