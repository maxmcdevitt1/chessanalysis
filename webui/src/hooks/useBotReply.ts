import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBotPicker, type CreateBotPickerDeps, type PickMoveArgs } from '../botPicker';
import type { EngineAdapter } from '../engine/types';
import { createOpeningBook } from '../book/bookIndex';
import type { PickedMove } from '../picker/types';

export type UseBotReplyArgs = {
  engine: EngineAdapter | null;
  config?: CreateBotPickerDeps['config'];
};

export type UseBotReplyState = {
  pickMove: (args: PickMoveArgs & { timeoutMs?: number }) => Promise<PickedMove>;
  isPicking: boolean;
  lastPick: PickedMove | null;
  error: string | null;
  cancel: () => void;
};

export function useBotReply({ engine, config }: UseBotReplyArgs): UseBotReplyState {
  const pickerRef = useRef<ReturnType<typeof createBotPicker> | null>(null);
  const [lastPick, setLastPick] = useState<PickedMove | null>(null);
  const [isPicking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const book = useMemo(() => createOpeningBook(), []);

  useEffect(() => {
    if (!engine) return;
    const picker = createBotPicker({ engine, book, config });
    pickerRef.current = picker;
    return () => {
      picker.dispose();
      pickerRef.current = null;
    };
  }, [engine, book, config]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const pickMove = useCallback(async (args: PickMoveArgs & { timeoutMs?: number }) => {
    if (!pickerRef.current) throw new Error('picker not ready');
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = args.timeoutMs ?? 4000;
    const timer = typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), timeout)
      : undefined;
    setPicking(true);
    setError(null);
    try {
      const res = await pickerRef.current.pickMove({ ...args, signal: controller.signal });
      setLastPick(res);
      return res;
    } catch (err: any) {
      if (controller.signal.aborted) {
        setError(null);
      } else {
        setError(err?.message ?? String(err));
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      setPicking(false);
      controllerRef.current = null;
    }
  }, [cancel]);

  return { pickMove, isPicking, lastPick, error, cancel };
}
