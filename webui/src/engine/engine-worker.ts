/// <reference lib="webworker" />

type WorkerRequest =
  | { type: 'analyse'; id: number; payload: any }
  | { type: 'reviewFast'; id: number; payload: any }
  | { type: 'identifyOpening'; id: number; payload: any }
  | { type: 'abort'; id: number }
  | { type: 'bindHost'; port: MessagePort };

type HostResponse = { id: number; ok: true; result: any } | { id: number; ok: false; error: string };

type Pending = { aborted: boolean; method: 'analyse' | 'reviewFast' | 'identifyOpening' };

const pending = new Map<number, Pending>();
let hostPort: MessagePort | null = null;

const ctx: DedicatedWorkerGlobalScope = self as any;

function ensureHost() {
  if (!hostPort) {
    throw new Error('engine worker host not bound');
  }
}

function sendResult(id: number, payload: any) {
  const entry = pending.get(id);
  if (!entry) return;
  if (entry.aborted) {
    pending.delete(id);
    return;
  }
  ctx.postMessage({ type: 'result', id, payload });
  pending.delete(id);
}

function sendError(id: number, error: string) {
  const entry = pending.get(id);
  if (!entry) return;
  if (entry.aborted) {
    pending.delete(id);
    return;
  }
  ctx.postMessage({ type: 'error', id, error });
  pending.delete(id);
}

function callHost(id: number, method: Pending['method'], payload: any) {
  ensureHost();
  pending.set(id, { aborted: false, method });
  hostPort!.postMessage({ type: 'hostCall', id, method, payload });
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  if (!data) return;
  switch (data.type) {
    case 'bindHost': {
      hostPort = data.port;
      hostPort.onmessage = (evt: MessageEvent<HostResponse>) => {
        const msg = evt.data;
        if (!msg) return;
        if (msg.ok) sendResult(msg.id, msg.result);
        else sendError(msg.id, msg.error);
      };
      break;
    }
    case 'analyse':
    case 'reviewFast':
    case 'identifyOpening':
      callHost(data.id, data.type, data.payload);
      break;
    case 'abort': {
      const entry = pending.get(data.id);
      if (entry) entry.aborted = true;
      break;
    }
    default:
      break;
  }
};

ctx.postMessage({ type: 'engine-worker-ready' });
