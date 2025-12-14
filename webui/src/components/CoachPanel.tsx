import React from 'react';
import type { CoachSections, CoachMomentNote, CoachMoveNote } from '../types/coach';
import CoachCard from './CoachCard';

export type CoachPanelProps = {
  sections?: CoachSections | null;
  busy?: boolean;
  error?: string | null;
  onGenerate?: () => void;
  momentNotes?: CoachMomentNote[] | null;
  fallbackNotes?: CoachMoveNote[] | null;
  activeMoveIndex?: number | null;
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

export default function CoachPanel({
  sections,
  busy = false,
  error,
  onGenerate,
  momentNotes,
  fallbackNotes,
  activeMoveIndex = null,
}: CoachPanelProps) {
  const hasMomentNotes = Array.isArray(momentNotes) && momentNotes.length > 0;
  const hasFallbackNotes = Array.isArray(fallbackNotes) && fallbackNotes.length > 0;
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
      {busy && <div style={{ fontSize: 13, color: '#bdbdbd' }}>The coach is analysing this game…</div>}
      {sections ? (
        <>
          <SectionCard title="Executive Summary" content={sections.executiveSummary} />
          <SectionCard title="Opening Review" content={sections.openingReview} />
          <SectionCard title="Middlegame Review" content={sections.middlegameReview} />
          <SectionCard title="Endgame Review" content={sections.endgameReview} />
          <SectionCard title="Key Moments & Turning Points" content={<KeyList items={sections.keyMoments} />} />
          <SectionCard title="Three Most Important Lessons" content={
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {(sections.lessons || []).map((line, idx) => (
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
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, margin: '6px 0' }}>Move insights</div>
        {hasMomentNotes ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {momentNotes!.map((note) => (
              <CoachCard
                key={note.moveIndex}
                note={note}
                defaultExpanded={note.moveIndex === activeMoveIndex}
                active={note.moveIndex === activeMoveIndex}
              />
            ))}
          </div>
        ) : hasFallbackNotes ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fallbackNotes!.map((note) => (
              <div
                key={note.moveIndex}
                style={{
                  border: '1px solid #1f293b',
                  borderRadius: 10,
                  padding: '10px 12px',
                  background: '#0d1527',
                  fontSize: 13,
                  lineHeight: '20px',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Move {note.moveNo}{note.side === 'B' ? '…' : '.'} {note.san || '?'}
                </div>
                {note.text}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#8f8f8f' }}>
            Generate notes to see per-move coaching cards.
          </div>
        )}
      </div>
    </div>
  );
}
