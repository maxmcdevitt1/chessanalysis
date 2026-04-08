import React from 'react';
import type { CoachSections } from '../types/coach';

export type CoachPanelProps = {
  sections?: CoachSections | null;
  busy?: boolean;
  error?: string | null;
  onGenerate?: () => void;
};

function SectionCard({ title, content }: { title: string; content?: string | React.ReactNode }) {
  const text = typeof content === 'string' ? content.trim() : content;
  if (!text) return null;
  return (
    <div
      style={{
        border: '1px solid #2f3545',
        borderRadius: 10,
        padding: '10px 12px',
        background: '#0c1324',
        color: '#e5e7eb',
        fontSize: 14,
        lineHeight: '20px',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{title}</div>
      {content}
    </div>
  );
}

function KeyList({ items }: { items?: string[] }) {
  if (!items || !items.length) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((line, idx) => (
        <li key={`km-${idx}`} style={{ marginBottom: 4 }}>{line}</li>
      ))}
    </ul>
  );
}

const loadingStyles = {
  outer: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    background: '#1f2937',
    overflow: 'hidden',
    border: '1px solid #334155',
  },
  inner: {
    width: '45%',
    height: '100%',
    background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
  },
} as const;

export default function CoachPanel({
  sections,
  busy = false,
  error,
  onGenerate,
}: CoachPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Coach</div>
        <button
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #333',
            background: busy ? '#2a2a2a' : '#1f1f1f',
            color: '#eee',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
          onClick={() => !busy && onGenerate?.()}
          disabled={busy}
        >
          {busy ? 'Generating…' : 'Generate notes'}
        </button>
      </div>
      {error && <div style={{ fontSize: 13, color: '#f28b3c' }}>{error}</div>}
      {busy && (
        <div style={{ width: '100%' }}>
          <div style={{ fontSize: 13, color: '#bdbdbd', marginBottom: 6 }}>Generating coach notes…</div>
          <div style={loadingStyles.outer as React.CSSProperties}>
            <div style={loadingStyles.inner as React.CSSProperties} />
          </div>
        </div>
      )}
      {sections ? (
        <>
          <SectionCard title="Executive Summary" content={sections.executive?.text} />
          <SectionCard title="Opening Review" content={sections.opening?.text} />
          <SectionCard title="Middlegame Review" content={sections.middlegame?.text} />
          <SectionCard title="Endgame Review" content={sections.endgame?.text} />
          <SectionCard title="Key Moments & Turning Points" content={<KeyList items={sections.keyMoments?.bullets} />} />
          <SectionCard title="Three Most Important Lessons" content={
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {(sections.lessons?.bullets || []).map((line, idx) => (
                <li key={`lesson-${idx}`} style={{ marginBottom: 4 }}>{line}</li>
              ))}
            </ol>
          } />
        </>
      ) : (
        <div style={{ fontSize: 13, color: '#8f8f8f' }}>
          No coach summary yet. Generate notes to see a full premium-style review of this game.
        </div>
      )}
    </div>
  );
}
