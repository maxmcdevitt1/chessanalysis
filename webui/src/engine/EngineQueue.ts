// Simple engine call queue with cancellation guards
export type EvalParams = { fen: string; movetimeMs: number; multiPv?: number };
export type AnalyzeFn = (p: EvalParams) => Promise<any>;

export function createEngineQueue(analyze: AnalyzeFn) {
  let ticket = 0; // increments to cancel stale calls
  let busy = false;

  async function run(params: EvalParams) {
    const my = ++ticket;
    busy = true;
    try {
      const res = await analyze(params);
      if (my !== ticket) throw new Error('stale'); // ignore stale results
      return res;
    } finally {
      if (my === ticket) busy = false;
    }
  }

  return {
    get busy() { return busy; },
    evalQuick: (p: EvalParams) => run(p),
    analyzeHeavy: (p: EvalParams) => run(p),
    cancelAll: () => { ticket++; busy = false; },
  };
}
