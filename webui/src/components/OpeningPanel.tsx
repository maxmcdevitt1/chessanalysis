import React from 'react';

export type OpeningPanelProps = {
  openingText?: string | null;
  bookMoves?: string[];
  onApplyBookMove?: (uci: string) => void;
};

export default function OpeningPanel({
  openingText,
  bookMoves = [],
  onApplyBookMove,
}: OpeningPanelProps) {
  const hasOpening = !!openingText;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 16 }}>Commentary</div>
      {hasOpening ? (
        <div style={{ color: '#e3e3e3', lineHeight: '20px' }}>{openingText}</div>
      ) : (
        <div style={{ color: '#8f8f8f', fontStyle: 'italic' }}>Make a move or load a PGN to see commentary.</div>
      )}
      {!!bookMoves.length && onApplyBookMove && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 14, marginBottom: 6, color: '#cfcfcf' }}>Book continuations</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {bookMoves.slice(0, 8).map((uci) => (
              <button
                key={uci}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #333',
                  background: '#1f1f1f',
                  color: '#eee',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
                onClick={() => onApplyBookMove(uci)}
              >
                {uci}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
