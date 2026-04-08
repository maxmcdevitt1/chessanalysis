import { useCallback, useRef, useState } from 'react';
import type { EngineAdapter, ReviewFastEntry } from '../engine/types';

export type UseBatchAnalysisArgs = {
  engine: EngineAdapter | null;
};

export type BatchRunArgs = { movesUci: string[]; elo?: number; options?: Record<string, unknown> };

export type BatchAnalysisResult = {
  run: (params: BatchRunArgs) => Promise<ReviewFastEntry[]>;
  cancel: () => void;
  isRunning: boolean;
  progress: number;
  error: string | null;
  result: ReviewFastEntry[] | null;
};

export function useBatchAnalysis({ engine }: UseBatchAnalysisArgs): BatchAnalysisResult {
  const [isRunning, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewFastEntry[] | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const run = useCallback(async ({ movesUci, elo, options }: BatchRunArgs) => {
    if (!engine) throw new Error('engine unavailable');
    if (!movesUci.length) return [];
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setProgress(0);
    setError(null);
    setResult(null);
    try {
      const res = await engine.reviewFast({ movesUci, elo, options, signal: controller.signal });
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      setProgress(100);
      setResult(res);
      return res;
    } catch (err: any) {
      if (controller.signal.aborted) {
        setError(null);
      } else {
        setError(err?.message ?? String(err));
      }
      throw err;
    } finally {
      setRunning(false);
      controllerRef.current = null;
    }
  }, [engine, cancel]);

  return { run, cancel, isRunning, progress, error, result };
}
