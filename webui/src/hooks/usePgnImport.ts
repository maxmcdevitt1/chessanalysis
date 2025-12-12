import { useCallback } from 'react';
import { Chess } from '../chess-compat';
import type { PushToastArgs } from './useToasts';

export function extractMovesFromPgn(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const g = new Chess();
  g.loadPgn(trimmed, { sloppy: true });
  const history = g.history({ verbose: true }) as Array<{ from: string; to: string; promotion?: string }>;
  return history.map((m) => `${m.from}${m.to}${m.promotion || ''}`);
}

type UsePgnImportOptions = {
  loadMoves: (moves: string[]) => void;
  resetEvaluations: () => void;
  markMatchNotStarted: () => void;
  notify?: (args: PushToastArgs) => number;
};

export function usePgnImport({
  loadMoves,
  resetEvaluations,
  markMatchNotStarted,
  notify,
}: UsePgnImportOptions) {
  const loadPgnText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      try {
        const moves = extractMovesFromPgn(trimmed);
        if (!moves.length) throw new Error('PGN contained no moves.');
        loadMoves(moves);
        resetEvaluations();
        markMatchNotStarted();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notify?.({ message: `Failed to load PGN: ${message}`, variant: 'error' });
        return false;
      }
    },
    [loadMoves, resetEvaluations, markMatchNotStarted, notify]
  );

  const loadPgnFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      return loadPgnText(text);
    },
    [loadPgnText]
  );

  return { loadPgnText, loadPgnFile };
}
