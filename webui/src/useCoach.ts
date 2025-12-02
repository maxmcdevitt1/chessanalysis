// webui/src/useCoach.ts
import { useState, useCallback } from 'react';

export type CoachNote =
  | { type:'intro'; text:string }
  | { type:'move'; moveIndex:number; text:string }
  | { type:'summary'; text:string };

export type CoachInputs = {
  summary: { opening?:string; whiteAcc?:number; blackAcc?:number; avgCplW?:number; avgCplB?:number };
  moments: Array<{ index:number; moveNo:number; side:'W'|'B'|'White'|'Black'; san:string; tag:string; cpBefore?:number|null; cpAfter?:number|null; best?:string|null }>;
  pgn?: string;
};

export function useCoach(){
  const [notes, setNotes] = useState<CoachNote[]|null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const run = useCallback(async (inputs: CoachInputs) => {
    setBusy(true); setErr(null);
    try{
      // @ts-ignore
      const res = await window.coach?.generate(inputs);
      if (!res || res.offline) { setErr('Coach offline'); setNotes(null); }
      else setNotes(res.notes || null);
    } catch(e:any){
      setErr(String(e?.message||e));
    } finally{
      setBusy(false);
    }
  }, []);
  return { notes, busy, err, run };
}
