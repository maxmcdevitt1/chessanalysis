// webui/src/SidebarPane.tsx
// A feature-complete, commented, and scroll-safe sidebar.
// Layout: fixed header + scrollable content column so nothing gets cut off.

import React from 'react';
import { useMemo } from 'react';
import { FixedSizeList } from 'react-window';
import { pgnFromMoves, annotatedPgn, analysisJson } from './utils/exporters';
import type { CoachMomentNote, CoachMoveNote, CoachSections } from './types/coach';
import OpeningPanel from './components/OpeningPanel';
import CoachPanel from './components/CoachPanel';
import EnginePanel from './components/EnginePanel';
import type { StrengthBandId } from './strengthBands';
import type { MoveEval } from './types/moveEval';
import SettingsPanel from './components/SettingsPanel';
import type { Settings } from './hooks/useSettings';

/* ---------------------------------- Types ---------------------------------- */

type Review = {
  avgCplW: number | null;
  avgCplB: number | null;
  whiteAcc: number | null;
  blackAcc: number | null;
  estEloWhite?: number | null;
  estEloBlack?: number | null;
  quality?: { W: QualityTally; B: QualityTally };
  rollingAcpl?: number | null;
  rollingAcc?: number | null;
  rollingSamples?: number | null;
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
  openingInfo?: string | null;
  whiteAcc?: number | null;
  blackAcc?: number | null;
  avgCplW?: number | null;
  avgCplB?: number | null;
  result?: '1-0' | '0-1' | '1/2-1/2' | '*';
  ply: number;
  showMoves?: boolean;
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

  /* Engine strength band is controlled by App.tsx */
  engineBand: StrengthBandId;
  onEngineBandChange: (id: StrengthBandId) => void;
  coachSections?: CoachSections | null;
  coachMomentNotes?: CoachMomentNote[] | null;
  coachMoveNotes?: CoachMoveNote[] | null;
  onGenerateNotes?: ()=>void | Promise<void>;
  coachBusy?: boolean;
  coachError?: string | null;
  liveEvalCp?: number | null;
  evalPending?: boolean;
  engineSettings: Pick<Settings, 'engineThreads' | 'engineHashMb' | 'liveMultipv' | 'disableGpu'>;
  onSettingsChange: (patch: Partial<Settings>) => void;
};

type MoveRowData = {
  moveEvals: MoveEval[];
  ply: number;
  bookMask: boolean[];
  bookDepth: number;
  onRebuildTo: (n: number) => void;
};

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

function Pill({ label, value }: { label: string; value?: number }) {
  const display = Number.isFinite(value) ? value : '—';
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 999,
      background: '#1f1f1f',
      border: '1px solid #333',
      fontSize: 16,
      color: '#eaeaea',
    }}>
      {label}: <strong>{display}</strong>
    </span>
  );
}

