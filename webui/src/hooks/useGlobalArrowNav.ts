// webui/src/hooks/useGlobalArrowNav.ts
import { useEffect } from 'react';
type UseGlobalArrowNavArgs = { ply: number; total: number; onRebuildTo: (ply: number) => void; enabled?: boolean; };
export function useGlobalArrowNav({ ply, total, onRebuildTo, enabled = true }: UseGlobalArrowNavArgs) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const isTyping = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as any).isContentEditable);
      if (isTyping || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); onRebuildTo(Math.max(0, ply - 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onRebuildTo(Math.min(total, ply + 1)); }
      else if (e.key === 'Home') { e.preventDefault(); onRebuildTo(0); }
      else if (e.key === 'End') { e.preventDefault(); onRebuildTo(total); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ply, total, onRebuildTo, enabled]);
}
