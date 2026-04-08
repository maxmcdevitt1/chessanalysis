import { useEffect, useMemo, useState } from 'react';
import type { EngineAdapter, EngineAnalysis } from '../engine/types';
import { eloToEvalMovetimeMs } from '../utils/timeControls';

export type UseEngineAnalysisArgs = {
  engine: EngineAdapter | null;
  fen: string;
  elo: number;
  enabled?: boolean;
  multipv?: number;
};

export type UseEngineAnalysisResult = {
  analysis: EngineAnalysis | null;
  isLoading: boolean;
  error: string | null;
};

export function useEngineAnalysis({
  engine,
  fen,
  elo,
  enabled = true,
  multipv = 2,
}: UseEngineAnalysisArgs): UseEngineAnalysisResult {
  const [analysis, setAnalysis] = useState<EngineAnalysis | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const movetime = useMemo(() => eloToEvalMovetimeMs(elo), [elo]);

  useEffect(() => {
    if (!engine || !enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    engine
      .analyse({ fen, multipv, movetime, signal: controller.signal })
      .then((res) => {
        if (!cancelled) setAnalysis(res);
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setAnalysis(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [engine, fen, enabled, multipv, movetime]);

  return { analysis, isLoading, error };
}
