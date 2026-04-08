import { analyzeFen, identifyOpening as identifyOpeningBridge, reviewFast as reviewFastBridge } from '../bridge';
import { Chess } from '../chess-compat';
import type {
  AnalyseRequest,
  EngineAdapter,
  EngineAnalysis,
  EngineInfo,
  EvalScore,
  OpeningDetection,
  OpeningDetectionRequest,
  ReviewFastEntry,
  ReviewFastRequest,
} from './types';

type WorkerResult =
  | { type: 'engine-worker-ready' }
  | { type: 'result'; id: number; payload: any }
  | { type: 'error'; id: number; error: string };

type HostCall = { type: 'hostCall'; id: number; method: 'analyse' | 'reviewFast' | 'identifyOpening'; payload: any };

type PendingCall = {
  resolve: (value: any) => void;
  reject: (err: any) => void;
  abort?: () => void;
};

function extractScore(raw: any): EvalScore | null {
  if (!raw) return null;
  if (typeof raw.type === 'string' && (raw.type === 'cp' || raw.type === 'mate') && Number.isFinite(raw.value)) {
    return { type: raw.type, value: Number(raw.value) };
  }
  if (typeof raw.cp === 'number' && Number.isFinite(raw.cp)) return { type: 'cp', value: Number(raw.cp) };
  if (typeof raw.mate === 'number' && Number.isFinite(raw.mate)) return { type: 'mate', value: Number(raw.mate) };
  if (typeof raw.score === 'number' && Number.isFinite(raw.score) && raw.type === 'cp') {
    return { type: 'cp', value: Number(raw.score) };
  }
  if (typeof raw.score === 'number' && Number.isFinite(raw.score) && raw.type === 'mate') {
    return { type: 'mate', value: Number(raw.score) };
  }
  return null;
}

function depthValue(entry: any) {
  return Number(entry?.depth ?? entry?.Depth ?? entry?.seldepth ?? 0) || 0;
}

function toEngineInfos(res: any, fallbackMove: string | null): EngineInfo[] {
  const infos = Array.isArray(res?.infos) ? res.infos : [];
  if (!infos.length && fallbackMove) {
    return [{
      move: fallbackMove,
      multipv: 1,
      score: { type: 'cp', value: 0 },
      pv: fallbackMove ? [fallbackMove] : [],
    }];
  }
  const latestDepth = Math.max(0, ...infos.map(depthValue));
  const finalInfos = infos.filter((inf: any) => depthValue(inf) === latestDepth);
  const byMove = new Map<string, EngineInfo>();
  const scoreRank = (score: EvalScore | null) => {
    if (!score) return -Infinity;
    if (score.type === 'mate') return mateToCp(score.value);
    return score.value;
  };
  for (const entry of finalInfos) {
    const pv = Array.isArray(entry?.pv) ? entry.pv : undefined;
    const move = pv?.[0] || fallbackMove;
    if (!move) continue;
    const score = extractScore(entry);
    if (!score) continue;
    const info: EngineInfo = {
      move,
      multipv: Number(entry?.multipv ?? entry?.multiPv ?? 1) || 1,
      depth: depthValue(entry),
      nodes: Number(entry?.nodes ?? entry?.Nodes) || undefined,
      pv,
      score,
    };
    const prev = byMove.get(move);
    if (!prev || scoreRank(prev.score) < scoreRank(info.score)) {
      byMove.set(move, info);
    }
  }
  return Array.from(byMove.values()).sort((a, b) => scoreRank(b.score) - scoreRank(a.score));
}

function mateToCp(mate: number): number {
  const cp = 10000 - Math.min(99, Math.abs(mate)) * 100;
  return mate >= 0 ? cp : -cp;
}

async function hostAnalyse(payload: AnalyseRequest): Promise<EngineAnalysis> {
  const { fen, multipv, movetime } = payload;
  const res = await analyzeFen(fen, { multiPv: multipv, movetimeMs: movetime });
  const bestMove = (res as any)?.bestMove ?? null;
  const infos = toEngineInfos(res, bestMove);
  let sideToMove: 'w' | 'b' = 'w';
  try {
    const g = new Chess(fen);
    sideToMove = g.turn() as 'w' | 'b';
  } catch {
    sideToMove = 'w';
  }
  return { sideToMove, infos };
}

async function hostReviewFast(payload: ReviewFastRequest): Promise<ReviewFastEntry[]> {
  const { movesUci, elo, options } = payload;
  const g = new Chess();
  const fens: string[] = [];
  fens.push(g.fen());
  for (const mv of movesUci) {
    const move = {
      from: mv.slice(0, 2),
      to: mv.slice(2, 4),
      promotion: mv[4] || undefined,
    };
    if (!g.move(move as any)) break;
    fens.push(g.fen());
  }
  const res = await reviewFastBridge(fens, { elo, ...(options || {}) });
  const arr = Array.isArray(res) ? res : [];
  return arr.map((entry: any, idx: number) => ({
    idx: Number(entry?.idx ?? idx),
    bestMove: typeof entry?.bestMove === 'string' ? entry.bestMove : null,
    score: extractScore(entry?.score) ?? null,
  }));
}

