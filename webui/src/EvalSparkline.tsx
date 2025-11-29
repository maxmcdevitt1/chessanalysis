import React, { useMemo, useRef, useState, useEffect } from 'react';

export type EvalSparklineProps = {
  series: Array<number | null>;
  height?: number;
  currentIndex?: number | null;
  onHoverIndexChange?: (i: number | null) => void;
  onClickIndex?: (i: number) => void;
};

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function niceCp(cp: number | null) {
  if (cp == null) return '—';
  const s = (cp / 100).toFixed(1);
  return cp > 0 ? `+${s}` : s;
}

const AXIS_CP = 800;

export default function EvalSparkline({
  series,
  height = 84,
  currentIndex = null,
  onHoverIndexChange,
  onClickIndex,
}: EvalSparklineProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(320);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverI, setHoverI] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    let raf = 0;
    const ro = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(Math.max(180, Math.floor(entry.contentRect.width))));
    });
    ro.observe(ref.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const pts = useMemo(() => {
    const n = series.length;
    const dx = n > 1 ? width / (n - 1) : 0;
    const yOf = (cp: number | null) => {
      if (cp == null) return null;
      const c = clamp(cp, -AXIS_CP, AXIS_CP);
      return Math.round((1 - (c + AXIS_CP) / (2 * AXIS_CP)) * (height - 8)) + 4;
    };
    const arr: Array<{x:number,y:number|null}> = [];
    for (let i = 0; i < n; i++) {
      arr.push({ x: Math.round(i * dx) + 0.5, y: yOf(series[i]) });
    }
    return arr;
  }, [series, width, height]);

  const path = useMemo(() => {
    let d = '';
    let penDown = false;
    for (const p of pts) {
      if (p.y == null) { penDown = false; continue; }
      if (!penDown) { d += `M${p.x},${p.y}`; penDown = true; }
      else { d += ` L${p.x},${p.y}`; }
    }
    return d;
  }, [pts]);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    let ticking = false;
    function idxFromEvent(e: MouseEvent) {
      const rect = el.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const i = Math.round((x / Math.max(1, rect.width)) * (series.length - 1));
      return { x, i };
    }
    const onMove = (e: MouseEvent) => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const { x, i } = idxFromEvent(e);
        setHoverX(x);
        setHoverI(i);
        onHoverIndexChange?.(i);
      });
    };
    const onLeave = () => {
      setHoverX(null);
      setHoverI(null);
      onHoverIndexChange?.(null);
    };
    const onClick = (e: MouseEvent) => {
      const { i } = idxFromEvent(e);
      onClickIndex?.(i);
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('click', onClick);
    };
  }, [series.length, onHoverIndexChange, onClickIndex]);

  const hoverCp = hoverI != null ? series[hoverI] ?? null : null;

  return (
    <div ref={ref} style={{ width: '100%', height, background: '#0f0f12', border: '1px solid #333', borderRadius: 8, position: 'relative' }}>
      <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
        <line x1={0} y1={height/2} x2={width} y2={height/2} stroke="#3a3a3f" strokeDasharray="4 6" />
        <path d={path} fill="none" stroke="#fafafa" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        {currentIndex != null && currentIndex >= 0 && currentIndex < pts.length ? (
          <g>
            <circle cx={pts[currentIndex].x} cy={pts[currentIndex].y ?? height/2} r={4.5} fill="#fff" />
          </g>
        ) : null}
        {hoverX != null ? (
          <g>
            <line x1={hoverX} y1={0} x2={hoverX} y2={height} stroke="#7dd3fc" strokeDasharray="3 4" />
            {hoverI != null && pts[hoverI].y != null ? (
              <circle cx={pts[hoverI].x} cy={pts[hoverI].y!} r={5} fill="#7dd3fc" />
            ) : null}
          </g>
        ) : null}
      </svg>
      {hoverI != null ? (
        <div style={{ position: 'absolute', left: Math.min(Math.max((hoverX ?? 0) + 8, 8), width - 92), top: 6, padding: '4px 8px',
                      background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 14, color: '#e5e7eb', pointerEvents: 'none' }}>
          <div>ply {hoverI + 1}</div>
          <div>eval {niceCp(hoverCp)}</div>
        </div>
      ) : null}
    </div>
  );
}
