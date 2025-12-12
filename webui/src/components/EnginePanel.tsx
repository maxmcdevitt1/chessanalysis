import React from 'react';
import { acplBandForElo } from '../ScoreHelpers';
import { bandById, STRENGTH_BANDS, type StrengthBandId } from '../strengthBands';

export type EnginePanelProps = {
  evalCp: number | null;
  evalPending?: boolean;
  band: StrengthBandId;
  onBandChange: (band: StrengthBandId) => void;
};

function formatEval(cp: number | null): string {
  if (cp == null || !Number.isFinite(cp)) return '—';
  if (Math.abs(cp) >= 10000) return cp > 0 ? 'M+' : 'M-';
  return (cp / 100).toFixed(2);
}

export default function EnginePanel({
  evalCp,
  evalPending = false,
  band,
  onBandChange,
}: EnginePanelProps) {
  const bandMeta = bandById(band);
  const acplBand = acplBandForElo(bandMeta.centerElo);
  const statusLabel = evalPending ? 'Analyzing…' : 'Live eval (White POV)';
  const evalLabel = formatEval(evalCp);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>Engine</div>
        <div style={{ fontSize: 14, color: '#9ca3af' }}>{statusLabel}</div>
        <div
          style={{
            borderRadius: 12,
            border: '1px solid #2c3848',
            padding: '10px 14px',
            background: '#0c1526',
            fontSize: 22,
            fontWeight: 600,
            color: evalCp != null ? (evalCp >= 0 ? '#8bc34a' : '#ff7043') : '#d1d5db',
          }}
        >
          {evalLabel}
        </div>
        <div style={{ fontSize: 14, color: '#9ca3af' }}>
          Target band: <strong>{bandMeta.display || bandMeta.label}</strong> ({bandMeta.range[0]}–{bandMeta.range[1]} Elo)
        </div>
        {acplBand && (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>
            Typical accuracy band: <strong>{acplBand.label}</strong>
          </div>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>Strength presets</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {STRENGTH_BANDS.map((entry) => {
            const isActive = entry.id === band;
            return (
              <button
                key={entry.id}
                onClick={() => onBandChange(entry.id)}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: '1px solid',
                  borderColor: isActive ? '#2e7d32' : '#2c3848',
                  background: isActive ? '#214c26' : '#0c1526',
                  color: isActive ? '#e8f5e9' : '#d1d5db',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
