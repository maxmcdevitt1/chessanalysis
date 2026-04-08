// webui/src/CoachPanel2.tsx
import React from 'react';
import type { CoachInputs } from './useCoach';
import { useCoach } from './useCoach';

export default function CoachPanel2({ inputs, onJump }:{ inputs: CoachInputs; onJump: (i:number)=>void }){
  const { notes, busy, err, run } = useCoach();
  return (
    <div style={{ border:'1px solid #333', borderRadius:6, padding:12, display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button onClick={()=>run(inputs)} disabled={busy}>{busy ? 'Coach…' : 'Generate notes'}</button>
        {err && <span style={{ color:'#c33' }}>{err}</span>}
      </div>
      <ul style={{ margin:0, paddingLeft:18, maxHeight:200, overflow:'auto' }}>
        {notes?.map((n,i)=>(
          <li key={i}>
            {n.type === 'move'
              ? <a onClick={()=>onJump(n.moveIndex)} role="button">{n.text}</a>
              : <span>{n.text}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
