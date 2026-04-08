import { useEffect, useState } from 'react';
import type { EngineAdapter, OpeningDetection } from '../engine/types';
import { detectOpening, ensureOpeningTrieLoaded } from '../openings/matcher';
import { detectOpeningFromBook } from '../utils/openingBook';

export type UseOpeningDetectionArgs = {
  engine: EngineAdapter | null;
  movesUci: string[];
  enabled?: boolean;
};

export type OpeningSummary = {
  eco: string;
  name: string;
  variation?: string;
  plyDepth: number;
} | null;

export type UseOpeningDetectionResult = {
  opening: OpeningDetection;
  fallbackOpening: OpeningSummary;
  bookMask: boolean[];
  bookDepth: number;
  label: string;
  isLoading: boolean;
  error: string | null;
  bookReady: boolean;
};

const EMPTY_STATE: UseOpeningDetectionResult = {
  opening: null,
  fallbackOpening: null,
  bookMask: [],
  bookDepth: 0,
  label: '',
  isLoading: false,
  error: null,
  bookReady: false,
};

function formatLabel(value: OpeningSummary | OpeningDetection): string {
  if (!value) return '';
  const parts = [value.name, value.variation].filter(Boolean);
  const prefix = parts.join(' — ');
  if (prefix && value.eco) return `${prefix} (${value.eco})`;
  if (prefix) return prefix;
  return value.eco || '';
}

export function useOpeningDetection({
  engine,
  movesUci,
  enabled = true,
}: UseOpeningDetectionArgs): UseOpeningDetectionResult {
  const [state, setState] = useState<UseOpeningDetectionResult>(EMPTY_STATE);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_STATE);
      return;
    }

    const hasMoves = movesUci.length > 0;
    let cancelled = false;
    const controller = new AbortController();
    const awaitEngine = !!engine && hasMoves;

    setState({
      opening: null,
      fallbackOpening: null,
      bookMask: [],
      bookDepth: 0,
      label: '',
      isLoading: hasMoves,
      error: null,
      bookReady: false,
    });

    async function runBookDetection() {
      if (!hasMoves) {
        setState((prev) => ({
          ...prev,
          bookMask: [],
          bookDepth: 0,
          fallbackOpening: null,
          label: '',
          bookReady: true,
          isLoading: awaitEngine ? prev.isLoading : false,
        }));
        return;
      }

      try {
        const book = await detectOpeningFromBook(movesUci);
        if (cancelled) return;
        const fallback = book.label
          ? {
              eco: book.label.eco,
              name: book.label.name,
              variation: book.label.variation,
              plyDepth: book.depth,
            }
          : null;
        setState((prev) => {
          const fallbackOpening = fallback ?? prev.fallbackOpening;
          const label = formatLabel(prev.opening ?? fallbackOpening);
          return {
            ...prev,
            fallbackOpening,
            bookMask: book.mask,
            bookDepth: book.depth,
            label,
            bookReady: book.ready,
            isLoading: awaitEngine ? prev.isLoading : false,
          };
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          error: prev.error ?? (err instanceof Error ? err.message : String(err)),
          bookReady: true,
          isLoading: awaitEngine ? prev.isLoading : false,
        }));
      }
    }

    async function runLocalDetection() {
      if (!hasMoves) {
        setState((prev) => ({ ...prev, isLoading: awaitEngine ? prev.isLoading : false }));
        return;
      }
      try {
        await ensureOpeningTrieLoaded();
        if (cancelled) return;
        const fallback = await detectOpening({ movesUci });
        if (cancelled) return;
        setState((prev) => {
          const newDepth = Math.max(
            prev.bookDepth,
            fallback?.plyDepth ?? 0,
            prev.opening?.plyDepth ?? 0
          );
          const label = formatLabel(prev.opening ?? fallback ?? prev.fallbackOpening);
          return {
            ...prev,
            fallbackOpening: fallback ?? prev.fallbackOpening,
            bookDepth: newDepth,
            label,
            isLoading: awaitEngine ? prev.isLoading : false,
          };
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          error: prev.error ?? (err instanceof Error ? err.message : String(err)),
          isLoading: awaitEngine ? prev.isLoading : false,
        }));
      }
    }
    runBookDetection();
    runLocalDetection();

    if (awaitEngine && engine) {
      engine
        .identifyOpening({ movesUci, signal: controller.signal })
        .then((res) => {
          if (cancelled) return;
          setState((prev) => {
            const depth = Math.max(prev.bookDepth, Number(res?.plyDepth ?? 0));
            const label = formatLabel(res ?? prev.fallbackOpening);
            return {
              ...prev,
              opening: res,
              bookDepth: depth,
              label,
              isLoading: false,
            };
          });
        })
        .catch((err) => {
          if (controller.signal.aborted || cancelled) return;
          setState((prev) => ({
            ...prev,
            opening: null,
            error: err instanceof Error ? err.message : String(err),
            isLoading: false,
          }));
        });
    } else {
      setState((prev) => ({ ...prev, isLoading: false }));
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [engine, movesUci, enabled]);

  return state;
}
