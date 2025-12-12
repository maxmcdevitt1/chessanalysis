import React from 'react';
import type { Settings } from '../hooks/useSettings';

type Props = {
  settings: Pick<Settings, 'engineThreads' | 'engineHashMb' | 'liveMultipv' | 'disableGpu'>;
  onChange: (patch: Partial<Settings>) => void;
  onPanic: () => void;
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 14, color: '#9ca3af' }}>{label}</span>
      {children}
    </label>
  );
}

export default function SettingsPanel({ settings, onChange, onPanic }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 18 }}>Performance & Safety</div>
      <Field label={`Engine threads (${settings.engineThreads})`}>
        <input
          type="range"
          min={1}
          max={4}
          step={1}
          value={settings.engineThreads}
          onChange={(e) => onChange({ engineThreads: Number(e.target.value) })}
        />
      </Field>
      <Field label={`Hash memory (${settings.engineHashMb} MB)`}>
        <input
          type="range"
          min={64}
          max={256}
          step={32}
          value={settings.engineHashMb}
          onChange={(e) => onChange({ engineHashMb: Number(e.target.value) })}
        />
      </Field>
      <Field label="Live MultiPV">
        <select
          value={settings.liveMultipv}
          onChange={(e) => onChange({ liveMultipv: Number(e.target.value) })}
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #2c3848',
            background: '#0c1526',
            color: '#f3f4f6',
          }}
        >
          <option value={1}>Single line (fastest)</option>
          <option value={2}>Two lines</option>
        </select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.disableGpu}
          onChange={(e) => onChange({ disableGpu: e.target.checked })}
        />
        <span style={{ fontSize: 14 }}>
          Disable GPU acceleration<span style={{ color: '#9ca3af' }}> (requires restart)</span>
        </span>
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #92400e',
            background: '#451a03',
            color: '#ffedd5',
            fontWeight: 600,
            cursor: 'pointer',
          }}
          onClick={onPanic}
        >
          Panic – Stop Engine
        </button>
        <span style={{ fontSize: 13, color: '#d1d5db' }}>
          Use if the engine feels stuck or your laptop fans spike.
        </span>
      </div>
    </div>
  );
}
