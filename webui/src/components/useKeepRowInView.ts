import { useEffect, useRef } from 'react';
export function useKeepRowInView(selectedIndex: number) {
  const mapRef = useRef<Map<number, HTMLElement>>(new Map());
  useEffect(()=>{
    const el = mapRef.current.get(selectedIndex);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);
  const bind = (index: number) => (el: HTMLElement | null) => {
    if (!el) mapRef.current.delete(index);
    else mapRef.current.set(index, el);
  };
  return { bind };
}
