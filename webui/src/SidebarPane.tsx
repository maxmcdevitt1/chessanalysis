import React, { useState, useRef } from 'react';
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
  inacc?: number;
  mistake: number;
  blunder: number;
};

type SidebarProps = {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
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
  bookDepth?: number;
  bookMask?: boolean[];
  bookUci: string[];
  onApplyBookMove: (uci: string) => void;
  onLoadPgnText: (t: string) => void;
  onLoadPgnFile: (f: File) => void;
  analyzing: boolean;
  progress: number | null;
  onAnalyze: () => void;
  onAnalyzeFast?: () => void;
  onStopAnalyze: () => void;
  review: Review;
  moveEvals: MoveEval[];
  onRebuildTo: (n: number) => void;
  engineBand: StrengthBandId;
  onEngineBandChange: (id: StrengthBandId) => void;
  coachSections?: CoachSections | null;
  coachMomentNotes?: CoachMomentNote[] | null;
  coachMoveNotes?: CoachMoveNote[] | null;
  onGenerateNotes?: () => void | Promise<void>;
  coachBusy?: boolean;
  coachError?: string | null;
  liveEvalCp?: number | null;
  evalPending?: boolean;
  engineSettings: Pick<Settings, 'engineThreads' | 'engineHashMb' | 'liveMultipv' | 'disableGpu'>;
  onSettingsChange: (patch: Partial<Settings>) => void;
};

/* --------------------------------- Tokens ---------------------------------- */

const C = {
  bg: '#0e0e0e',
  panel: '#131313',
  border: '#1e1e1e',
  border2: '#252525',
  text: '#e8e8e8',
  muted: '#666',
  faint: '#333',
  accent: '#5eead4',
  green: '#4ade80',
  blue: '#60a5fa',
  yellow: '#facc15',
  orange: '#fb923c',
  red: '#f87171',
  purple: '#a78bfa',
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '9px 4px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  color: active ? C.text : C.muted,
  borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
  transition: 'color 120ms, border-color 120ms',
  whiteSpace: 'nowrap',
});

const btnStyle = (variant: 'primary' | 'ghost' | 'danger' = 'ghost'): React.CSSProperties => ({
  padding: '7px 13px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 7,
  border: `1px solid ${variant === 'primary' ? '#2a5c4a' : variant === 'danger' ? '#5c2a2a' : C.border2}`,
  background: variant === 'primary' ? '#0f2d22' : variant === 'danger' ? '#2d0f0f' : '#181818',
  color: variant === 'primary' ? '#4ade80' : variant === 'danger' ? '#f87171' : C.text,
  cursor: 'pointer',
  transition: 'background 100ms',
  letterSpacing: '0.02em',
});

function Divider() {
  return <div style={{ height: 1, background: C.border, margin: '12px 0' }} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: C.muted,
      marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{value}</span>
    </div>
  );
}

function QualityBadge({ label, value, color }: { label: string; value?: number; color: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
      padding: '6px 8px',
      background: '#111',
      border: `1px solid ${C.border2}`,
      borderRadius: 8,
      minWidth: 44,
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, color }}>{value ?? '—'}</span>
      <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.04em' }}>{label}</span>
    </div>
  );
}

function ProgressBar({ value }: { value?: number | null }) {
  const pct = typeof value === 'number' && isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  return (
    <div style={{ width: '100%', height: 3, borderRadius: 999, background: C.border2, overflow: 'hidden' }}>
      {pct != null
        ? <div style={{ width: `${pct}%`, height: '100%', background: C.accent, transition: 'width 200ms' }} />
        : <div style={{ width: '45%', height: '100%', background: C.accent, animation: 'slide 1.4s ease-in-out infinite' }} />}
    </div>
  );
}

/* ------------------------------ Tab contents ------------------------------- */

