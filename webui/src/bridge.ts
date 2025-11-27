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
