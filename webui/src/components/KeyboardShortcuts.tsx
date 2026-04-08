import { useEffect } from 'react';
import { Navigator } from '../state/navigator';

type Props = { navigator: Navigator; enabled?: boolean };
export default function KeyboardShortcuts({navigator, enabled=true}: Props) {
  useEffect(()=>{
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      const isTyping = tgt && (
        tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable
      );
      if (isTyping) return;
      if (e.key === 'ArrowRight') { navigator.next(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { navigator.prev(); e.preventDefault(); }
      else if (e.key === 'Home') { navigator.home(); e.preventDefault(); }
      else if (e.key === 'End') { navigator.end(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey, { passive: false });
    return () => window.removeEventListener('keydown', onKey as any);
  }, [navigator, enabled]);
  return null;
}
