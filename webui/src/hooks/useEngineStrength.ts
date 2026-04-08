import { useCallback, useEffect, useMemo } from 'react';
import { setStrength } from '../bridge';
import { bandById, bandPlayElo, type StrengthBandId } from '../strengthBands';

type UseEngineStrengthOptions = {
  band: StrengthBandId;
  onChange?: (next: StrengthBandId) => void;
  delayMs?: number;
};

export function useEngineStrength({
  band,
  onChange,
  delayMs = 150,
}: UseEngineStrengthOptions) {
  const bandInfo = useMemo(() => bandById(band), [band]);
  const targetElo = useMemo(() => bandPlayElo(band), [band]);

  useEffect(() => {
    localStorage.setItem('engineElo', String(targetElo));
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setStrength(targetElo).catch(() => {});
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targetElo, delayMs]);

  const setEngineBand = useCallback(
    (next: StrengthBandId) => {
      if (next === band) return;
      onChange?.(next);
    },
    [band, onChange]
  );

  return {
    engineBand: band,
    setEngineBand,
    engineTargetElo: targetElo,
    engineTargetLabel: bandInfo?.display || bandInfo?.label || '',
    engineTargetRange: bandInfo?.range || null,
  };
}
