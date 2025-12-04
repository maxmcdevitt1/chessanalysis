// webui/src/App.tsx
import { cpLossForMoveSideAware, tallyMoveQuality } from './ScoreHelpers';
import { detectOpeningByTrie } from './utils/openingTrie';
// Fallback to your existing FEN-book helpers if trie JSON is missing:
import {
  bookMaskFromMoves as fallbackBookMaskFromMoves,
  bookDepthFromMask as fallbackBookDepthFromMask,
  openingLabelAtMask as fallbackOpeningLabelAtMask,
} from './utils/openingBook';
import { useCallback, useEffect, useMemo as useM, useRef, useState } from 'react';
import { generateCoachNotes } from './CommentaryServiceOllama';
import { analyzeFen, moveWeak, getCapabilities, setStrength, reviewFast } from './bridge';
import { Chess } from './chess-compat';
import type { Square } from './chess-compat';
import type { CoachNote } from './useCoach';

import { nextBookMoves } from './openings/matcher';
import BoardPane from './BoardPane';
import SidebarPane from './SidebarPane';
import { getNumber, setNumber } from './persist';
import KeyboardNav from './KeyboardNav';

// sanity: ensure shim is providing a constructor (remove later if noisy)
// @ts-ignore
console.log('[chess-compat] typeof Chess =', typeof Chess, 'has loadPgn?', !!(Chess?.prototype?.loadPgn));

export type MoveEval = {
  index: number;
  moveNo: number;
  side: 'White' | 'Black';
  san: string;
  uci: string;
  best?: string | null;
  cpBefore?: number | null; // white POV
  cpAfter?: number | null;  // white POV
  cpAfterWhite?: number | null;
  bestCpBefore?: number | null; // mover POV
  mateAfter?: number | null;
  cpl?: number | null;
  tag?: 'Genius' | 'Best' | 'Good' | 'Mistake' | 'Blunder' | 'Book';
  symbol?: '!!' | '!' | '!? ' | '?' | '??' | '';
  isBook?: boolean;
  fenBefore: string;
  fenAfter: string;
};

export type BadgeTag = MoveEval['tag'] | 'Book';

const ENGINE_STRENGTH_KEY = 'engineStrength';
const SHOW_EVAL_GRAPH_KEY = 'showEvalGraph';

/* ------------------------------- helpers --------------------------------- */

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    const clear = () => { try { clearTimeout(timer); } catch {} };
    p.then(v => { clear(); resolve(v); }, e => { clear(); reject(e); });
  });
}

function uciToMove(uci: string) {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = (uci[4] as any) || undefined;
  return { from, to, promotion };
}

function safeMove(g: any, uci: string): any {
  try {
    const obj = uciToMove(uci) as any;
    return (Chess as any).prototype.move.call(g, obj);
  } catch {
    return null;
  }
}

// auto-queen helper
function withAutoQueen(uci: string, game: Chess): string {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const p = game.get(from);
  if (!p || p.type !== 'p') return uci;
  if ((p.color === 'w' && to[1] === '8') || (p.color === 'b' && to[1] === '1')) {
    if (uci.length === 4) return uci + 'q';
  }
  return uci;
}

function mateToCp(mateVal: number | null | undefined): number | null {
  if (mateVal == null || !isFinite(mateVal)) return null;
  const sign = mateVal >= 0 ? 1 : -1;
  return sign * (10000 - Math.min(99, Math.abs(mateVal)) * 100);
}

// last CP or mate-converted CP from infos (supports {cp} or {mate})
function lastScoreCp(infos?: any[]): number | null {
  if (!infos?.length) return null;
  for (let i = infos.length - 1; i >= 0; i--) {
    const it = infos[i];
    if (typeof it?.cp === 'number') return it.cp;
    if (typeof it?.mate === 'number') {
      const v = mateToCp(it.mate);
      if (v != null) return v;
    }
    if (it?.type === 'cp' && Number.isFinite(Number(it.score))) {
      return Number(it.score);
    }
    if (it?.type === 'mate' && typeof it.score === 'number') {
      const v = mateToCp(it.score);
      if (v != null) return v;
    }
  }
  return null;
}

/* ----- Strength/Elo mapping (consistent across eval + replies) ----- */

// Map UI strength 1..20 → display Elo 400..2500
function uiEloFromStrength(n: number) {
  const s = Math.max(1, Math.min(20, n));
  return Math.round(400 + (s - 1) * ((2500 - 400) / 19));
}

// Reply movetime: fast and shallow at low Elo, modest at high Elo.
// Piecewise-linear table for clarity.
function eloToMovetimeMs(elo: number) {
  const pts = [
    [400, 120],
    [800, 220],
    [1200, 360],
    [1600, 520],
    [2000, 720],
    [2300, 900],
    [2500, 1100],
  ];
  const e = Math.max(pts[0][0], Math.min(pts[pts.length - 1][0], Math.floor(elo || 400)));
  for (let i = 0; i < pts.length - 1; i++) {
    const [e0, t0] = pts[i];
    const [e1, t1] = pts[i + 1];
    if (e >= e0 && e <= e1) {
      const k = (e - e0) / (e1 - e0);
      return Math.round(t0 + k * (t1 - t0));
    }
  }
  return pts[pts.length - 1][1];
}

// Live-eval movetime: ~30% of reply time, clamped to 120..600ms
function eloToEvalMovetimeMs(elo: number) {
  const base = Math.round(eloToMovetimeMs(elo) * 0.30);
  return Math.max(120, Math.min(600, base));
}

// Estimate tactical/decision complexity of the current position.
// Simple, fast heuristic (no extra engine calls):
//  - nMoves: total legal moves (branching factor)
//  - nCaps:  number of capturing moves
//  - nChecks:number of checking moves
function positionComplexity(fen: string): { nMoves: number; nCaps: number; nChecks: number } {
  try {
    const ch = new Chess(fen);
    const moves = ch.moves({ verbose: true }) as any[];
    const nMoves = moves.length;
    let nCaps = 0, nChecks = 0;
    for (const m of moves) {
      if (m.flags && String(m.flags).includes('c')) nCaps++;
      if (typeof m.san === 'string' && m.san.includes('+')) nChecks++;
    }
    return { nMoves, nCaps, nChecks };
  } catch {
    return { nMoves: 0, nCaps: 0, nChecks: 0 };
  }
}

