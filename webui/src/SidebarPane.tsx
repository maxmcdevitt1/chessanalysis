// webui/src/SidebarPane.tsx
import React, { useState } from 'react';
import type { MoveEval } from './App';

type SidebarProps = {
  // layout / state
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;

  // current eval context (optional)
  currentEval?: MoveEval | undefined;

  // opening / book
  openingText: string;
  movesUci: string[];
  openingAt: (any | null)[];
  ply: number;
  bookUci: string[];

  // analysis state
  analyzing: boolean;
  progress: number | null;
  review: {
    avgW: number | null;
    avgB: number | null;
    whiteAcc: number | null;
    blackAcc: number | null;
  } | null;

  // move list (per-move evals)
  moveEvals: MoveEval[];
  qualityCounts: { Best: number; Good: number; Mistake: number; Blunder: number; Book: number };

  // actions
  onRebuildTo: (ply: number) => void;
  onAnalyze: () => void;
  onStopAnalyze: () => void;
  onLoadPgnText: (text: string) => void;
  onLoadPgnFile: (file: File) => void;
  onApplyBookMove: (uci: string) => void;
};

export default function SidebarPane(props: SidebarProps) {
  const {
    sidebarOpen, setSidebarOpen,
    openingText, bookUci,
    analyzing, progress, review, qualityCounts,
    moveEvals, ply,
    onRebuildTo, onAnalyze, onStopAnalyze, onLoadPgnText, onLoadPgnFile, onApplyBookMove,
  } = props;

  // Local PGN textarea (explicit load, no auto analyze)
  const [pgnTextLocal, setPgnTextLocal] = useState('');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    onLoadPgnFile(f);
  }

  function handleLoadPgnClick() {
    if (!pgnTextLocal.trim()) return;
    onLoadPgnText(pgnTextLocal);
  }

  // Readability scale
  const baseFont = 16.5;
  const btn: React.CSSProperties = { padding: '9px 14px', fontSize: baseFont, borderRadius: 6 };
  const box: React.CSSProperties = { border:'1px solid #333', borderRadius:6, padding:12, marginBottom:12 };
  const label: React.CSSProperties = { fontWeight:700, marginBottom:8, fontSize: baseFont };

