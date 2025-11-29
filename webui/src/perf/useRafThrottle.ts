import { useRef, useCallback } from 'react';
export function useRafThrottle<T extends (...args: any[]) => void>(fn: T) {
  const rafRef = useRef<number | null>(null);
  const lastArgs = useRef<any[] | null>(null);
  const cb = useCallback((...args: any[]) => {
    lastArgs.current = args;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const a = lastArgs.current; lastArgs.current = null;
      // @ts-ignore
      fn.apply(null, a ?? []);
    });
  }, [fn]);
  return cb as T;
}