async function hostIdentifyOpening(payload: OpeningDetectionRequest): Promise<OpeningDetection> {
  const g = new Chess();
  for (const mv of payload.movesUci) {
    const move = { from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] || undefined };
    if (!g.move(move as any)) break;
  }
  try {
    const res = await identifyOpeningBridge(g.fen());
    if (!res) return null;
    return {
      eco: res.eco || '',
      name: res.name || '',
      variation: res.variation,
      plyDepth: Number(res.plyDepth ?? payload.movesUci.length),
    };
  } catch {
    return null;
  }
}

async function runHostCall(call: HostCall): Promise<any> {
  switch (call.method) {
    case 'analyse':
      return hostAnalyse(call.payload);
    case 'reviewFast':
      return hostReviewFast(call.payload);
    case 'identifyOpening':
      return hostIdentifyOpening(call.payload);
    default:
      throw new Error(`Unknown host method ${call.method}`);
  }
}

function createWorkerAdapter(): EngineAdapter | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  const pending = new Map<number, PendingCall>();
  let nextId = 1;
  let resolveReady: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });

  function cleanup(id: number) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
  }

  const send = async (
    method: 'analyse' | 'reviewFast' | 'identifyOpening',
    payload: any,
    signal?: AbortSignal
  ) => {
    if (!worker) throw new Error('worker disposed');
    await readyPromise;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const entry: PendingCall = { resolve, reject };
      if (signal) {
        const onAbort = () => {
          worker?.postMessage({ type: 'abort', id });
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          cleanup(id);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.abort = () => signal.removeEventListener('abort', onAbort);
      }
      pending.set(id, entry);
      const transferablePayload = { ...payload };
      if ('signal' in transferablePayload) {
        delete (transferablePayload as any).signal;
      }
      worker!.postMessage({ type: method, id, payload: transferablePayload });
    });
  };

  worker.onmessage = (event: MessageEvent<WorkerResult>) => {
    const data = event.data;
    if (!data) return;
    switch (data.type) {
      case 'engine-worker-ready': {
        const channel = new MessageChannel();
        channel.port1.onmessage = async (evt: MessageEvent<HostCall>) => {
          const msg = evt.data;
          if (!msg || msg.type !== 'hostCall') return;
          try {
            const result = await runHostCall(msg);
            channel.port1.postMessage({ id: msg.id, ok: true, result });
          } catch (err: any) {
            channel.port1.postMessage({ id: msg.id, ok: false, error: err?.message ?? String(err) });
          }
        };
        channel.port1.start();
        worker!.postMessage({ type: 'bindHost', port: channel.port2 }, [channel.port2]);
        resolveReady?.();
        break;
      }
      case 'result': {
        const entry = pending.get(data.id);
        if (entry) {
          entry.abort?.();
          entry.resolve(data.payload);
          pending.delete(data.id);
        }
        break;
      }
      case 'error': {
        const entry = pending.get(data.id);
        if (entry) {
          entry.abort?.();
          entry.reject(new Error(data.error));
          pending.delete(data.id);
        }
        break;
      }
      default:
        break;
    }
  };

  const cancelAll = () => {
    pending.forEach((entry, id) => {
      entry.abort?.();
      entry.reject(new DOMException('Aborted', 'AbortError'));
      pending.delete(id);
      try {
        worker?.postMessage({ type: 'abort', id });
      } catch {
        // ignore
      }
    });
  };

  const adapter: EngineAdapter = {
    analyse: (args: AnalyseRequest) => send('analyse', args, args.signal),
    reviewFast: (args: ReviewFastRequest) => send('reviewFast', args, args.signal),
    identifyOpening: (args: { movesUci: string[]; signal?: AbortSignal }) =>
      send('identifyOpening', args, args.signal),
    cancelAll,
    dispose: () => {
      pending.forEach((entry) => entry.reject(new Error('disposed')));
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };

  return adapter;
}

function createInlineAdapter(): EngineAdapter {
  return {
    analyse: (args: AnalyseRequest) => hostAnalyse(args),
    reviewFast: (args: ReviewFastRequest) => hostReviewFast(args),
    identifyOpening: (args: OpeningDetectionRequest) => hostIdentifyOpening(args),
    cancelAll: () => {},
    dispose: () => {},
  };
}

export function createEngineAdapter(): EngineAdapter {
  return createWorkerAdapter() ?? createInlineAdapter();
}
