const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;

type Info = { cp?: number; mate?: number };
type AnalyzeRes = { bestMove?: string; infos?: Info[] };

export async function analyzeFen(fen: string, opts: any = {}): Promise<AnalyzeRes> {
  const api = (typeof window !== 'undefined' && (window as any).engine) || null;
  if (api?.analyzeFen) return api.analyzeFen(fen, opts);
  if (isDev) return { bestMove: undefined, infos: [{ cp: 0 }] };
  throw new Error('engine offline');
}

export async function reviewPgn(pgn: string, opts: any = {}) {
  const api = (typeof window !== 'undefined' && (window as any).engine) || null;
  if (api?.reviewPgn) return api.reviewPgn(pgn, opts);
  if (isDev) return { ok: true, result: null };
  throw new Error('engine offline');
}

export async function getCapabilities() {
  const api = (typeof window !== 'undefined' && (window as any).engine) || null;
  if (api?.getCapabilities) return api.getCapabilities();
  throw new Error('engine offline');
}

export async function setStrength(elo: number){
  const api = (typeof window !== 'undefined' && (window as any).engine) || null;
  if (api?.setStrength) return api.setStrength({ elo });
  throw new Error('engine offline');
}

export async function moveWeak(fen: string, opts: any = {}){
  const api = (typeof window !== 'undefined' && (window as any).engine) || null;
  if (api?.moveWeak) return api.moveWeak({ fen, movetimeMs: opts?.movetimeMs ?? 300, multiPv: opts?.multiPv ?? 1 });
  if (isDev) return analyzeFen(fen, opts);
  throw new Error('engine offline');
}

export async function reviewFast(fens: string[], opts: any = {}) {
  const api = (typeof window !== 'undefined' && (window as any).engine) || null;
  if (api?.reviewFast) return api.reviewFast(fens, opts);
  if (isDev) {
    return fens.map((_, idx) => ({ idx, bestMove: null, score: { type: 'cp', value: 0 } }));
  }
  throw new Error('engine offline');
}
