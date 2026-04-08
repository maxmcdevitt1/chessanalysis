import React, { useEffect, useState } from 'react';
import type { CoachMomentNote } from '../types/coach';

type CoachCardProps = {
  note: CoachMomentNote;
  compact?: boolean;
  defaultExpanded?: boolean;
  active?: boolean;
};

const LABEL_COLORS: Record<CoachMomentNote['label'], string> = {
  Best: '#10b981',
  Good: '#3b82f6',
  Inaccuracy: '#f59e0b',
  Mistake: '#fb923c',
  Blunder: '#f87171',
  Book: '#94a3b8',
};

function formatEvalLine(note: CoachMomentNote) {
  const before = note.evalBeforeLabel;
  const after = note.evalAfterLabel;
  if (!before && !after) return null;
  if (before && after) {
    if (before === after) return `Eval: ${before}`;
    return `Eval: ${before} → ${after}`;
  }
  if (after) return `Eval: ${after}`;
  return `Eval: ${before}`;
}

function clampSentences(text: string | undefined, limit: number) {
  if (!text) return '';
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return text.trim();
  return parts.slice(0, Math.max(1, limit)).join(' ');
}

export default function CoachCard({ note, compact = false, defaultExpanded = false, active = false }: CoachCardProps) {
  const quietLabel = note.label === 'Best' || note.label === 'Good' || note.label === 'Book';
  const gate = note.gate;
  const isQuiet = gate?.isQuiet ?? quietLabel;
  const allowDetails = gate?.allowDetails ?? !isQuiet;
  const allowWhy = gate?.allowWhy ?? !isQuiet;
  const hasDetailFields = allowDetails && Boolean(note.opponentIdea || note.refutation || note.betterPlan || note.pv);
  const [expanded, setExpanded] = useState(defaultExpanded && hasDetailFields);
  useEffect(() => {
    setExpanded(defaultExpanded && hasDetailFields);
  }, [note.moveIndex, defaultExpanded, hasDetailFields]);

  const glyph = note.side === 'B' ? '…' : '.';
  const evalLine = isQuiet ? null : formatEvalLine(note);
  const bodyFont = compact ? 13 : 14;
  const headerFont = compact ? 14 : 16;
  const headline = note.bubbleTitle || `Move ${note.moveNo}${glyph} ${note.san}`;
  const bodyText = clampSentences(note.why, isQuiet ? 1 : 2);
  const showPrinciple = !isQuiet && allowWhy && Boolean(note.principle);

  return (
    <div
      style={{
        border: `1px solid ${active ? '#60a5fa' : '#1f293b'}`,
        borderRadius: 14,
        padding: compact ? '10px 12px' : '14px 16px',
        background: 'rgba(11, 17, 33, 0.96)',
        boxShadow: active ? '0 12px 32px rgba(15,118,255,0.25)' : '0 12px 32px rgba(0,0,0,0.35)',
        color: '#e2e8f0',
        fontSize: bodyFont,
        lineHeight: '20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: headerFont }}>{headline}</div>
          {!note.bubbleTitle && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              Move {note.moveNo}{glyph} {note.san}
            </div>
          )}
          {evalLine && <div style={{ fontSize: compact ? 11 : 12, color: '#94a3b8', marginTop: 2 }}>{evalLine}</div>}
        </div>
        <span
          style={{
            background: LABEL_COLORS[note.label],
            color: '#0b1121',
            borderRadius: 999,
            fontSize: compact ? 11 : 12,
            fontWeight: 700,
            padding: '4px 10px',
            whiteSpace: 'nowrap',
          }}
        >
          {note.label}
        </span>
      </div>
      <div style={{ marginTop: 8 }}>{bodyText}</div>
      {showPrinciple && note.principle && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#bfdbfe' }}>
          Principle: <strong>{note.principle}</strong>
        </div>
      )}
      {hasDetailFields && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
            style={{
              marginTop: 10,
              border: 'none',
              background: 'transparent',
              color: '#93c5fd',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
          {expanded && (
            <div style={{ marginTop: 10, borderTop: '1px solid rgba(148,163,184,0.25)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {note.opponentIdea && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Opponent idea</div>
                  <div style={{ fontSize: 13 }}>{note.opponentIdea}</div>
                </div>
              )}
              {note.refutation && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Refutation</div>
                  <div style={{ fontSize: 13 }}>{note.refutation}</div>
                </div>
              )}
              {note.betterPlan && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Better plan</div>
                  <div style={{ fontSize: 13 }}>{note.betterPlan}</div>
                </div>
              )}
              {note.pv && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>PV</div>
                  <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{note.pv}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
