// webui/src/SidebarPane.tsx
// A feature-complete, commented, and scroll-safe sidebar.
// Layout: fixed header + scrollable content column so nothing gets cut off.

import React, { useMemo } from 'react';
import { useCoach } from './useCoach';

/* ---------------------------------- Types ---------------------------------- */

type OpeningMatch = { eco: string; name: string; variation?: string | null; ply: number };

type Review = {
  avgW: number | null;
  avgB: number | null;
  whiteAcc: number | null;
  blackAcc: number | null;
} | null;

type QualityCounts = { Best: number; Good: number; Mistake: number; Blunder: number; Book: number };

type MoveEval = {
  index: number;
  moveNo: number;
  side: 'White' | 'Black';
  san: string;
  uci: string;
  best?: string | null;
  cpBefore?: number | null; // white POV
  cpAfter?: number | null;  // white POV
  cpl?: number | null;
  tag?: 'Genius' | 'Best' | 'Good' | 'Mistake' | 'Blunder' | 'Book';
  symbol?: '!!' | '!' | '!? ' | '?' | '??' | '';
  fenBefore: string;
  fenAfter: string;
};

type Props = {
  /* Shell controls */
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;

  /* Commentary / opening */
  currentEval?: MoveEval | null;
  openingText: string;
  movesUci: string[];
  openingAt: (OpeningMatch | null)[];
  ply: number;

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
  onStopAnalyze: () => void;

  /* Review */
  review: Review;
  moveEvals: MoveEval[];
  qualityCounts: QualityCounts;

  /* Navigation */
  onRebuildTo: (n: number) => void;

  /* Engine strength (1..20) is controlled by App.tsx */
  engineStrength: number;
  onEngineStrengthChange: (n: number) => void;
};

/* ----------------------------- Helper functions ---------------------------- */

// UI maps strength 1..20 to 400..1800 Elo (display only)
function uiEloFromStrength(n: number) {
  return Math.round(400 + (Math.max(1, Math.min(20, n)) - 1) * ((1800 - 400) / 19));
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

export default function SidebarPane(props: Props) {
  const {
    sidebarOpen, setSidebarOpen,
    openingText,
    bookUci, onApplyBookMove,
    onLoadPgnText, onLoadPgnFile,
    analyzing, progress, onAnalyze, onStopAnalyze,
    review, moveEvals, qualityCounts, onRebuildTo,
    engineStrength, onEngineStrengthChange,
    ply,
  } = props;

  const effElo = uiEloFromStrength(engineStrength);

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

        {/* Coach (Local ML via Ollama) */}
        <div style={S.section}>
          <div style={S.title}>Coach</div>
          <CoachSection
            openingText={openingText}
            review={review}
            moveEvals={moveEvals}
            onRebuildTo={onRebuildTo}
          />
        </div>

        {/* Book suggestions */}
        <div style={S.section}>
          <div style={S.title}>Book</div>
          {bookUci && bookUci.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {bookUci.map((uci) => (
                <button key={uci} style={S.pill} onClick={() => onApplyBookMove(uci)}>
                  BOOK {uci}
                </button>
              ))}
            </div>
          ) : (
            <div style={S.small}>No book suggestion.</div>
          )}
        </div>

        {/* Engine Strength (controlled from App) */}
        <div style={S.section}>
          <div style={S.title}>Engine Strength</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              style={S.select}
              value={engineStrength}
              onChange={(e) => onEngineStrengthChange(Number(e.target.value))}
              title="Maps to UI Elo 400–1800 and also adjusts movetime/randomness"
            >
              {Array.from({ length: 20 }).map((_, i) => {
                const n = i + 1;
                const elo = uiEloFromStrength(n);
                return (
                  <option key={n} value={n}>
                    {elo} Elo
                  </option>
                );
              })}
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
            <div>White accuracy: <strong>{review?.whiteAcc ?? '—'}%</strong></div>
            <div>Black accuracy: <strong>{review?.blackAcc ?? '—'}%</strong></div>
            <div>
              Avg CPL (W/B):{' '}
              <strong>{review?.avgW == null ? '—' : review.avgW.toFixed(1)}</strong> /{' '}
              <strong>{review?.avgB == null ? '—' : review.avgB.toFixed(1)}</strong>
            </div>
          </div>
          <div style={{ ...S.small, marginTop: 6 }}>
            Accuracy is based on average centipawn loss (lower CPL → higher accuracy).
          </div>
        </div>

        {/* Move Quality counts */}
        <div style={S.section}>
          <div style={S.title}>Move Quality</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <TagIcon tag="Best" size={22} /> Best <strong>{qualityCounts.Best}</strong>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <TagIcon tag="Good" size={22} /> Good <strong>{qualityCounts.Good}</strong>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <TagIcon tag="Mistake" size={22} /> Mistake <strong>{qualityCounts.Mistake}</strong>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <TagIcon tag="Blunder" size={22} /> Blunder <strong>{qualityCounts.Blunder}</strong>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <TagIcon tag="Book" size={22} /> Book <strong>{qualityCounts.Book}</strong>
            </div>
          </div>
        </div>

        {/* Moves table (stays within the scrollable column) */}
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
                        {m.cpAfter == null ? '—' : (m.cpAfter > 0 ? `+${m.cpAfter/100}` : `${m.cpAfter/100}`)}
                      </td>
                      <td style={S.thtd}>
                        <TagIcon tag={m.tag} size={20} />
                      </td>
                      <td style={S.thtd}>{m.tag || ''}</td>
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
function CoachSection({ openingText, review, moveEvals, onRebuildTo }:{
  openingText: string;
  review: Review;
  moveEvals: MoveEval[];
  onRebuildTo: (n:number)=>void;
}){
  const { notes, busy, err, run } = useCoach();

  const inputs = useMemo(()=>({
    summary: {
      opening: openingText || undefined,
      whiteAcc: review?.whiteAcc ?? undefined,
      blackAcc: review?.blackAcc ?? undefined,
      avgCplW: review?.avgW ?? undefined,
      avgCplB: review?.avgB ?? undefined,
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

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button style={S.button} onClick={() => run(inputs)} disabled={busy}>
          {busy ? 'Coach…' : 'Generate notes'}
        </button>
        {err && <span style={S.small}>Coach offline</span>}
      </div>
      <ul style={{ margin:0, paddingLeft:18, maxHeight:200, overflow:'auto' }}>
        {notes?.map((n, i) => (
          <li key={i}>
            {n.type === 'move'
              ? <a onClick={() => onRebuildTo((n.moveIndex ?? 0) + 1)} role="button">{n.text}</a>
              : <span>{n.text}</span>}
          </li>
        )) || null}
      </ul>
    </div>
  );
}

