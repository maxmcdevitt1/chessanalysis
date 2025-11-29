// webui/src/CoachPanel.tsx
import React from 'react';
import type { CommentaryBlock } from './CommentaryService';

export default function CoachPanel({
  coach,
  coachBusy,
  coachErr
}: {
  coach: CommentaryBlock | null;
  coachBusy: boolean;
  coachErr: string | null;
}) {
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
    </div>
  );
}