/* --------------------------------- Styles ---------------------------------- */
/** All font sizes are ≥ 18px per your requirement */
const S = {
  // Outer sidebar: fixed height viewport; flex column; content scrolls.
  wrap: {
    height: '100vh',
    padding: 14,
    borderLeft: '1px solid #1f1f1f',
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 420,
    fontSize: 18,
    lineHeight: 1.4,
    color: '#ddd',
    boxSizing: 'border-box' as const,
    background: 'linear-gradient(180deg, #151310 0%, #0f0d0b 100%)',
  },

  // Header row (non-scrolling)
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottom: '1px solid #1f1f1f',
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
    border: '1px solid #2b2b2b',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    background: 'linear-gradient(180deg, #1d1a17 0%, #141210 100%)',
    boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
  },
  singleBox: {
    border: '1px solid #2b2b2b',
    borderRadius: 12,
    padding: 16,
    background: 'linear-gradient(180deg, #1d1a17 0%, #141210 100%)',
    boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  subSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  divider: {
    height: 1,
    background: '#2b2b2b',
    margin: '4px 0',
  },

  title: {
    fontWeight: 700 as const,
    marginBottom: 8,
    fontSize: 19,
    letterSpacing: 0.2,
    color: '#f3f0ea',
  },

  small: {
    fontSize: 18,
    opacity: 0.82,
    color: '#c8cbc9',
  },

  button: {
    fontSize: 18,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #2d2d2d',
    background: '#1f1f1f',
    color: '#eee',
    cursor: 'pointer',
    transition: 'all 120ms ease',
  },

  pill: {
    fontSize: 18,
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid #2d2d2d',
    background: '#1c1b18',
    color: '#f0f0f0',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },

  input: {
    fontSize: 18,
    background: '#0f0f0f',
    color: '#f3f3f3',
    border: '1px solid #2a2a2a',
    borderRadius: 10,
    padding: '9px 12px',
  },

  select: {
    fontSize: 18,
    background: '#0f0f0f',
    color: '#f3f3f3',
    border: '1px solid #2a2a2a',
    borderRadius: 10,
    padding: '7px 10px',
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 19,
  },

  thtd: {
    borderBottom: '1px solid #2a2a2a',
    padding: '6px 4px',
    textAlign: 'left' as const,
    verticalAlign: 'middle' as const,
  },
  progressOuter: {
    width: '100%',
    height: 10,
    borderRadius: 999,
    background: '#1a1a1a',
    border: '1px solid #2f2f2f',
    overflow: 'hidden',
  },
  progressInner: (pct: number) => ({
    width: `${Math.max(0, Math.min(100, pct))}%`,
    height: '100%',
    background: 'linear-gradient(90deg, #4caf50, #8bc34a)',
    transition: 'width 180ms ease',
  }),
  progressIndeterminate: {
    width: '45%',
    height: '100%',
    background: 'linear-gradient(90deg, #4caf50, #8bc34a)',
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
    showMoves = true,
    bookUci: _bookUci, onApplyBookMove: _onApplyBookMove,
    onLoadPgnText, onLoadPgnFile,
    analyzing, progress, onAnalyze, onAnalyzeFast, onStopAnalyze,
    review, onRebuildTo, bookDepth = 0, bookMask = [],
    engineBand, onEngineBandChange,
    coachSections,
    coachMomentNotes,
    coachMoveNotes,
    onGenerateNotes,
    coachBusy,
    coachError,
    ply,
    liveEvalCp = null,
    evalPending = false,
    engineSettings,
    onSettingsChange,
  } = props;

  const ProgressBar = ({ value }: { value?: number | null }) => {
    const pct = typeof value === 'number' && isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
    return (
      <div style={S.progressOuter}>
        {pct != null
          ? <div style={S.progressInner(pct)} />
          : <div style={S.progressIndeterminate} />}
      </div>
    );
  };

  const deltaEvalForMove = (m: any): number | null => {
    const side = (m.side === 'White' || m.side === 'W') ? 'W' : 'B';
    const afterWhite = (() => {
      if (typeof m?.cpAfterWhite === 'number') return m.cpAfterWhite;
      if (typeof m?.cpAfter === 'number') {
        // cpAfter is stored as opponent POV after the move
        return side === 'W' ? -m.cpAfter : m.cpAfter;
      }
      return null;
    })();
    const beforeWhite = (() => {
      if (typeof m?.cpBefore === 'number') return m.cpBefore; // White POV
      if (typeof m?.bestCpBefore === 'number') {
        return side === 'W' ? m.bestCpBefore : -m.bestCpBefore;
      }
      return null;
    })();
    if (afterWhite == null || beforeWhite == null) return null;
    return afterWhite - beforeWhite;
  };

  const formatDelta = (cpDelta: number | null) => {
    if (cpDelta == null || !isFinite(cpDelta)) return '—';
    const pawns = cpDelta / 100;
    return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
  };

  const moveRowHeight = 46;
  const moveListHeight = Math.min(480, Math.max(moveRowHeight, moveEvals.length * moveRowHeight));
  const moveListColumns = '60px 50px 1fr 1fr 90px 70px 100px';
  const moveListData = useMemo<MoveRowData>(() => ({
    moveEvals,
    ply,
    bookMask: bookMask || [],
    bookDepth: bookDepth || 0,
    onRebuildTo,
  }), [moveEvals, ply, bookMask, bookDepth, onRebuildTo]);

  const MoveRow = ({ index, style, data }: { index: number; style: React.CSSProperties; data: MoveRowData }) => {
    const m = data.moveEvals[index];
    if (!m) return null;
    const isCurrent = index === data.ply - 1;
    const isOpening = (index < data.bookMask.length ? data.bookMask[index] : index < data.bookDepth);
    const iconTag = isOpening ? 'Book' : (m.tag || '');
    const labelTag = isOpening ? 'Opening' : (m.tag || '');
    return (
      <div
        style={{
          ...style,
          display: 'grid',
          gridTemplateColumns: moveListColumns,
          alignItems: 'center',
          cursor: 'pointer',
          background: isCurrent ? '#1b1b1b' : 'transparent',
          padding: '6px 8px',
          borderBottom: '1px solid #222',
          boxSizing: 'border-box',
        }}
        onClick={() => data.onRebuildTo(index + 1)}
      >
        <div>{m.moveNo}</div>
        <div>{m.side === 'White' ? 'W' : 'B'}</div>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.san}</div>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.best || ''}</div>
        <div>{formatDelta(deltaEvalForMove(m))}</div>
        <div><TagIcon tag={iconTag} size={20} /></div>
        <div>{labelTag}</div>
      </div>
    );
  };

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
        <div style={S.singleBox}>
          {/* Commentary + Opening */}
          <div style={S.subSection}>
            <OpeningPanel
              openingText={openingText}
              bookMoves={_bookUci || []}
              onApplyBookMove={_onApplyBookMove}
            />
          </div>

          <div style={S.divider} />

          {/* Coach */}
          <div style={S.subSection}>
          <CoachPanel
            sections={coachSections || undefined}
            busy={!!coachBusy}
            onGenerate={onGenerateNotes}
            error={coachError || undefined}
            momentNotes={coachMomentNotes || undefined}
            fallbackNotes={coachMoveNotes || undefined}
            activeMoveIndex={ply ? ply - 1 : null}
          />
          </div>

          <div style={S.divider} />

          {/* Engine info */}
          <div style={S.subSection}>
            <EnginePanel
              evalCp={liveEvalCp ?? null}
              evalPending={evalPending}
              band={engineBand}
              onBandChange={onEngineBandChange}
            />
          </div>

          <div style={S.divider} />

          <div style={S.subSection}>
            <SettingsPanel
              settings={engineSettings}
              onChange={onSettingsChange}
            />
          </div>

          <div style={S.divider} />

          {/* PGN controls */}
          <div style={S.subSection}>
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
              <div style={{ marginTop: 8, display:'flex', flexDirection:'column', gap:6 }}>
                <ProgressBar value={progress ?? 0} />
                <div style={{ ...S.small }}>Progress: {progress ?? 0}%</div>
              </div>
            )}
          </div>

          <div style={S.divider} />

          {/* Game Review summary */}
          <div style={S.subSection}>
            <div style={S.title}>Game Review</div>

            {/* Accuracy + CPL */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                White accuracy:{' '}
                <strong>{review?.whiteAcc != null ? `${Math.round(review.whiteAcc)}%` : '—'}</strong>
              </div>
              <div>
                Black accuracy:{' '}
                <strong>{review?.blackAcc != null ? `${Math.round(review.blackAcc)}%` : '—'}</strong>
              </div>
              <div>
                Avg CPL (W/B):{' '}
                <strong>{review?.avgCplW != null ? Math.round(review.avgCplW) : '—'}</strong> /{' '}
                <strong>{review?.avgCplB != null ? Math.round(review.avgCplB) : '—'}</strong>
              </div>
              <div>
                Rolling ACPL:{' '}
                <strong>
                  {review?.rollingAcpl != null
                    ? `${Math.round(review.rollingAcpl)} (${review?.rollingAcc != null ? Math.round(review.rollingAcc) : '—'}% acc)`
                    : '—'}
                </strong>{' '}
                {review?.rollingSamples ? `(last ${review.rollingSamples} plies)` : ''}
              </div>
            </div>

            {/* Move quality counts */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              padding: '8px 10px',
              background: '#0f0f0f',
              border: '1px solid #222',
              borderRadius: 8,
            }}>
              <div>
                <div style={S.small}>White moves</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  <Pill label="Best" value={review?.quality?.W?.best} />
                  <Pill label="Good" value={review?.quality?.W?.good} />
                  <Pill label="Inacc" value={review?.quality?.W?.inaccuracy ?? review?.quality?.W?.inacc} />
                  <Pill label="Mist" value={review?.quality?.W?.mistake} />
                  <Pill label="Blun" value={review?.quality?.W?.blunder} />
                </div>
              </div>
              <div>
                <div style={S.small}>Black moves</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  <Pill label="Best" value={review?.quality?.B?.best} />
                  <Pill label="Good" value={review?.quality?.B?.good} />
                  <Pill label="Inacc" value={review?.quality?.B?.inaccuracy ?? review?.quality?.B?.inacc} />
                  <Pill label="Mist" value={review?.quality?.B?.mistake} />
                  <Pill label="Blun" value={review?.quality?.B?.blunder} />
                </div>
                </div>
              </div>

          </div>

          <div style={S.divider} />

          {/* Export panel */}
          <div style={S.subSection}>
            <div style={S.title}>Export</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button style={S.button} onClick={exportPGN}>Export PGN</button>
              <button style={S.button} onClick={exportAnnotatedPGN}>PGN (annotated)</button>
              <button style={S.button} onClick={exportJSON}>Export JSON</button>
            </div>
          </div>

          {showMoves && (
            <>
              <div style={S.divider} />
              <div style={S.subSection}>
                <div style={S.title}>Moves</div>

                <div style={{ maxHeight: 480, overflow: 'hidden', border: '1px solid #222', borderRadius: 8 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: moveListColumns,
                      position: 'sticky',
                      top: 0,
                      background: '#111',
                      padding: '8px',
                      fontWeight: 600,
                      fontSize: 14,
                      zIndex: 1,
                      borderBottom: '1px solid #222',
                    }}
                  >
                    <div>#</div>
                    <div>Side</div>
                    <div>SAN</div>
                    <div>Best</div>
                    <div>Eval</div>
                    <div>Icon</div>
                    <div>Tag</div>
                  </div>
                  <FixedSizeList
                    height={moveListHeight}
                    itemCount={moveEvals.length}
                    itemData={moveListData}
                    itemSize={moveRowHeight}
                    width="100%"
                    itemKey={(idx) => moveEvals[idx]?.uci ? `${idx}-${moveEvals[idx].uci}` : idx}
                  >
                    {MoveRow}
                  </FixedSizeList>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {/* ---------- /scroll ---------- */}
    </aside>
  );
}
