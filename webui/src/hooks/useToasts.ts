import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
  autoDismissMs?: number;
};

export type PushToastArgs = {
  message: string;
  variant?: ToastVariant;
  autoDismissMs?: number;
};

export type UseToastsResult = {
  toasts: Toast[];
  push: (args: PushToastArgs) => number;
  dismiss: (id: number) => void;
  clear: () => void;
};

const DEFAULT_DISMISS_MS = 6000;

export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    clearTimer(id);
  }, [clearTimer]);

  const scheduleAutoDismiss = useCallback((id: number, ms?: number) => {
    const duration = typeof ms === 'number' ? ms : DEFAULT_DISMISS_MS;
    if (!duration || duration <= 0) return;
    clearTimer(id);
    timers.current.set(
      id,
      setTimeout(() => {
        dismiss(id);
      }, duration)
    );
  }, [clearTimer, dismiss]);

  const push = useCallback((args: PushToastArgs) => {
    const id = ++idRef.current;
    const toast: Toast = {
      id,
      message: args.message,
      variant: args.variant ?? 'info',
      autoDismissMs: args.autoDismissMs,
    };
    setToasts((prev) => [...prev, toast]);
    scheduleAutoDismiss(id, args.autoDismissMs);
    return id;
  }, [scheduleAutoDismiss]);

  const clear = useCallback(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  return { toasts, push, dismiss, clear };
}