// Blunder probability depends on Elo *and* complexity.
// We scale the base rate by a multiplier derived from branching factor and tactics.
function blunderProbability(uiElo: number, cx: { nMoves: number; nCaps: number; nChecks: number }) {
  let base =
    uiElo <= 500  ? 0.12 :
    uiElo <= 800  ? 0.10 :
    uiElo <= 1200 ? 0.05 :
    uiElo <= 1400 ? 0.035 : 0.015;

  const eloScale =
    uiElo < 900  ? 1.0 :
    uiElo < 1100 ? 0.8 :
    uiElo < 1400 ? 0.5 :
    uiElo < 1700 ? 0.35 : 0.25;
  const bigBranch   = cx.nMoves >= 35 ? 0.50 : cx.nMoves >= 28 ? 0.30 : cx.nMoves >= 22 ? 0.15 : 0.0;
  const manyCaps    = cx.nCaps  >= 8  ? 0.30 : cx.nCaps  >= 5  ? 0.20 : cx.nCaps  >= 3  ? 0.10 : 0.0;
  const manyChecks  = cx.nChecks>= 3  ? 0.20 : cx.nChecks>= 2  ? 0.12 : cx.nChecks>= 1  ? 0.06 : 0.0;
  const mult = 1 + eloScale * (bigBranch + manyCaps + manyChecks);

  const p = Math.max(0, Math.min(0.9, base * mult));
  return p;
}

// Robust mover and POV helpers
function moverSideOf(m: any): 'W'|'B' {
  const s = String(m?.side ?? m?.color ?? '').toUpperCase();
  if (s.startsWith('W')) return 'W';
  if (s.startsWith('B')) return 'B';
  if (Number.isFinite(m?.ply)) return (m.ply % 2 === 1) ? 'W' : 'B'; // ply=1 -> White
  return 'W';
}
function afterToMoverPOV(m: any): number | null {
  // Prefer cpAfterWhite (always White POV after the move); convert to mover POV.
  if (typeof m?.cpAfterWhite === 'number') {
    const whitePov = m.cpAfterWhite;
    return moverSideOf(m) === 'W' ? whitePov : -whitePov;
  }
  const cp = typeof m?.cpAfter === 'number' ? m.cpAfter : null; // opponent POV (side to move)
  return cp == null ? null : -cp; // flip to mover POV
}

/* ----------------------------- metrics helpers --------------------------- */
// Conservative accuracy model similar to common ACPL→accuracy approximations.
function accFromAcplConservative(acpl: number | null): number | null {
  if (acpl == null || !isFinite(acpl)) return null;
  const x = Math.max(0, acpl);
  // Moderately punitive: small ACPL trims a few points, larger ACPL drops faster.
  const raw = 100 - 4.5 * Math.sqrt(x);
  return Math.max(0, Math.min(99, Math.round(raw)));
}

type Buckets = { inacc: number; mistakes: number; blunders: number };
function estimateEloConservative(acpl: number | null, buckets: Buckets): number | null {
  if (acpl == null || !isFinite(acpl)) return null;
  const { inacc, mistakes, blunders } = buckets;
  // Use the same steep ACPL→accuracy curve to anchor Elo, then penalize mistakes hard.
  const acc = accFromAcplConservative(acpl) ?? 0; // 0..99
  const accScale = Math.max(0, Math.min(1, acc / 100));
  // Base Elo from accuracy (curved so it drops fast): 400..2600
  let base = 400 + Math.pow(accScale, 2) * 2200;
  // Extra penalty for raw ACPL and bucketed mistakes/blunders
  base -= (acpl * 8) + (inacc * 25) + (mistakes * 70) + (blunders * 140);
  return Math.max(400, Math.min(2400, Math.round(base)));
}

// Bucket losses (centipawns) into rough severity levels independent of tags.
function bucketFromLossCp(lossCp: number): 'ok'|'inacc'|'mistake'|'blunder' {
  if (lossCp <= 15) return 'ok';        // ≤0.50 pawns
  if (lossCp <= 500) return 'inacc';    // 0.51–1.50
  if (lossCp <= 100) return 'mistake';  // 1.51–3.00
  return 'blunder';                      // >3.00
}

function pickRandomLegalUci(fen: string): string | null {
  try {
    const g = new Chess(fen);
    const legals = g.moves({ verbose: true }) as any[];
    if (!legals.length) return null;
    const rnd = legals[Math.floor(Math.random() * legals.length)];
    return `${rnd.from}${rnd.to}${rnd.promotion || ''}`;
  } catch { return null; }
}

function pickNotBestLegalUci(fen: string, best: string | undefined): string | null {
  try {
    const g = new Chess(fen);
    const legals = g.moves({ verbose: true }) as any[];
    const pool = legals
      .map(m => `${m.from}${m.to}${m.promotion || ''}`)
      .filter(u => u.slice(0,4).toLowerCase() !== (best || '').slice(0,4).toLowerCase());
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  } catch { return null; }
}

// For low Elo, occasionally skip the book/best move in the first dozen plies.
// Probability is lower for 1000–1200 Elo and ramps up only after a few plies
// so weaker bots still play some basic opening moves.
function earlyGameDeviationProb(elo: number, plyCount: number): number {
  if (elo >= 1200) return 0;
  // Base probability by Elo (weaker -> higher)
  let base: number;
  if (elo <= 900) base = 0.15;
  else if (elo >= 1150) base = 0.03;
  else {
    const t = (elo - 900) / 250; // 0..1 between 900-1150
    base = 0.15 - t * (0.15 - 0.03); // 0.15 -> 0.03
  }
  // Delay deviation until later plies; ramp from ply 8 to 14.
  const ramp = Math.max(0, Math.min(1, (plyCount - 8) / 6)); // 0 at ply<=8, 1 at ply>=14
  return base * ramp;
}

function humanStyleForElo(elo: number) {
  if (elo > 1500) return null;
  const t = Math.max(0, Math.min(1, (1500 - elo) / 800)); // 0 at 1500, 1 at 700
  return {
    temperature: 0.65 + 0.15 * t,              // 0.65–0.80
    maxPickDeltaCp: elo <= 1200 ? 100 : 80,    // allow more near-equal picks at low Elo
    blunderRate: 0.015 + 0.06 * t,             // ~0.075 at 700, ~0.04 at 1200, ~0.015 at 1500
    blunderMaxCp: 220,
  };
}

/* ------------------------------ engine gate ------------------------------ */