function ReviewTab(props: SidebarProps) {
  const { review, coachSections, coachMomentNotes, coachMoveNotes, coachBusy, coachError, onGenerateNotes, ply } = props;

  return (
    <div style={{ padding: '14px 14px 24px' }}>
      {/* Accuracy cards */}
      <SectionLabel>Accuracy</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {(['white', 'black'] as const).map((side) => {
          const acc = side === 'white' ? review?.whiteAcc : review?.blackAcc;
          const cpl = side === 'white' ? review?.avgCplW : review?.avgCplB;
          const elo = side === 'white' ? review?.estEloWhite : review?.estEloBlack;
          const isWhite = side === 'white';
          return (
            <div key={side} style={{
              background: '#111',
              border: `1px solid ${C.border2}`,
              borderRadius: 10,
              padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: isWhite ? '#f0f0f0' : '#1a1a1a',
                  border: `1px solid ${isWhite ? '#ccc' : '#555'}`,
                }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text, textTransform: 'capitalize' }}>{side}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1 }}>
                {acc != null ? `${Math.round(acc)}%` : '—'}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>accuracy</div>
              <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>
                CPL: <span style={{ color: C.text }}>{cpl != null ? Math.round(cpl) : '—'}</span>
                {elo != null && <span style={{ marginLeft: 8 }}>Est. <span style={{ color: C.text }}>{Math.round(elo)}</span></span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quality tally */}
      {review?.quality && (
        <>
          <SectionLabel>Move Quality</SectionLabel>
          {(['W', 'B'] as const).map((side) => {
            const q = review.quality![side];
            if (!q) return null;
            return (
              <div key={side} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{side === 'W' ? 'White' : 'Black'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <QualityBadge label="Best" value={q.best} color={C.green} />
                  <QualityBadge label="Good" value={q.good} color={C.blue} />
                  <QualityBadge label="Inacc" value={q.inaccuracy ?? q.inacc} color={C.yellow} />
                  <QualityBadge label="Mistake" value={q.mistake} color={C.orange} />
                  <QualityBadge label="Blunder" value={q.blunder} color={C.red} />
                </div>
              </div>
            );
          })}
          <Divider />
        </>
      )}

      {/* Coach notes */}
      <SectionLabel>AI Coach</SectionLabel>
      <CoachPanel
        sections={coachSections ?? undefined}
        busy={!!coachBusy}
        onGenerate={onGenerateNotes}
        error={coachError ?? undefined}
      />
    </div>
  );
}

function PgnTab(props: SidebarProps) {
  const {
    movesUci, moveEvals, openingInfo, whiteAcc, blackAcc, avgCplW, avgCplB,
    onLoadPgnText, onLoadPgnFile, analyzing, progress, onAnalyze, onAnalyzeFast, onStopAnalyze,
    result = '*',
  } = props;

  const pgnRef = useRef<HTMLTextAreaElement>(null);

  async function saveFile(name: string, ext: 'pgn' | 'json', content: string) {
    try {
      if ((window as any).electron?.invoke) {
        await (window as any).electron.invoke('export:save', {
          defaultPath: name,
          filters: ext === 'pgn'
            ? [{ name: 'PGN', extensions: ['pgn'] }]
            : [{ name: 'JSON', extensions: ['json'] }],
          content,
        });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([content], { type: ext === 'pgn' ? 'application/x-chess-pgn' : 'application/json' }));
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
    } catch (e) { console.error('[export]', e); }
  }

  return (
    <div style={{ padding: '14px 14px 24px', display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SectionLabel>Import PGN</SectionLabel>
      <textarea
        ref={pgnRef}
        rows={6}
        placeholder="Paste PGN here and click Load…"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#0a0a0a',
          color: C.text,
          border: `1px solid ${C.border2}`,
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: 12,
          fontFamily: 'ui-monospace, monospace',
          resize: 'vertical',
          outline: 'none',
          marginBottom: 8,
        }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button style={btnStyle('primary')} onClick={() => {
          if (pgnRef.current) onLoadPgnText(pgnRef.current.value);
        }}>
          Load
        </button>
        <label style={{ ...btnStyle(), cursor: 'pointer' }}>
          <input type="file" accept=".pgn,.txt" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoadPgnFile(f); }} />
          Open File
        </label>
      </div>

      <Divider />
      <SectionLabel>Analysis</SectionLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <button style={btnStyle('primary')} onClick={onAnalyze} disabled={analyzing}>Analyze</button>
        {onAnalyzeFast && (
          <button style={btnStyle()} onClick={onAnalyzeFast} disabled={analyzing}>Fast</button>
        )}
        {analyzing && (
          <button style={btnStyle('danger')} onClick={onStopAnalyze}>Stop</button>
        )}
      </div>
      {analyzing && (
        <div style={{ marginBottom: 12 }}>
          <ProgressBar value={progress ?? 0} />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{progress ?? 0}% complete</div>
        </div>
      )}

      <Divider />
      <SectionLabel>Export</SectionLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={btnStyle()} onClick={() => saveFile('game.pgn', 'pgn', pgnFromMoves({ movesUci: movesUci || [], result }))}>
          PGN
        </button>
        <button style={btnStyle()} onClick={() => saveFile('game_annotated.pgn', 'pgn', annotatedPgn({
          movesUci: movesUci || [], moveEvals: moveEvals as any[], headers: openingInfo ? { Opening: openingInfo } : undefined, result,
        }))}>
          Annotated PGN
        </button>
        <button style={btnStyle()} onClick={() => saveFile('game_analysis.json', 'json', analysisJson({
          movesUci: movesUci || [], moveEvals: moveEvals as any[], opening: openingInfo || null,
          whiteAcc: whiteAcc ?? null, blackAcc: blackAcc ?? null, avgCplW: avgCplW ?? null, avgCplB: avgCplB ?? null, result,
        }))}>
          JSON
        </button>
      </div>
    </div>
  );
}

function EngineTab(props: SidebarProps) {
  const {
    openingText, bookUci, onApplyBookMove,
    engineBand, onEngineBandChange,
    liveEvalCp, evalPending,
    engineSettings, onSettingsChange,
  } = props;

  return (
    <div style={{ padding: '14px 14px 24px', display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SectionLabel>Opening</SectionLabel>
      <OpeningPanel
        openingText={openingText}
        bookMoves={bookUci || []}
        onApplyBookMove={onApplyBookMove}
      />

      <Divider />
      <SectionLabel>Engine Strength</SectionLabel>
      <EnginePanel
        evalCp={liveEvalCp ?? null}
        evalPending={!!evalPending}
        band={engineBand}
        onBandChange={onEngineBandChange}
      />

      <Divider />
      <SectionLabel>Settings</SectionLabel>
      <SettingsPanel
        settings={engineSettings}
        onChange={onSettingsChange}
      />
    </div>
  );
}

/* -------------------------------- Root component --------------------------- */

type TabId = 'review' | 'pgn' | 'engine';

export default function SidebarPane(props: SidebarProps) {
  const { sidebarOpen, setSidebarOpen } = props;
  const [activeTab, setActiveTab] = useState<TabId>('review');

  if (!sidebarOpen) {
    return (
      <div style={{
        width: 28,
        height: '100vh',
        background: C.bg,
        borderLeft: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 12,
      }}>
        <button
          onClick={() => setSidebarOpen(true)}
          title="Open sidebar"
          style={{
            background: 'none',
            border: 'none',
            color: C.muted,
            cursor: 'pointer',
            fontSize: 16,
            padding: 4,
            lineHeight: 1,
          }}
        >
          ‹
        </button>
      </div>
    );
  }

  return (
    <aside style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: C.bg,
      borderLeft: `1px solid ${C.border}`,
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: `1px solid ${C.border}`,
        padding: '0 4px',
        flexShrink: 0,
      }}>
        {([
          { id: 'review', label: 'Review' },
          { id: 'pgn',    label: 'PGN' },
          { id: 'engine', label: 'Engine' },
        ] as { id: TabId; label: string }[]).map(({ id, label }) => (
          <button key={id} style={tabStyle(activeTab === id)} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
        <button
          onClick={() => setSidebarOpen(false)}
          title="Close sidebar"
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: C.muted,
            cursor: 'pointer',
            fontSize: 16,
            padding: '0 8px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ›
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {activeTab === 'review' && <ReviewTab {...props} />}
        {activeTab === 'pgn'    && <PgnTab    {...props} />}
        {activeTab === 'engine' && <EngineTab {...props} />}
      </div>
    </aside>
  );
}