function tagIcon(tag?: MoveEval['tag'] | 'Book'): string {
  switch (tag) {
    case 'Genius': return '💡';  // brilliant
    case 'Best':   return '✅';  // best
    case 'Good':   return '✓';   // solid
    case 'Mistake':return '⚠️';  // mistake
    case 'Blunder':return '💀';  // blunder
    case 'Book':   return '📘';  // book
    default:       return '';
  }
}

  // Tag color map (includes Book)
  function tagColor(tag?: MoveEval['tag'] | 'Book'): string | undefined {
    switch (tag) {
      case 'Best':    return '#26c281'; // green
      case 'Good':    return '#5dade2'; // blue
      case 'Mistake': return '#f5b041'; // orange
      case 'Blunder': return '#e74c3c'; // red
      case 'Genius':  return '#af7ac5'; // purple
      case 'Book':    return '#bdc3c7'; // gray
      default:        return undefined;
    }
  }

  // BOOK chip
  function BookChip() {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 6px',
          borderRadius: 999,
          background: 'rgba(189,195,199,0.15)',
          color: tagColor('Book'),
          border: '1px solid #3a3f44',
          fontSize: baseFont - 2,
          fontWeight: 700,
          letterSpacing: 0.3,
        }}
      >
        BOOK
      </span>
    );
  }

  // Eval label from cpAfter (white POV)
  function evalLabelFromCpAfter(cpAfter?: number | null): string {
    if (cpAfter == null) return '';
    const pawns = cpAfter / 100;
    const s = pawns.toFixed(1);
    return pawns > 0 ? `+${s}` : s;
  }

  const hasBook = Array.isArray(bookUci) && bookUci.length > 0;

  return (
    <div style={{
      borderLeft:'1px solid #333',
      padding:12,
      overflow:'hidden',
      fontSize: baseFont,
      width: sidebarOpen ? 480 : 28,
      boxSizing:'border-box'
    }}>
      {/* Collapse / expand control */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:6 }}>
        <button
          title={sidebarOpen ? 'Collapse' : 'Expand'}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ padding:'4px 8px', fontSize: baseFont - 2 }}
        >
          {sidebarOpen ? '⯈' : '⯇'}
        </button>
      </div>

      {!sidebarOpen ? null : (
        <>
          {/* Opening / Commentary */}
          <div style={box}>
            <div style={label}>Commentary</div>
            <div style={{ color:'#9bd1ff', fontWeight:600, lineHeight:1.35 }}>
              {openingText ? openingText : 'Make a move or load a PGN to see commentary.'}
            </div>
          </div>

          {/* Book moves (compact) */}
          <div style={{ ...box, padding: 8 }}>
            <div style={{ ...label, marginBottom: 6, fontSize: baseFont - 1 }}>Book</div>
            {hasBook ? (
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {bookUci.map((u) => (
                  <button
                    key={u}
                    onClick={() => onApplyBookMove(u)}
                    style={{ padding: '4px 8px', fontSize: baseFont - 2, borderRadius: 999 }}
                    title="Apply book move"
                  >
                    <span
                      style={{
                        display:'inline-block',
                        padding:'1px 6px',
                        borderRadius: 999,
                        background:'rgba(189,195,199,0.15)',
                        color:'#bdc3c7',
                        border:'1px solid #3a3f44',
                        fontSize: baseFont - 3,
                        fontWeight:700,
                        letterSpacing:0.3,
                        marginRight:6
                      }}
                    >
                      BOOK
                    </span>
                    {u}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ opacity:0.75 }}>No book suggestion.</div>
            )}
          </div>

          {/* PGN input (textarea + file upload) */}
          <div style={box}>
            <div style={label}>PGN</div>
            <textarea
              value={pgnTextLocal}
              onChange={(e) => setPgnTextLocal(e.target.value)}
              placeholder="Paste PGN here..."
              style={{
                width:'100%',
                minHeight:130,
                background:'#0c0c0c',
                color:'#ddd',
                border:'1px solid #333',
                borderRadius:6,
                padding:12,
                fontSize: baseFont,
                boxSizing:'border-box',
                lineHeight:1.4
              }}
            />
            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10 }}>
              <button onClick={handleLoadPgnClick} title="Load PGN into the board" style={btn}>Load PGN</button>
              <input type="file" accept=".pgn" onChange={handleFileChange} />
            </div>
          </div>

          {/* Game Review */}
          <div style={box}>
            <div style={label}>Game Review</div>
            <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'8px 12px', alignItems:'center' }}>
              <div>White accuracy:</div>
              <div>{review?.whiteAcc != null ? `${Math.round(review.whiteAcc)}%` : '—'}</div>

              <div>Black accuracy:</div>
              <div>{review?.blackAcc != null ? `${Math.round(review.blackAcc)}%` : '—'}</div>

              <div>Avg CPL (W/B):</div>
              <div>
                {review?.avgW != null ? review.avgW.toFixed(1) : '—'}
                {' / '}
                {review?.avgB != null ? review.avgB.toFixed(1) : '—'}
              </div>
            </div>

            {progress != null && (
              <div style={{ marginTop:10, fontSize: baseFont - 1, opacity:0.85 }}>
                Progress: {progress}%
              </div>
            )}
            <div style={{ marginTop:10, fontSize: baseFont - 2, opacity:0.7 }}>
              Accuracy is based on average centipawn loss (lower CPL → higher accuracy).
            </div>
          </div>

          <div style={{ ...box, padding: 10 }}>
            <div style={label}>Move Quality</div>
            <div style={{ display:'grid', gridTemplateColumns:'auto 1fr auto', gap:'6px 8px', alignItems:'center', fontSize: baseFont - 1 }}>
              <span>✅</span>
              <span>Best</span>
              <span style={{ textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{qualityCounts.Best}</span>

              <span>👍</span>
              <span>Good</span>
              <span style={{ textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{qualityCounts.Good}</span>

              <span>⚠️</span>
              <span>Mistake</span>
              <span style={{ textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{qualityCounts.Mistake}</span>

              <span>💀</span>
              <span>Blunder</span>
              <span style={{ textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{qualityCounts.Blunder}</span>

              <span>📘</span>
              <span>Book</span>
              <span style={{ textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{qualityCounts.Book}</span>
            </div>
          </div>

          {/* Analyze / Stop */}
          <div style={{ display:'flex', gap:10, marginBottom:12 }}>
            <button onClick={onAnalyze} disabled={progress !== null} style={btn}>
              {progress != null ? 'Analyzing...' : 'Analyze PGN'}
            </button>
            <button onClick={onStopAnalyze} disabled={progress === null && !analyzing} style={btn}>
              Stop
            </button>
          </div>

          {/* Moves table (click to jump; highlight active; Book chip in Tag) */}
          <div style={{ marginTop:8, fontWeight:700, fontSize: baseFont }}>Moves</div>
          <div style={{ border:'1px solid #333', borderRadius:6, height:380, overflow:'auto', marginTop:6 }}>
            <table style={{ width:'100%', fontSize: baseFont, borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left', padding:10 }}>#</th>
                  <th style={{ textAlign:'left', padding:10 }}>Side</th>
                  <th style={{ textAlign:'left', padding:10 }}>SAN</th>
                  <th style={{ textAlign:'left', padding:10 }}>Best</th>
                  <th style={{ textAlign:'left', padding:10 }}>Eval</th>
                  <th style={{ textAlign:'left', padding:10 }}>Icon</th>

                  <th style={{ textAlign:'left', padding:10 }}>Tag</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(moveEvals) && moveEvals.map((m) => {
                  const color = tagColor(m.tag);
                  const isBook = m.tag === 'Book';
                  const isActive = (m.index + 1) === ply;

                  return (
                    <tr
                      key={m.index}
                      onClick={() => onRebuildTo(m.index + 1)}
                      style={{ cursor: 'pointer', background: isActive ? '#1f2a36' : undefined }}
                    >
                      <td style={{ padding:10 }}>{m.moveNo}</td>
                      <td style={{ padding:10 }}>{m.side}</td>
                      <td style={{ padding:10 }}>{m.san}</td>
                      <td style={{ padding:10 }}>{m.best ?? ''}</td>
                      <td style={{ padding:10 }}>{evalLabelFromCpAfter(m.cpAfter)}</td>
                      <td style={{ padding:10, fontSize: baseFont }}>{tagIcon(isBook ? 'Book' : m.tag)}</td>
                      <td style={{ padding:10, fontWeight:700 }}>{isBook ? <BookChip /> : <span style={{ color }}>{m.tag ?? ''}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
