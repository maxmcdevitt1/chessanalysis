// webui/src/SidebarPane.tsx
// A feature-complete, commented, and scroll-safe sidebar.
// Layout: fixed header + scrollable content column so nothing gets cut off.

import React from 'react';
import { useEffect, useMemo } from 'react';
import { pgnFromMoves, annotatedPgn, analysisJson } from './utils/exporters';
import { useCoach } from './useCoach';
import type { CoachNote } from './useCoach';
import CoachMoveList from './components/CoachMoveList';

/* ---------------------------------- Types ---------------------------------- */

type Review = {
  avgCplW: number | null;
  avgCplB: number | null;
  whiteAcc: number | null;
  blackAcc: number | null;
  estEloWhite?: number | null;
  estEloBlack?: number | null;
} | null;

type QualityTally = {
  total: number;
  best: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
};

// --- Helper UI (define before usage to avoid runtime reference errors) ---
type MoveEval = {
  index: number;
  moveNo: number;
  side: 'White' | 'Black';
  san: string;
  uci: string;
  best?: string | null;
  cpBefore?: number | null; // white POV
  cpAfter?: number | null;  // white POV
  bestCpBefore?: number | null; // mover POV
  mateAfter?: number | null;
  cpl?: number | null;
  tag?: 'Genius' | 'Best' | 'Good' | 'Mistake' | 'Blunder' | 'Book';
  symbol?: '!!' | '!' | '!? ' | '?' | '??' | '';
  fenBefore: string;
  fenAfter: string;
};

type SidebarProps = {
  /* Shell controls */
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;

  /* Commentary / opening */
  currentEval?: MoveEval | null;
  openingText: string;
  gameEloWhite?: number | null;
  gameEloBlack?: number | null;
  movesUci: string[];
  moveEvals?: MoveEval[];
  openingInfo?: string | null;
  whiteAcc?: number | null;
  blackAcc?: number | null;
  avgCplW?: number | null;
  avgCplB?: number | null;
  result?: '1-0' | '0-1' | '1/2-1/2' | '*';
  ply: number;
  /** Number of plies from start that are in book (force-tag as "Book"). */
  bookDepth?: number;
  /** Per-ply mask telling whether each ply is inside book. */
  bookMask?: boolean[];

  /* Book */
  bookUci: string[];
  onApplyBookMove: (uci: string) => void;

  /* PGN */
  onLoadPgnText: (t: string) => void;
  onLoadPgnFile: (f: File) => void;

  /* Analysis */
  analyzing: boolean;
  progress: number | null;
  onAnalyze: () => void;
  onAnalyzeFast?: () => void;
  onStopAnalyze: () => void;

  /* Review */
  review: Review;
  moveEvals: MoveEval[];

  /* Navigation */
  onRebuildTo: (n: number) => void;

  /* Engine strength (1..20) is controlled by App.tsx */
  engineStrength: number;
  onEngineStrengthChange: (n: number) => void;
  onCoachNotesChange?: (notes: CoachNote[] | null) => void;
  activeCoachNotes?: CoachNote[] | null;
  coachNotes?: any[];
  currentPly?: number;
  onJumpToPly?: (idx:number)=>void;
  onGenerateNotes?: ()=>void | Promise<void>;
  coachBusy?: boolean;
};

/* ----------------------------- Helper functions ---------------------------- */

// UI maps strength 1..20 to 400..1800 Elo (display only)
function uiEloFromStrength(n: number) {
  return Math.round(400 + (Math.max(1, Math.min(20, n)) - 1) * ((2500- 400) / 19));
}

/* ---------------------------- Tag icon components -------------------------- */

