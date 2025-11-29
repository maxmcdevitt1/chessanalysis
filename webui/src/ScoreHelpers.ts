export type ScoreInfo = { type: 'cp' | 'mate'; score: number };

export function pv1(infos?: any[]): ScoreInfo | null {
  if (!infos?.length) return null;
  const it = infos[0]; // PV#1
  if (typeof it?.cp === 'number')  return { type: 'cp', score: it.cp };
  if (typeof it?.mate === 'number') return { type: 'mate', score: it.mate };
  return null;
}

// Map mate to a big centipawn for CPL math; sign preserved.
export function numericForCpl(si: ScoreInfo | null): number | null {
  if (!si) return null;
  if (si.type === 'cp') return si.score;
  const MATE_CP = 1000;
  return Math.sign(si.score || 1) * MATE_CP;
}

// Mover-POV CPL: best(before) - (-after)
export function cplFromBeforeAfter(before?: any[], after?: any[]): number | null {
  const b = numericForCpl(pv1(before));
  const a = numericForCpl(pv1(after));
  if (b == null || a == null) return null;
  return Math.max(0, b - (-a));
}

// UI formatter for the Eval column
export function prettyForUi(si: ScoreInfo | null): string {
  if (!si) return '';
  if (si.type === 'mate') {
    const sign = si.score > 0 ? '+' : '-';
    return `${sign}M${Math.abs(si.score)}`;
  }
  return (si.score / 100).toFixed(1);
}

// Smooth curve; round at render/use-site
export function accuracyFromAvgCpl(avg: number | null): number {
  if (avg == null || avg <= 0) return 100;

  // Softer curve than before. k controls how fast accuracy decays with CPL.
  const k = 0.06; // smaller k => slower decay
  const acc = 100 * Math.exp(-k * avg);

  return Math.max(0, Math.min(100, acc));
}