const ENGINE_READY: Promise<void> = (async () => {
  try {
    await getCapabilities();
    const savedElo = Number(localStorage.getItem('engineElo') || '2000');
    if (Number.isFinite(savedElo)) await setStrength(savedElo);
  } catch {}
})();

async function analyzeFenSafe(fen: string, opts: any) {
  await ENGINE_READY;
  return analyzeFen(fen, opts);
}
async function moveWeakSafe(fen: string, opts: any) {
  await ENGINE_READY;
  return moveWeak(fen, opts);
}

/* ---------------------------- book move helpers -------------------------- */

function sanListToUciFromPosition(
  sans: string[],
  startPly: number,
  movesUci: string[]
): string[] {
  const g = new Chess();
  for (let k = 0; k < startPly && k < movesUci.length; k++) {
    const u = movesUci[k];
    g.move({
      from: u.slice(0, 2) as any,
      to: u.slice(2, 4) as any,
      promotion: (u.length > 4 ? u.slice(4) : undefined) as any,
    });
  }
  const out: string[] = [];
  for (const san of sans) {
    const legals = g.moves({ verbose: true }) as any[];
    const mv = legals.find((m) => m.san === san);
    if (!mv) break;
    out.push(`${mv.from}${mv.to}${mv.promotion || ''}`);
    g.move(mv);
  }
  return out;
}

function normalizeBookToUci(
  bookMoves: string[] | undefined | null,
  startPly: number,
  movesUci: string[]
): string[] {
  if (!bookMoves || !bookMoves.length) return [];
  const looksUci = /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(bookMoves[0]);
  return looksUci
    ? (bookMoves as string[])
    : sanListToUciFromPosition(bookMoves as string[], startPly, movesUci);
}

function sameBaseMove(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 4).toLowerCase() === b.slice(0, 4).toLowerCase();
}

function severityTag(cpl: number | null): MoveEval['tag'] {
  if (cpl == null) return 'Good';
  if (cpl <= 25) return 'Good';
  if (cpl <= 80) return 'Mistake';
  return 'Blunder';
}

function symbolFor(tag: MoveEval['tag']): MoveEval['symbol'] {
  switch (tag) {
    case 'Genius': return '!!';
    case 'Best': return '!';
    case 'Good': return '';
    case 'Mistake': return '?';
    case 'Blunder': return '??';
    case 'Book':
    default: return '';
  }
}

/* -------------------------------- component ------------------------------ */