// Inline SVGs you provided, wrapped in a single component.
function TagIcon({ tag, size = 24 }: { tag?: string | null; size?: number }) {
  const s = { width: size, height: size };
  switch (tag) {
    case 'Best':
      return (
        <svg viewBox="0 0 30 30" style={s} xmlns="http://www.w3.org/2000/svg" aria-label="Best move">
          <circle cx="15" cy="15" r="14" fill="#34a853"/>
          <polygon fill="#ffffff" points="15,5 18,12 26,12 19.5,17 22,25 15,20 8,25 10.5,17 4,12 12,12"/>
        </svg>
      );
    case 'Good':
      return (
        <svg viewBox="0 0 30 30" style={s} xmlns="http://www.w3.org/2000/svg" aria-label="Good move">
          <circle cx="15" cy="15" r="14" fill="#4aa3df"/>
          <rect x="14" y="7" width="2" height="12" fill="#ffffff"/>
          <circle cx="15" cy="22" r="2" fill="#ffffff"/>
        </svg>
      );
    case 'Mistake':
      return (
        <svg viewBox="0 0 30 30" style={s} xmlns="http://www.w3.org/2000/svg" aria-label="Mistake">
          <circle cx="15" cy="15" r="14" fill="#f4c430"/>
          <path d="M15 8c-2.8 0-5 1.9-5 4h3c0-1 .9-2 2-2s2 1 2 2c0 2-3 2.5-3 5h3c0-2.2 3-3 3-6 0-2.7-2.2-5-5-5z" fill="#b38300"/>
          <circle cx="15" cy="22" r="2" fill="#b38300"/>
        </svg>
      );
    case 'Blunder':
      return (
        <svg viewBox="0 0 30 30" style={s} xmlns="http://www.w3.org/2000/svg" aria-label="Blunder">
          <rect x="10" y="6" width="2" height="15" fill="#d93025"/>
          <rect x="18" y="6" width="2" height="15" fill="#d93025"/>
          <circle cx="11" cy="24" r="2" fill="#d93025"/>
          <circle cx="19" cy="24" r="2" fill="#d93025"/>
        </svg>
      );
    case 'Book':
      return (
        <svg viewBox="0 0 30 30" style={s} xmlns="http://www.w3.org/2000/svg" aria-label="Book move">
          <rect x="6" y="5" width="18" height="20" rx="2" ry="2" fill="#a56a38"/>
          <rect x="6" y="20" width="18" height="4" fill="#ecd8b5"/>
        </svg>
      );
    case 'Genius':
      return <TagIcon tag="Best" size={size} />;
    default:
      return <TagIcon tag="Good" size={size} />;
  }
}

/* --------------------------------- Styles ---------------------------------- */
/** All font sizes are ≥ 18px per your requirement */
const S = {
  // Outer sidebar: fixed height viewport; flex column; content scrolls.
  wrap: {
    height: '100vh',
    padding: 12,
    borderLeft: '1px solid #222',
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 420,
    fontSize: 18,
    lineHeight: 1.4,
    color: '#ddd',
    boxSizing: 'border-box' as const,
    background: '#26231f',
  },

  // Header row (non-scrolling)
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottom: '1px solid #222',
  },

  // Scrollable content
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto' as const,
    paddingTop: 8,
    paddingRight: 4,
  },

  // Reusable panel styling
  section: {
    border: '1px solid #333',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    background: '#111',
  },

  title: {
    fontWeight: 700 as const,
    marginBottom: 8,
    fontSize: 18,
  },

  small: {
    fontSize: 18,
    opacity: 0.8,
  },

  button: {
    fontSize: 18,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #333',
    background: '#1a1a1a',
    color: '#eee',
    cursor: 'pointer',
  },

  pill: {
    fontSize: 18,
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid #333',
    background: '#1a1a1a',
    color: '#eee',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },

  input: {
    fontSize: 18,
    background: '#0e0e0e',
    color: '#eee',
    border: '1px solid #333',
    borderRadius: 8,
    padding: '8px 10px',
  },

  select: {
    fontSize: 18,
    background: '#0e0e0e',
    color: '#eee',
    border: '1px solid #333',
    borderRadius: 8,
    padding: '6px 10px',
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 18,
  },

  thtd: {
    borderBottom: '1px solid #2a2a2a',
    padding: '6px 4px',
    textAlign: 'left' as const,
    verticalAlign: 'middle' as const,
  },
};

/* -------------------------------- Component -------------------------------- */

