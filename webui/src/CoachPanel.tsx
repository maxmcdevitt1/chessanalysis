// webui/src/CoachPanel.tsx
import React, { useEffect, useRef } from 'react';
import type { CommentaryBlock } from './CommentaryService';

type Note = { type: 'intro' | 'move' | 'summary'; text: string; moveIndex?: number };

export default function CoachPanel({
  coach,
  coachBusy,
  coachErr,
  notes = [],
}: {
  coach: CommentaryBlock | null;
  coachBusy: boolean;
  coachErr: string | null;
  notes?: Note[];
}) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notes]);

  if (coachBusy) {
    return <div style={{ border:'1px solid #333', borderRadius:6, padding:12 }}>Coach: generating…</div>;
  }
  if (coachErr) {
    return <div style={{ border:'1px solid #333', borderRadius:6, padding:12, color:'#ff8585' }}>Coach error: {coachErr}</div>;
  }
  if (!coach) return null;
  return (
    <div style={{ border:'1px solid #333', borderRadius:6, padding:12 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>Coach Notes</div>
      <div style={{ opacity:0.95, marginBottom:8 }}>{coach.intro}</div>
      <div style={{ maxHeight:180, overflow:'auto', border:'1px solid #333', borderRadius:6, padding:8 }}>
        {coach.perMove.map((c, i) => (
          <div key={i} style={{ marginBottom:6 }}>
            <strong style={{ opacity:0.8 }}>ply {c.ply + 1}:</strong> {c.text}
          </div>
        ))}
      </div>
      <div style={{ marginTop:8, opacity:0.95 }}>{coach.closing}</div>
      <div style={{ marginTop:12, maxHeight:160, overflow:'auto', borderTop:'1px solid #333', paddingTop:8 }}>
        {notes.length ? notes.map((n, i) => {
          const isActive = i === 0;
          return (
            <div
              key={`${n.type}-${n.moveIndex ?? i}-${n.text.slice(0, 20)}`}
              ref={isActive ? activeRef : null}
              style={{
                marginBottom: 6,
                padding: '6px 8px',
                borderRadius: 6,
                background: isActive ? '#2a2a2a' : 'transparent',
                border: isActive ? '1px solid #555' : '1px solid transparent',
                color: '#ddd',
                fontSize: 14,
                lineHeight: '18px',
              }}
              title={n.type === 'move' && typeof n.moveIndex === 'number' ? `Move #${n.moveIndex + 1}` : n.type}
            >
              {n.text}
            </div>
          );
        }) : (
          <div style={{ opacity: 0.6, fontSize: 13 }}>No note for this move.</div>
        )}
      </div>
    </div>
  );
}
