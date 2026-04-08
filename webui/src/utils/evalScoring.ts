import type { EngineInfo } from '../engine/types';

export type EvalScore = { cp?: number; mate?: number } | null;

export function mateToCp(mateVal: number | null | undefined): number | null {
  if (mateVal == null || !isFinite(mateVal)) return null;
  const sign = mateVal >= 0 ? 1 : -1;
  return sign * (10000 - Math.min(99, Math.abs(mateVal)) * 100);
}

export function extractScore(raw: any): EvalScore {
  if (!raw) return null;
  if (raw.score && typeof raw.score === 'object') {
    const val = Number((raw.score as any).value);
    if (Number.isFinite(val)) {
      const type = (raw.score as any).type === 'mate' ? 'mate' : 'cp';
      return type === 'mate' ? { mate: val } : { cp: val };
    }
  }
  if (typeof raw.cp === 'number') return { cp: raw.cp };
  if (typeof raw.mate === 'number') return { mate: raw.mate };
  if (raw.type === 'cp' && Number.isFinite(raw.value)) return { cp: Number(raw.value) };
  if (raw.type === 'mate' && Number.isFinite(raw.value)) return { mate: Number(raw.value) };
  if (raw.type === 'cp' && Number.isFinite(raw.score)) return { cp: Number(raw.score) };
  if (raw.type === 'mate' && Number.isFinite(raw.score)) return { mate: Number(raw.score) };
  return null;
}

export function bestScoreFromInfos(infos?: EngineInfo[] | any[]): EvalScore {
  if (!infos?.length) return null;
  let best: EvalScore = null;
  let fallback: EvalScore = null;
  for (const it of infos) {
    const v = extractScore(it);
    if (!v) continue;
    const mpv = Number((it as any)?.multipv || (it as any)?.multiPv);
    if (!mpv || mpv === 1) best = v;
    fallback = v;
  }
  return best ?? fallback ?? null;
}

export function scoreToWhiteCp(score: EvalScore): number | null {
  if (!score) return null;
  if (typeof score.cp === 'number') return score.cp;
  if (typeof score.mate === 'number') return score.mate > 0 ? 10000 : -10000;
  return null;
}

export function evalForMover(score: EvalScore, _sideToMove: 'w' | 'b'): number {
  if (!score) return NaN;
  if (typeof score.cp === 'number') return score.cp;
  if (typeof score.mate === 'number') return score.mate > 0 ? 10000 : -10000;
  return NaN;
}

export function cpFromEval(score: EvalScore): number | null {
  if (!score) return null;
  if (typeof score.cp === 'number') return score.cp;
  if (typeof score.mate === 'number') return score.mate > 0 ? 10000 : -10000;
  return null;
}

export function lastScoreCp(infos?: EngineInfo[] | any[]): number | null {
  const sc = bestScoreFromInfos(infos);
  return scoreToWhiteCp(sc);
}
