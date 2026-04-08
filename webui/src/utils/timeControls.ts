const MOVE_TIME_POINTS: Array<[number, number]> = [
  [400, 180],
  [800, 220],
  [1000, 240],
  [1200, 260],
  [1500, 300],
  [1800, 330],
  [2000, 360],
  [2300, 400],
  [2500, 450],
];

export function eloToMovetimeMs(elo: number) {
  const pts = MOVE_TIME_POINTS;
  const e = Math.max(pts[0][0], Math.min(pts[pts.length - 1][0], Math.floor(elo || 400)));
  for (let i = 0; i < pts.length - 1; i++) {
    const [e0, t0] = pts[i];
    const [e1, t1] = pts[i + 1];
    if (e >= e0 && e <= e1) {
      const k = (e - e0) / (e1 - e0);
      return Math.round(t0 + k * (t1 - t0));
    }
  }
  return pts[pts.length - 1][1];
}

export function eloToEvalMovetimeMs(elo: number) {
  const base = Math.round(eloToMovetimeMs(elo) * 0.30);
  return Math.max(80, Math.min(450, base));
}