export default function App() {
  const gameRef = useRef(new Chess());

  const [fen, setFen] = useState(gameRef.current.fen());
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [movesUci, setMovesUci] = useState<string[]>([]);
  const [ply, setPly] = useState(0);
  const [moveEvals, setMoveEvals] = useState<MoveEval[]>([]);
  const [coachNotes, setCoachNotes] = useState<CoachNote[] | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [openingInfo, setOpeningInfo] = useState<{ eco:string; name:string; variation?:string } | string | null>(null);
  // --- analysis/book UI state ---
  const [bookDepth, setBookDepth] = useState(0);
  const [bookMask, setBookMask] = useState<boolean[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // engine + auto-reply state
  const [engineBusy, setEngineBusy] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const userMovedRef = useRef(false);
  const replyScheduled = useRef(false);
  const replyInflight = useRef(false);

  // user-configurable options
  const [engineStrength, setEngineStrength] = useState(() =>
    getNumber(ENGINE_STRENGTH_KEY, 12)
  );
  const [showEvalGraph, setShowEvalGraph] = useState(() => {
    const v = getNumber(SHOW_EVAL_GRAPH_KEY, 1);
    return v !== 0;
  });

  // eval state + suspension
  const [evalCp, setEvalCp] = useState<number | null>(null);
  const [evalPending, setEvalPending] = useState(false);
  const [suspendEval, setSuspendEval] = useState(false);
  const evalReqId = useRef(0);
  const openingComputedRef = useRef<string | null>(null);

  /* Persist the strength number (1..20) */
  useEffect(() => {
    setNumber(ENGINE_STRENGTH_KEY, engineStrength);
  }, [engineStrength]);

  /* Debounced push of the UI Elo knob (engine runs full strength; Elo only scales time) */
  useEffect(() => {
    const elo = uiEloFromStrength(engineStrength);
    localStorage.setItem('engineElo', String(elo));
    let stopped = false;
    const t = setTimeout(async () => {
      try { if (!stopped) await setStrength(elo); } catch {}
    }, 250);
    return () => { stopped = true; clearTimeout(t); };
  }, [engineStrength]);

  useEffect(() => { setNumber(SHOW_EVAL_GRAPH_KEY, showEvalGraph ? 1 : 0); }, [showEvalGraph]);

  const currentMoveEval = useM(
    () => (ply > 0 ? moveEvals[ply - 1] ?? null : null),
    [moveEvals, ply]
  );

  // ---------- OPENING: run ONLY AFTER ANALYSIS ----------
  // We wait for moveEvals (engine results) before labeling/marking the opening.
  // This prevents early, shallow labels and lets us optionally extend the prefix.
  useEffect(() => {
    if (!moveEvals || moveEvals.length === 0) return; // not analyzed yet
    // Avoid looping: only recompute when moveEvals content changes (length + last index)
    const key = `${moveEvals.length}:${moveEvals[moveEvals.length - 1]?.index ?? 'x'}`;
    if (openingComputedRef.current === key) return;
    openingComputedRef.current = key;
    let cancelled = false;

    // Small-Δcp extender: continues opening while theory-like (quiet) moves persist.
    function extendOpeningPrefix(
      moves: any[],
      baseDepth: number,
      opts: { tolCp?: number; maxPlies?: number } = {}
    ) {
      const tol = opts.tolCp ?? 35;     // ≤0.35 pawns = “book-like”
      const cap = opts.maxPlies ?? 24;  // up to 12 full moves
      const N = Math.min(moves.length, cap);
      let d = Math.min(baseDepth | 0, N);
      for (let i = d; i < N; i++) {
        const m = moves[i];
        if (!m) break;
        const before = typeof m?.cpBefore === 'number' ? m.cpBefore : null; // mover POV
        const after  = ((): number | null => {
          if (typeof m?.cpAfterWhite === 'number') return m.cpAfterWhite;   // White POV after move
          const cp = typeof m?.cpAfter === 'number' ? m.cpAfter : null;     // side-to-move POV
          const side = String(m?.side ?? m?.color ?? '').toUpperCase().startsWith('W') ? 'W'
                      : Number.isFinite(m?.ply) ? (m.ply % 2 === 1 ? 'W' : 'B')
                      : 'W';
          return cp == null ? null : (side === 'W' ? -cp : cp);             // convert to White POV
        })();
        if (before == null || after == null) break;
        const delta = Math.abs(after - before);
        if (delta <= tol) d = i + 1; else break;
      }
      return { depth: d, mask: Array.from({ length: moves.length }, (_, i) => i < d) };
    }

    (async () => {
      try {
        // 1) Try SAN-trie detection (label + base depth)
        const res = await detectOpeningByTrie(movesUci || []);
        if (!cancelled && res) {
          // 2) Extend prefix with engine deltas (post-analysis only)
          const extended = extendOpeningPrefix(moveEvals, res.depth, { tolCp: 35, maxPlies: 24 });
          setOpeningInfo(`${res.eco} ${res.name}`);
          setBookDepth(extended.depth);
          setBookMask(extended.mask);
          return;
        }
      } catch {}
      // 3) Fallback to legacy FEN-book (also post-analysis)
      try {
        const mask0 = await fallbackBookMaskFromMoves(movesUci || []);
        if (cancelled) return;
        const depth0 = fallbackBookDepthFromMask(mask0);
        const extended = extendOpeningPrefix(moveEvals, depth0, { tolCp: 35, maxPlies: 24 });
        setBookDepth(extended.depth);
        setBookMask(extended.mask);
        const label = await fallbackOpeningLabelAtMask(movesUci || [], mask0);
        setOpeningInfo(label);
      } catch {
        if (!cancelled) {
          setOpeningInfo(null);
          setBookMask([]);
          setBookDepth(0);
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveEvals, analyzing]); // <-- ONLY after analysis

  const openingText = openingInfo
    ? (typeof openingInfo === 'string'
        ? openingInfo
        : `${openingInfo.name}${openingInfo.variation ? ' — ' + openingInfo.variation : ''} (${openingInfo.eco})`)
    : '';
  const bookUci = useM(
    () => nextBookMoves(movesUci.slice(0, ply)) || [],
    [movesUci, ply, openingInfo]
  );

  const coachMoments = useM(() => {
    return movesUci.map((uci, i) => {
      const m: any = moveEvals[i] ?? {};
      return {
        index: i,
        moveNo: Math.floor(i / 2) + 1,
        side: (m.side === 'White' || (i % 2 === 0)) ? 'W' : 'B',
        san: m.san || m.playedSan || '',
        best: m.engineBestSan || m.bestSan || m.engineBest || '',
        tag: m.tag || '',
        cpBefore: typeof m.cpBestBefore === 'number'
          ? m.cpBestBefore
          : (typeof m.bestCpBefore === 'number' ? m.bestCpBefore : null),
        cpAfter: typeof m.cpAfter === 'number' ? m.cpAfter : null,
      };
    });
  }, [movesUci, moveEvals]);

  const jumpToPly = useCallback((idx: number) => {
    setPly((p) => Math.max(0, Math.min(movesUci.length, idx + 1)));
  }, [movesUci.length]);

  /* live eval (current board) — uses Elo-scaled time */
  useEffect(() => {
    if (suspendEval) return;
    const id = ++evalReqId.current;
    setEvalPending(true);
    (async () => {
      try {
        const elo = uiEloFromStrength(engineStrength);
        const evalMs = eloToEvalMovetimeMs(elo);
        const res = await withTimeout(
          analyzeFenSafe(gameRef.current.fen(), { movetimeMs: evalMs, multiPv: 2 }),
          evalMs + 1500
        );
        const cp = lastScoreCp(res?.infos);
        if (evalReqId.current === id) {
          const turn = gameRef.current.turn();
          setEvalCp(cp == null ? null : (turn === 'w' ? cp : -cp));
        }
      } catch {
        if (evalReqId.current === id) setEvalCp(null);
      } finally {
        if (evalReqId.current === id) setEvalPending(false);
      }
    })();
  }, [ply, fen, suspendEval, engineStrength]);

  /* rebuild game to ply N */
  function rebuildTo(n: number) {
    const g = new Chess();
    for (let i = 0; i < n; i++) safeMove(g, movesUci[i]);
    gameRef.current = g;
    setPly(n);
    setFen(g.fen());
  }

  /* central move application */
  function applyUci(raw: string): boolean {
    const g = gameRef.current;
    const uci = withAutoQueen(raw, g);
    const mv = safeMove(g, uci);
    if (!mv) return false;
    const next = movesUci.slice(0, ply).concat([uci]);
    setMovesUci(next);
    // Drop any stale analyses beyond the branch point so badges/arrows don't leak.
    setMoveEvals((prev) => prev.slice(0, Math.max(0, next.length - 1)));
    setPly(next.length);
    setFen(g.fen());
    return true;
  }

  /* reply scheduler using RAF */
  function scheduleReply() {
    if (!autoReply || replyScheduled.current || engineBusy) return;
    replyScheduled.current = true;
    requestAnimationFrame(() => {
      replyScheduled.current = false;
      setPly(p => p); // nudge React (effect below will run)
    });
  }

  /* ---------- analysis ---------- */

  async function analyzePgn() {
    if (movesUci.length === 0) {
      alert('Load or paste a PGN first');
      return;
    }

    setSuspendEval(true);
    const results: MoveEval[] = [];
    const g = new Chess();
    setProgress(0);
    setMoveEvals([]);
    setAnalyzing(true);

    try {
      for (let i = 0; i < movesUci.length; i++) {
        const fenBefore = g.fen();

        // BEFORE
        let before: any = null;
        try {
          before = await withTimeout(
            analyzeFenSafe(fenBefore, { movetimeMs: 1000, multiPv: 3 }),
            3000
          );
        } catch { before = null; }

        const bestCp = lastScoreCp(before?.infos);
        const bestMoveUci = (before?.bestMove || null) as string | null;

        // apply played move
        const playedUci = movesUci[i];
        const mv = safeMove(g, playedUci);
        const san = mv?.san || '(?)';
        const fenAfter = g.fen();
        const deliveredMate = g.isCheckmate();

        // AFTER
        let after: any = null;
        try {
          after = await withTimeout(
            analyzeFenSafe(fenAfter, { movetimeMs: 700, multiPv: 2 }),
            3000
          );
        } catch { after = null; }

        const afterCpRaw = lastScoreCp(after?.infos);

        const mover = i % 2 === 0 ? 'w' : 'b';
        const bestForMover = bestCp == null ? null : bestCp;
        const afterForMover = afterCpRaw == null ? null : -afterCpRaw;

        const cpBeforeWhite =
          bestForMover == null ? null : (mover === 'w' ? bestForMover : -bestForMover);

        // Store cpAfter as opponent-POV (raw engine output after the move)
        let cpAfterStored = afterCpRaw;

        let cpAfterWhite =
          afterForMover == null ? null : (mover === 'w' ? afterForMover : -afterForMover);

        let cpl: number | null = null;
        if (deliveredMate) {
          // Checkmate delivered: zero loss and maximal eval swing
          cpl = 0;
          cpAfterStored = mover === 'w' ? -9900 : 9900; // opponent POV after move
          cpAfterWhite = mover === 'w' ? 9900 : -9900;
        } else if (bestForMover != null && afterForMover != null) {
          cpl = bestForMover - afterForMover;
          if (cpl < 0) cpl = 0;
        }

        const seqBefore = movesUci.slice(0, i);
        const candidatesUci = normalizeBookToUci(nextBookMoves(seqBefore), i, movesUci);
        let isBookMove = Array.isArray(candidatesUci) && candidatesUci.includes(playedUci);
        const playedIsBest = sameBaseMove(playedUci, bestMoveUci);
        // If the move dumps significant CPL, don't treat it as book even if it appears in the tree.
        if (isBookMove && cpl != null && cpl >= 50) isBookMove = false;

        let tag: MoveEval['tag'];
        if (deliveredMate) tag = 'Best';
        else if (isBookMove) tag = 'Book';
        else if (playedIsBest && cpl === 0 && bestForMover != null) tag = 'Best';
        else tag = severityTag(cpl);

        const symbol = symbolFor(tag);

        results.push({
          index: i,
          moveNo: Math.floor(i / 2) + 1,
          side: mover === 'w' ? 'White' : 'Black',
          san,
          uci: playedUci,
          best: bestMoveUci,
          cpBefore: cpBeforeWhite,
          cpAfter: cpAfterStored,
          // optional convenience for charts expecting White POV:
          cpAfterWhite: cpAfterWhite,
          bestCpBefore: bestForMover,
          cpl,
          tag,
          symbol,
          fenBefore,
          fenAfter,
        });

        setProgress(Math.round(((i + 1) / movesUci.length) * 100));
        if (i % 5 === 0) {
          setMoveEvals([...results]);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      setMoveEvals(results);
    } finally {
      setAnalyzing(false);
      setSuspendEval(false);
      setProgress(null);
    }
  }

  function stopAnalyze() {
    setAnalyzing(false);
    setSuspendEval(false);
    setProgress(null);
  }

  // FAST batch review: fills bestCpBefore (mover POV) + cpAfter (opponent POV)
  async function analyzePgnFast() {
    if (movesUci.length === 0) {
      alert('Load or paste a PGN first');
      return;
    }

    setSuspendEval(true);
    setAnalyzing(true);
    setProgress(0);
    setMoveEvals([]);

    try {
      const seq: Array<{
        fenBefore: string;
        fenAfter: string;
        uci: string;
        san: string;
        side: 'White' | 'Black';
        isMate: boolean;
      }> = [];
      const g = new Chess();
      for (let i = 0; i < movesUci.length; i++) {
        const fenBefore = g.fen();
        const mv = safeMove(g, movesUci[i]);
        if (!mv) break;
        const fenAfter = g.fen();
        seq.push({
          fenBefore,
          fenAfter,
          uci: movesUci[i],
          san: mv.san || '(?)',
          side: i % 2 === 0 ? 'White' : 'Black',
          isMate: g.isCheckmate(),
        });
      }
      if (!seq.length) return;

      const fens = seq.map((s) => s.fenBefore);
      const elo = uiEloFromStrength(engineStrength);
      const timeoutMs = Math.max(8000, fens.length * 2000);
      const resArr = await withTimeout(reviewFast(fens, { elo }), timeoutMs);
      const results = Array.isArray(resArr) ? resArr : [];

      const scoreToNum = (sc: any): number | null => {
        if (!sc) return null;
        if (sc.type === 'cp' && Number.isFinite(sc.value)) return sc.value as number;
        if (sc.type === 'mate' && Number.isFinite(sc.value)) return sc.value >= 0 ? 9900 : -9900;
        return null;
      };

      const out: MoveEval[] = [];
      for (let i = 0; i < seq.length; i++) {
        const info = seq[i];
        const cur = results[i];
        const next = results[i + 1];
        const bestMoveUci = cur?.bestMove || null;

        const bestForMover = scoreToNum(cur?.score);   // POV mover
        const afterOpponent = scoreToNum(next?.score); // POV opponent (side-to-move after move)

        const cpBeforeWhite = bestForMover == null ? null : (info.side === 'White' ? bestForMover : -bestForMover);
        // Store cpAfter as returned (opponent POV); keep white-POV version for display if needed
        const cpAfterStored = afterOpponent;
        // Convert opponent-POV score after the move to White POV for charts/accuracy.
        const cpAfterWhite = afterOpponent == null
          ? null
          : (info.side === 'White' ? -afterOpponent : afterOpponent);

        let cpl: number | null = null;
        if (info.isMate) {
          cpl = 0;
        } else if (bestForMover != null && afterOpponent != null) {
          const afterMover = -afterOpponent; // flip opponent POV to mover POV
          cpl = Math.max(0, bestForMover - afterMover);
        }

        const seqBefore = movesUci.slice(0, i);
        const candidatesUci = normalizeBookToUci(nextBookMoves(seqBefore), i, movesUci);
        let isBookMove = Array.isArray(candidatesUci) && candidatesUci.includes(info.uci);
        const playedIsBest = sameBaseMove(info.uci, bestMoveUci);
        // Do not mark as book if CPL is large even when tree contains it.
        if (isBookMove && cpl != null && cpl >= 50) isBookMove = false;

        let tag: MoveEval['tag'];
        if (info.isMate) tag = 'Best';
        else if (isBookMove) tag = 'Book';
        else if (playedIsBest && cpl === 0 && bestForMover != null) tag = 'Best';
        else tag = severityTag(cpl);

        const symbol = symbolFor(tag);

        out.push({
          index: i,
          moveNo: Math.floor(i / 2) + 1,
          side: info.side,
          san: info.san,
          uci: info.uci,
          best: bestMoveUci,
          cpBefore: cpBeforeWhite,
          cpAfter: cpAfterStored,
          // optional white-POV value for display components
          cpAfterWhite,
          afterScore: afterOpponent == null ? null : (next?.score ? { type: next.score.type, value: next.score.value } : null),
          bestCpBefore: bestForMover,
          mateAfter: (next?.score?.type === 'mate') ? next.score.value : null,
          cpl,
          tag,
          symbol,
          fenBefore: info.fenBefore,
          fenAfter: info.fenAfter,
        });

        if (i % 5 === 0) {
          setProgress(Math.round(((i + 1) / seq.length) * 100));
          setMoveEvals([...out]);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      setProgress(100);
      setMoveEvals(out);
    } catch (e) {
      console.error('[analyzePgnFast] error', e);
    } finally {
      setAnalyzing(false);
      setSuspendEval(false);
      setProgress(null);
    }
  }

  /* ------------------------ engine / auto reply --------------------------- */

  async function engineMove() {
    if (engineBusy || replyInflight.current) return;
    replyInflight.current = true;
    setEngineBusy(true);
    try {
      const g = gameRef.current;
      const fenNow = g.fen();
      const elo = uiEloFromStrength(engineStrength);
      const movetimeMs = eloToMovetimeMs(elo);
      const humanStyle = humanStyleForElo(elo);

      const res = await withTimeout(
        moveWeakSafe(fenNow, {
          movetimeMs,
          multiPv: 4,
          humanMode: !!humanStyle,
          human: humanStyle || undefined,
        }),
        Math.max(8000, movetimeMs + 5000)
      );

      let uci = (res?.bestMove as string | undefined) || '';

      // Break book-perfect openings for weaker Elo in the first 12 plies.
      const earlyDeviation =
        (movesUci.length < 12) &&
        (Math.random() < earlyGameDeviationProb(elo, movesUci.length));
      if (earlyDeviation) {
        const alt = pickNotBestLegalUci(fenNow, uci) || pickRandomLegalUci(fenNow);
        if (alt) uci = alt;
      }

      // Low-Elo randomness/blunder (disabled for Elo ≥ 1800 and during analysis/book hits)
      const cx = positionComplexity(fenNow);
      const p = blunderProbability(elo, cx);
      const allowMistakes = (elo < 1400) && movesUci.length >= 8 && !analyzing && !res?.book && !res?.fromBook;
      if (allowMistakes && p > 0 && Math.random() < p) {
        const coin = Math.random();
        const alt = coin < 0.5
          ? pickRandomLegalUci(fenNow)
          : pickNotBestLegalUci(fenNow, uci);
        if (alt) uci = alt;
      }

      if (!uci) return;
      applyUci(uci);
    } catch (e) {
      console.error('[engineMove] error', e);
    } finally {
      setEngineBusy(false);
      replyInflight.current = false;
    }
  }

  // Effect-driven auto-reply
  useEffect(() => {
    if (!autoReply) return;
    if (!userMovedRef.current) return;
    if (engineBusy) return;
    userMovedRef.current = false;
    setSuspendEval(true);
    (async () => {
      try { await engineMove(); }
      finally { setSuspendEval(false); }
    })();
  }, [ply, autoReply, engineBusy]);

  /* --------------------- handlers passed to children ---------------------- */

  function handleUserDrop(from: string, to: string): boolean {
    const ok = applyUci(`${from}${to}`);
    if (ok) {
      userMovedRef.current = true;
      scheduleReply();
    }
    return ok;
  }

  function handleUserClickMove(uci: string): boolean {
    const ok = applyUci(uci);
    if (ok) {
      userMovedRef.current = true;
      scheduleReply();
    }
    return ok;
  }

  function handleLoadPgnText(text: string) {
    if (!text.trim()) return;
    try {
      const g = new Chess();
      g.loadPgn(text, { sloppy: true });
      const v = g.history({ verbose: true }) as any[];
      gameRef.current = g;
      const u = v.map((m) => `${m.from}${m.to}${m.promotion || ''}`);
      setMovesUci(u);
      setPly(u.length);
      setFen(g.fen());
      setMoveEvals([]);
      setOpeningAt([]);
    } catch {}
  }

  async function handleLoadPgnFile(file: File) {
    const text = await file.text();
    handleLoadPgnText(text);
  }

  function handleApplyBookMove(uci: string) {
    applyUci(uci);
  }

  /* ------------------ review (accuracy / avg CPL) ------------------------ */

  const evalSeries = useM(() => moveEvals.map((m) => m?.cpAfter ?? null), [moveEvals]);

  const review = useM(() => {
    if (!moveEvals.length) return null;
    // Build side-aware half-moves from analysis outputs.
    const halfMoves: Array<{ side: 'W'|'B'; best: any; after: any; loss: number }> = [];
    // Track buckets for conservative Elo estimate.
    let bW: Buckets = { inacc: 0, mistakes: 0, blunders: 0 };
    let bB: Buckets = { inacc: 0, mistakes: 0, blunders: 0 };
    for (const m of moveEvals) {
      if (m?.tag === 'Book' || (m as any)?.isBook) continue; // exclude book moves from ACPL
      const side: 'W' | 'B' = moverSideOf(m);

      const beforeCpMover = (() => {
        if (typeof (m as any).cpBefore === 'number') {
          // cpBefore is White POV; flip for Black to get mover POV
          return side === 'W' ? (m as any).cpBefore : -(m as any).cpBefore;
        }
        return undefined;
      })();
      const bestBeforeCp =
        (typeof (m as any).bestCpBefore === 'number') ? (m as any).bestCpBefore :
        (typeof (m as any).cpBestBefore  === 'number') ? (m as any).cpBestBefore  : undefined;

      // Prefer opponent-POV score after the move; cpLoss helper converts to mover POV.
      const afterCpOpponent = (() => {
        if (typeof (m as any).cpAfter === 'number') return (m as any).cpAfter; // stored as opponent POV
        const afterScoreObj = (m as any).afterScore;
        if (afterScoreObj && afterScoreObj.type === 'cp' && typeof afterScoreObj.value === 'number') {
          return afterScoreObj.value; // also opponent POV
        }
        if (typeof (m as any).cpAfterWhite === 'number') {
          const whiteVal = (m as any).cpAfterWhite; // always White POV
          return side === 'W' ? -whiteVal : whiteVal; // convert to opponent POV
        }
        return undefined;
      })();

      const afterCpMover =
        typeof afterCpOpponent === 'number'
          ? -afterCpOpponent
          : (typeof (m as any).cpAfterWhite === 'number'
              ? (side === 'W' ? (m as any).cpAfterWhite : -(m as any).cpAfterWhite)
              : afterToMoverPOV(m) ?? undefined);
      if (typeof beforeCpMover === 'number' && typeof afterCpMover === 'number') {
        (m as any).deltaCpMover = afterCpMover - beforeCpMover;
      }
      const hasAfterMate = typeof (m as any).mateAfter === 'number';

      const best = (typeof bestBeforeCp === 'number') ? ({ type: 'cp', value: bestBeforeCp } as const) : null;
      const after = hasAfterMate
        ? ({ type: 'mate', value: (m as any).mateAfter } as const)
        : (typeof afterCpOpponent === 'number'
            ? ({ type: 'cp', value: afterCpOpponent } as const)
            : null);

      let loss = cpLossForMoveSideAware(best as any, after as any, side);
      // Fallback: use signed delta for the mover if provided in data (negative means worse for mover)
      if (loss == null && typeof (m as any).deltaCpMover === 'number') {
        const d = (m as any).deltaCpMover;
        loss = Math.max(0, -d);
      }
      // Last resort: if cpBefore/cpAfterWhite exist, approximate CPL = max(0, before - after_mover)
      if (loss == null && typeof beforeCpMover === 'number' && typeof afterCpMover === 'number') {
        loss = Math.max(0, beforeCpMover - afterCpMover);
      }
      // If everything else is missing but we already stored a cpl, use it.
      if (loss == null && typeof (m as any).cpl === 'number' && isFinite((m as any).cpl)) {
        loss = Math.max(0, (m as any).cpl);
      }
      if (loss == null) continue;
      halfMoves.push({ side, best, after, loss });

      const b = bucketFromLossCp(loss);
      if (side === 'W') {
        if (b === 'inacc') bW.inacc++;
        else if (b === 'mistake') bW.mistakes++;
        else if (b === 'blunder') bW.blunders++;
      } else {
        if (b === 'inacc') bB.inacc++;
        else if (b === 'mistake') bB.mistakes++;
        else if (b === 'blunder') bB.blunders++;
      }
    }

    let sumW = 0, nW = 0, sumB = 0, nB = 0;
    for (const h of halfMoves) {
      if (!Number.isFinite(h.loss)) continue;
      if (h.side === 'W') { sumW += h.loss; nW++; } else { sumB += h.loss; nB++; }
    }
    const avgCplW = nW ? sumW / nW : null;
    const avgCplB = nB ? sumB / nB : null;
    const whiteAcc = accFromAcplConservative(avgCplW);
    const blackAcc = accFromAcplConservative(avgCplB);
    const quality = tallyMoveQuality(halfMoves);
    // Conservative Elo estimates
    const estEloWhite = estimateEloConservative(avgCplW, bW);
    const estEloBlack = estimateEloConservative(avgCplB, bB);
    return { avgCplW, avgCplB, whiteAcc, blackAcc, quality, estEloWhite, estEloBlack };
  }, [moveEvals]);

  const onGenerateNotes = useCallback(async () => {
    try {
      if (coachBusy) return;
      setCoachBusy(true);
      // Build a compact payload for the coach model; keep only essentials.
      const inputs = {
        summary: review || null,
        moments: coachMoments,
        totalPlies: Math.max(1, movesUci.length),
      };
      const res: any = await generateCoachNotes(inputs);
      if (!res || (res as any).offline) {
        const reason = (res as any)?.reason || 'offline';
        const msg = `Coach unavailable (${reason}). Start OLLAMA or set COACH_MODEL.`;
        setCoachNotes([{ type: 'summary', text: msg } as any]);
        return;
      }
      if (Array.isArray(res.notes)) {
        setCoachNotes(res.notes as any);
      } else {
        setCoachNotes([{ type: 'summary', text: 'No coach notes returned.' } as any]);
      }
    } catch (e) {
      console.error('[coach] generate error', e);
      const msg = e instanceof Error ? e.message : String(e || 'unknown error');
      setCoachNotes([{ type: 'summary', text: `Coach error: ${msg}` } as any]);
    } finally {
      setCoachBusy(false);
    }
  }, [coachBusy, review, coachMoments, movesUci.length]);

  const notesForPly = useM(() => {
    const arr = Array.isArray(coachNotes) ? coachNotes : [];
    if (!arr.length) return [];
    const idx = Math.max(0, ply - 1);
    const exact = arr.filter((n) => n?.type === 'move' && n.moveIndex === idx);
    if (exact.length) return exact;
    const near = arr.filter(
      (n) => n?.type === 'move' && typeof n.moveIndex === 'number' && Math.abs(n.moveIndex - idx) === 1
    );
    if (near.length) return near;
    if (idx === 0) return arr.filter((n) => n?.type === 'intro');
    if (idx >= moveEvals.length - 1) return arr.filter((n) => n?.type === 'summary');
    return [];
  }, [ply, coachNotes, moveEvals.length]);

  // (No textarea-based coach text here anymore; list is rendered via CoachMoveList)

  // best-move arrow
  const bestArrow = useM(() => {
    if (ply === 0) return null;
    const idx = ply - 1;
    if (idx < 0 || idx >= moveEvals.length) return null;
    const uci = moveEvals[idx]?.best;
    if (!uci || uci.length < 4) return null;
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    return { from, to };
  }, [ply, moveEvals]);

  const cpFromMate = useCallback((mateVal: number | null | undefined) => {
    if (mateVal == null || !isFinite(mateVal)) return null;
    const sign = mateVal >= 0 ? 1 : -1;
    return sign * (10000 - Math.min(99, Math.abs(mateVal)) * 100);
  }, []);

  const evalDisplayCp = useM(() => {
    if (typeof evalCp === 'number' && isFinite(evalCp)) return evalCp;
    const cur =
      (currentMoveEval && typeof (currentMoveEval as any).cpAfter === 'number'
        ? (currentMoveEval as any).cpAfter
        : cpFromMate((currentMoveEval as any)?.mateAfter)) ?? null;
    if (typeof cur === 'number' && isFinite(cur)) return cur;
    for (let i = moveEvals.length - 1; i >= 0; i--) {
      const m: any = moveEvals[i];
      if (typeof m?.cpAfter === 'number' && isFinite(m.cpAfter)) return m.cpAfter;
      if (typeof m?.mateAfter === 'number' && isFinite(m.mateAfter)) {
        const v = cpFromMate(m.mateAfter);
        if (typeof v === 'number') return v;
      }
    }
    return null;
  }, [evalCp, currentMoveEval, moveEvals, cpFromMate]);

  // Only show per-move badges when the current move has an analysis tag.
  const hasAnalysis = !!(currentMoveEval && currentMoveEval.tag);

  const panelWidth = sidebarOpen ? 480 : 28;
  const movesPanelWidth = 320;

  const MovePane = ({ list, bookMask, bookDepth, onJump, currentPly }: {
    list: typeof moveEvals;
    bookMask: boolean[];
    bookDepth: number;
    onJump: (n: number) => void;
    currentPly: number;
  }) => {
    const rows = list || [];
    const beforeAfterDeltaWhite = (m: any): number | null => {
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
        if (typeof m?.cpBefore === 'number') return m.cpBefore; // stored White POV
        if (typeof m?.bestCpBefore === 'number') {
          // bestCpBefore is mover POV
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
    const tagColor = (tag: string) => {
      if (tag === 'Blunder') return '#ff6b6b';
      if (tag === 'Mistake') return '#f5b942';
      if (tag === 'Best' || tag === 'Genius') return '#6dd679';
      if (tag === 'Book' || tag === 'Opening') return '#8ab5ff';
      return '#cfd5dd';
    };
    return (
      <div style={{
        width: movesPanelWidth,
        background: '#1d1b18',
        border: '1px solid #2a2a2a',
        borderRadius: 10,
        padding: 12,
        boxSizing: 'border-box' as const,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#eee' }}>Moves</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {['#', 'SAN', 'Best', 'Eval', 'Tag'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 2px', color: '#aaa', borderBottom: '1px solid #2f2f2f' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => {
                const isOpening = (i < bookMask.length ? bookMask[i] : i < bookDepth);
                const tag = isOpening ? 'Book' : (m.tag || 'Good');
                return (
                  <tr
                    key={i}
                    onClick={() => onJump(i + 1)}
                    style={{
                      cursor: 'pointer',
                      background: i === currentPly - 1 ? '#24221f' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '4px 2px', color: '#cfd5dd' }}>{m.moveNo}</td>
                    <td style={{ padding: '4px 2px', color: '#f7f7f7' }}>{m.san}</td>
                    <td style={{ padding: '4px 2px', color: '#aeb6c2' }}>{m.best || ''}</td>
                    <td style={{ padding: '4px 2px', color: '#d5dce4' }}>{formatDelta(beforeAfterDeltaWhite(m))}</td>
                    <td style={{ padding: '4px 2px', color: tagColor(tag), fontWeight: 600 }}>{tag}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <KeyboardNav
        ply={ply}
        movesUciLength={movesUci.length}
        onRebuildTo={rebuildTo}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${movesPanelWidth}px 1fr ${panelWidth}px`,
          gap: 12,
          padding: 12,
          height: '100vh',
          boxSizing: 'border-box',
          minHeight: 0,
        }}
      >
        <MovePane
          list={moveEvals}
          bookMask={bookMask}
          bookDepth={bookDepth}
          onJump={rebuildTo}
          currentPly={ply}
        />

        <BoardPane
          // core state
          fen={fen}
          orientation={orientation}
          onOrientationChange={setOrientation}
          evalCp={evalDisplayCp}
          evalPending={evalPending}

          // series + current move for icons/graph
          currentMoveEval={ply > 0 ? (moveEvals[ply - 1] ?? null) : null}
          evalSeries={moveEvals.map(m => (m?.cpAfter ?? null))}
          showEvalGraph={showEvalGraph}
          onToggleEvalGraph={() => setShowEvalGraph(v => !v)}
          hasAnalysis={hasAnalysis}

          // moves + nav
          movesUci={movesUci}
          ply={ply}
          onRebuildTo={rebuildTo}

          // engine controls
          engineBusy={engineBusy}
          autoReply={autoReply}
          setAutoReply={setAutoReply}
          onEngineMove={engineMove}
          engineStrength={engineStrength}
          onEngineStrengthChange={setEngineStrength}

          // user actions
          onUserDrop={handleUserDrop}
          onNewGame={() => {
            setMovesUci([]);
            setPly(0);
            const g = new Chess();
            gameRef.current = g;
            setFen(g.fen());
            setMoveEvals([]);
            setOpeningInfo(null);
          }}

          // visuals
          bestArrow={bestArrow}
          bookMask={bookMask}
          currentPly={ply}
          lastMove={ply > 0 && movesUci[ply - 1] ? { from: movesUci[ply - 1].slice(0,2), to: movesUci[ply - 1].slice(2,4) } : null}
        />

        <SidebarPane
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          currentEval={currentMoveEval ?? undefined}
          openingText={openingText}
          gameEloWhite={review?.estEloWhite ?? null}
          gameEloBlack={review?.estEloBlack ?? null}
          movesUci={movesUci}
          openingInfo={openingText || null}
          whiteAcc={review?.whiteAcc ?? null}
          blackAcc={review?.blackAcc ?? null}
          avgCplW={review?.avgCplW ?? null}
          avgCplB={review?.avgCplB ?? null}
          quality={review?.quality ?? null}
          ply={ply}
          bookUci={bookUci}
          analyzing={analyzing}
          progress={progress}
          review={review}
          moveEvals={moveEvals}
          bookDepth={bookDepth}
          bookMask={bookMask}
          onRebuildTo={rebuildTo}
          onAnalyze={analyzePgn}
          onAnalyzeFast={analyzePgnFast}
          onStopAnalyze={stopAnalyze}
          onLoadPgnText={handleLoadPgnText}
          onLoadPgnFile={handleLoadPgnFile}
          onApplyBookMove={handleApplyBookMove}
          engineStrength={engineStrength}
          onEngineStrengthChange={setEngineStrength}
          onCoachNotesChange={setCoachNotes}
          activeCoachNotes={notesForPly}
          coachNotes={Array.isArray(coachNotes) ? coachNotes : []}
          currentPly={ply}
          onJumpToPly={jumpToPly}
          onGenerateNotes={onGenerateNotes}
          coachBusy={coachBusy}
          showMoves={false}
        />
      </div>
    </div>
  );
}
