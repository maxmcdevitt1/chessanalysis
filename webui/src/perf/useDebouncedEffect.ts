import { useEffect } from 'react';
export function useDebouncedEffect(effect: () => void | (() => void), deps: any[], delay = 150) {
  useEffect(() => {
    const id = setTimeout(() => {
      const cleanup = effect();
      if (typeof cleanup === 'function') {
        // Return cleanup when timer fires
        return cleanup;
      }
    }, delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}