export default function SidebarPane(props: SidebarProps) {
  const {
    sidebarOpen, setSidebarOpen,
    openingText,
    gameEloWhite,
    gameEloBlack,
    movesUci = [],
    moveEvals = [],
    openingInfo = null,
    whiteAcc = null,
    blackAcc = null,
    avgCplW = null,
    avgCplB = null,
    result = '*',
    bookUci: _bookUci, onApplyBookMove: _onApplyBookMove,
    onLoadPgnText, onLoadPgnFile,
    analyzing, progress, onAnalyze, onAnalyzeFast, onStopAnalyze,
    review, onRebuildTo, bookDepth = 0, bookMask = [],
    engineStrength, onEngineStrengthChange,
    onCoachNotesChange,
    activeCoachNotes,
    coachNotes = [],
    currentPly = 0,
    onJumpToPly,
    onGenerateNotes,
    coachBusy,
    ply,
  } = props;

  const effElo = uiEloFromStrength(engineStrength);
  // Build the fixed list 400..2500 in 200s (including 2500)
  const ELO_CHOICES = [400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2500];

  // Map target Elo -> closest internal strength level (1..20)
  const strengthFromElo = (target: number) => {
    const levels = Array.from({ length: 20 }, (_, i) => i + 1);
    let bestLevel = 1, bestDiff = Infinity;
    for (const n of levels) {
      const elo = uiEloFromStrength(n);
      const diff = Math.abs(elo - target);
      if (diff < bestDiff) { bestDiff = diff; bestLevel = n; }
    }
    return bestLevel;
  };

  const selectedElo = ELO_CHOICES.reduce((closest, v) =>
    Math.abs(v - effElo) < Math.abs(closest - effElo) ? v : closest
  , ELO_CHOICES[0]);

  async function saveFile(defaultPath: string, ext: 'pgn' | 'json', content: string) {
    try {
      if ((window as any).electron?.invoke) {
        await (window as any).electron.invoke('export:save', {
          defaultPath,
          filters: ext === 'pgn'
            ? [{ name: 'PGN', extensions: ['pgn'] }]
            : [{ name: 'JSON', extensions: ['json'] }],
          content,
        });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([content], { type: ext === 'pgn' ? 'application/x-chess-pgn' : 'application/json' }));
        a.download = defaultPath;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
    } catch (e) {
      console.error('[export] failed', e);
    }
  }

  function exportPGN() {
    const pgn = pgnFromMoves({ movesUci: movesUci || [], result: result || '*' });
    saveFile('game.pgn', 'pgn', pgn);
  }

  function exportAnnotatedPGN() {
    const pgn = annotatedPgn({
      movesUci: movesUci || [],
      moveEvals: moveEvals as any[],
      headers: openingInfo ? { Opening: String(openingInfo) } : undefined,
      result: result || '*',
    });
    saveFile('game_annotated.pgn', 'pgn', pgn);
  }

  function exportJSON() {
    const json = analysisJson({
      movesUci: movesUci || [],
      moveEvals: moveEvals as any[],
      opening: openingInfo || null,
      whiteAcc: whiteAcc ?? null,
      blackAcc: blackAcc ?? null,
      avgCplW: avgCplW ?? null,
      avgCplB: avgCplB ?? null,
      result: result || '*',
    });
    saveFile('game_analysis.json', 'json', json);
  }


  return (
    <aside style={S.wrap}>
      {/* ---------- Header (fixed) ---------- */}
      <div style={S.header}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Commentary</div>
        <button
          style={S.button}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? 'Collapse' : 'Expand'}
        >
          {sidebarOpen ? '▸' : '▾'}
        </button>
      </div>

      {/* ---------- Scrollable content ---------- */}
      <div style={S.scroll}>
        {/* Commentary */}
        <div style={S.section}>
          {openingText
            ? <div>{openingText}</div>
            : <div style={S.small}><em>Make a move or load a PGN to see commentary.</em></div>}
      </div>

      {/* Coach */}
      <div style={S.section}>
        <div style={S.title}>Coach</div>
        <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <button
              style={{ ...S.button, opacity: coachBusy ? 0.6 : 1, pointerEvents: coachBusy ? 'none' : 'auto' }}
              onClick={() => onGenerateNotes && onGenerateNotes()}
              title="Generate per-move coach review"
            >
              {coachBusy ? 'Generating…' : 'Generate notes'}
            </button>
          </div>
          {Array.isArray(coachNotes) && coachNotes.length > 0 ? (
            <CoachMoveList
              notes={coachNotes}
              currentPly={currentPly}
              onJumpToPly={onJumpToPly || (() => {})}
              style={{ maxHeight: 220 }}
            />
          ) : (
            <div style={{ ...S.small }}>No coach notes yet.</div>
          )}
        </div>

        {/* Engine Strength (controlled from App) */}
        <div style={S.section}>
          <div style={S.title}>Engine Strength</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              style={S.select}
              value={selectedElo}
              onChange={(e) => {
                const chosenElo = Number(e.target.value);
                const level = strengthFromElo(chosenElo);
                onEngineStrengthChange(level);
              }}
              title="Select engine Elo (mapped to internal strength)"
            >
              {ELO_CHOICES.map((elo) => (
                <option key={elo} value={elo}>{elo} Elo</option>
              ))}
            </select>
            <span style={S.small}>Effective: {effElo} Elo</span>
            <span style={{ ...S.small, marginLeft: 6 }}>Advanced</span>
          </div>
        </div>

        {/* PGN controls */}
        <div style={S.section}>
          <div style={S.title}>PGN</div>
          <textarea
            rows={6}
            placeholder="Paste PGN here..."
            onBlur={(e) => onLoadPgnText(e.target.value)}
            style={{ ...S.input, width: '100%', resize: 'vertical' as const }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button style={S.button} onClick={onAnalyze} disabled={analyzing}>Analyze PGN</button>
            {onAnalyzeFast && (
              <button style={S.button} onClick={onAnalyzeFast} disabled={analyzing}>Fast</button>
            )}
            <button style={S.button} onClick={onStopAnalyze} disabled={!analyzing}>Stop</button>
            <label style={{ marginLeft: 'auto', cursor: 'pointer' }}>
              <input
                type="file"
                accept=".pgn,.txt"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onLoadPgnFile(f);
                }}
              />
              <span style={{ textDecoration: 'underline' }}>Choose File</span>
            </label>
          </div>
          {analyzing && (
            <div style={{ ...S.small, marginTop: 8 }}>
              Progress: {progress ?? 0}%
            </div>
          )}
        </div>

        {/* Game Review summary */}
        <div style={S.section}>
          <div style={S.title}>Game Review</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>White accuracy: <strong>{review?.whiteAcc != null ? `${Math.round(review.whiteAcc)}%` : '—'}</strong></div>
            <div>Black accuracy: <strong>{review?.blackAcc != null ? `${Math.round(review.blackAcc)}%` : '—'}</strong></div>
            <div>
              Avg CPL (W/B):{' '}
              <strong>{review?.avgCplW != null ? Math.round(review.avgCplW) : '—'}</strong> /{' '}
              <strong>{review?.avgCplB != null ? Math.round(review.avgCplB) : '—'}</strong>
            </div>
          </div>
          <div style={{ ...S.small, marginTop: 6 }}>
            Accuracy is based on average centipawn loss (lower CPL → higher accuracy).
          </div>
        </div>

        {/* Game Elo estimate */}
        {(gameEloWhite ?? gameEloBlack) != null && (
          <div style={S.section}>
            <div style={S.title}>Game Elo (estimate)</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={S.small}>White: {gameEloWhite != null ? Math.round(gameEloWhite) : '—'}</div>
              <div style={S.small}>Black: {gameEloBlack != null ? Math.round(gameEloBlack) : '—'}</div>
            </div>
          </div>
        )}

        {/* Export panel */}
        <div style={S.section}>
          <div style={S.title}>Export</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button style={S.button} onClick={exportPGN}>Export PGN</button>
            <button style={S.button} onClick={exportAnnotatedPGN}>PGN (annotated)</button>
            <button style={S.button} onClick={exportJSON}>Export JSON</button>
          </div>
        </div>

        {/* Moves table (stays within the scrollable column) — show "Opening" for book plies */}
        <div style={S.section}>
          <div style={S.title}>Moves</div>

          {/* Optional: sticky table header for long lists */}
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={{ ...S.thtd, position: 'sticky', top: 0, background: '#111' }}>#</th>
                  <th style={{ ...S.thtd, position: 'sticky', top: 0, background: '#111' }}>Side</th>
                  <th style={{ ...S.thtd, position: 'sticky', top: 0, background: '#111' }}>SAN</th>
                  <th style={{ ...S.thtd, position: 'sticky', top: 0, background: '#111' }}>Best</th>
                  <th style={{ ...S.thtd, position: 'sticky', top: 0, background: '#111' }}>Eval</th>
                  <th style={{ ...S.thtd, position: 'sticky', top: 0, background: '#111' }}>Icon</th>
                  <th style={{ ...S.thtd, position: 'sticky', top: 0, background: '#111' }}>Tag</th>
                </tr>
              </thead>
              <tbody>
                {moveEvals.map((m, i) => {
                  const isCurrent = i === ply - 1;
                  const isOpening = (i < bookMask.length ? bookMask[i] : i < bookDepth);
                  const iconTag = isOpening ? 'Book' : (m.tag || '');
                  const labelTag = isOpening ? 'Opening' : (m.tag || '');
                  return (
                    <tr
                      key={i}
                      onClick={() => onRebuildTo(i + 1)}
                      style={{
                        cursor: 'pointer',
                        background: isCurrent ? '#1b1b1b' : 'transparent',
                      }}
                    >
                      <td style={S.thtd}>{m.moveNo}</td>
                      <td style={S.thtd}>{m.side === 'White' ? 'W' : 'B'}</td>
                      <td style={S.thtd}>{m.san}</td>
                      <td style={S.thtd}>{m.best || ''}</td>
                      <td style={S.thtd}>
                        {(() => {
                          // Prefer White-POV number shipped by analysis if present
                          const whiteAfter =
                            typeof m.cpAfterWhite === 'number'
                              ? m.cpAfterWhite
                              : (typeof m.cpAfter === 'number'
                                  ? ((m.side === 'White' || m.side === 'W') ? -m.cpAfter : m.cpAfter)
                                  : null);
                          return whiteAfter == null ? '—' : (whiteAfter / 100).toFixed(1);
                        })()}
                      </td>
                      <td style={S.thtd}>
                        <TagIcon tag={iconTag} size={20} />
                      </td>
                      <td style={S.thtd}>{labelTag}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {/* ---------- /scroll ---------- */}
    </aside>
  );
}

/* --------------------------- CoachSection (local) --------------------------- */
function CoachSection({ openingText, review, moveEvals, onRebuildTo, onNotes, activeNotes }:{
  openingText: string;
  review: Review;
  moveEvals: MoveEval[];
  onRebuildTo: (n:number)=>void;
  onNotes?: (notes: CoachNote[] | null) => void;
  activeNotes?: CoachNote[] | null;
}){
  const { notes, busy, err, run } = useCoach();

  const inputs = useMemo(()=>({
      summary: {
        opening: openingText || undefined,
        whiteAcc: review?.whiteAcc ?? undefined,
        blackAcc: review?.blackAcc ?? undefined,
        avgCplW: review?.avgCplW ?? undefined,
        avgCplB: review?.avgCplB ?? undefined,
      },
    moments: moveEvals
      .filter(m => m.tag === 'Mistake' || m.tag === 'Blunder' || m.tag === 'Best' || m.tag === 'Genius')
      .map(m => ({
        index: m.index,
        moveNo: m.moveNo,
        side: m.side === 'White' ? 'W' : 'B',
        san: m.san,
        tag: m.tag === 'Genius' ? 'Best' : (m.tag || 'Good'),
        cpBefore: m.cpBefore ?? null,
        cpAfter: m.cpAfter ?? null,
        best: m.best ?? null,
      })),
    pgn: undefined
  }), [openingText, review, moveEvals]);

  useEffect(() => {
    onNotes?.(notes || null);
  }, [notes, onNotes]);

  const activeKey = (n: CoachNote) =>
    `${n?.type}:${n?.type === 'move' ? n.moveIndex : ''}:${n?.text || ''}`;
  const activeSet = new Set((activeNotes || []).map(activeKey));

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button style={S.button} onClick={() => run(inputs)} disabled={busy}>
          {busy ? 'Coach…' : 'Generate notes'}
        </button>
        {err && <span style={S.small}>Coach offline</span>}
      </div>
      {(activeNotes?.length ?? 0) > 0 && (
        <div style={{ ...S.small, padding: '4px 8px', border: '1px dashed #444', borderRadius: 6 }}>
          {activeNotes?.map((n, i) => (
            <div key={i}>
              {n.type === 'move' ? (
                <>
                  <strong>Move {((n.moveIndex ?? 0) + 1)}:</strong> {n.text}
                </>
              ) : (
                n.text
              )}
            </div>
          ))}
        </div>
      )}
      <ul style={{ margin:0, paddingLeft:18, maxHeight:200, overflow:'auto' }}>
        {notes?.map((n, i) => (
          <li
            key={i}
            style={activeSet.has(activeKey(n))
              ? { background:'#1f1f1f', borderRadius:6, padding:'2px 6px' }
              : undefined}
          >
            {n.type === 'move'
              ? <a onClick={() => onRebuildTo((n.moveIndex ?? 0) + 1)} role="button">{n.text}</a>
              : <span>{n.text}</span>}
          </li>
        )) || null}
      </ul>
    </div>
  );
}
