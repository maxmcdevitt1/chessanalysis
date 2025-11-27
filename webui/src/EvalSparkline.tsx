// webui/src/EvalSparkline.tsx — taller (84px), thicker line (2.6)
import React, { useMemo } from 'react';
export type EvalSparklineProps = { series: Array<number | null>; height?: number; maxAbs?: number; };
export default function EvalSparkline({ series, height = 84, maxAbs = 800 }: EvalSparklineProps) {
  const { pathD, width, zeroY, pts } = useMemo(() => {
    const maxPts = 320; const step = Math.max(1, Math.ceil((series.length || 1) / maxPts));
    const normalized: Array<number | null> = [];
    for (let i = 0; i < series.length; i += step) {
      const v = series[i];
      normalized.push(typeof v === 'number' && Number.isFinite(v) ? Math.max(-maxAbs, Math.min(maxAbs, v)) : null);
    }
    const n = normalized.length || 1; const w = Math.max(220, n * 3); const h = height; const zero = h / 2;
    const yFor = (cp: number) => { const t = (cp + maxAbs) / (2 * maxAbs); return h - t * h; };
    const points: Array<[number, number] | null> = normalized.map((v, i) => v == null ? null : [ (i / Math.max(1, n - 1)) * (w - 2) + 1, yFor(v) ]);
    let d = ''; for (let i = 0; i < points.length; i++) { const p = points[i]; if (!p) continue; const [x,y]=p; d += (i===0 || points[i-1]==null) ? `M ${x.toFixed(1)} ${y.toFixed(1)} ` : `L ${x.toFixed(1)} ${y.toFixed(1)} `; }
    return { pathD: d.trim(), width: w, zeroY: zero, pts: points };
  }, [series, height, maxAbs]);
  if (!series.length) return <div style={{ padding: 10, fontSize: 20, opacity: 0.7 }}>No eval data yet</div>;
  return (<div style={{ border: '2px solid #333', borderRadius: 10, padding: 10 }}>
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ height }} role="img" aria-label="Evaluation over time">
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="currentColor" opacity={0.25} strokeWidth={1.6} />
      {pathD ? <path d={pathD} fill="none" stroke="currentColor" strokeWidth={2.6} /> : null}
      {pts[pts.length - 1] && <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={3.2} />}
    </svg></div>);
}
