// webui/src/App.tsx
import { accuracyFromAvgCpl } from './ScoreHelpers';
import { useEffect, useMemo as useM, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { analyzeFen } from './bridge';
import { initOpenings, findOpeningByMoves, nextBookMoves } from './openings/matcher';
import BoardPane from './BoardPane';
import SidebarPane from './SidebarPane';
import { getNumber, setNumber } from './persist';
import KeyboardNav from './KeyboardNav';

export type MoveEval = {
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

export type BadgeTag = MoveEval['tag'] | 'Book';

type OpeningMatch = {
  eco: string;
  name: string;
  variation?: string;
  ply: number;
};

const ENGINE_STRENGTH_KEY = 'engineStrength';
const SHOW_EVAL_GRAPH_KEY = 'showEvalGraph';

// ---------- small helpers ----------

function strengthToMovetimeMs(n: number) {
  const c = Math.max(1, Math.min(20, n));
  return 40 + c * 40;
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
  } catch (e) {
    console.warn('safeMove illegal', uci, e);
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

// last CP from infos (supports both {type:'cp',score} and {cp})
function lastCp(infos?: any[]): number | null {
  if (!infos?.length) return null;
  for (let i = infos.length - 1; i >= 0; i--) {
    const it = infos[i];
    if (typeof it?.cp === 'number') return it.cp;
    if (it?.type === 'cp' && Number.isFinite(Number(it.score))) {
      return Number(it.score);
    }
  }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    const clear = () => {
      try {
        clearTimeout(timer);
      } catch {}
    };
    p.then(
      (v) => {
        clear();
        resolve(v);
      },
      (e) => {
        clear();
        reject(e);
      }
    );
  });
}

// Book helpers: SAN->UCI if needed
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

// compare moves ignoring promotion letter
function sameBaseMove(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 4).toLowerCase() === b.slice(0, 4).toLowerCase();
}

// tag from CPL; this NEVER returns undefined
function severityTag(cpl: number | null): MoveEval['tag'] {
  if (cpl == null) return 'Good'; // no eval → treat as neutral
  if (cpl <= 30) return 'Good';
  if (cpl <= 80) return 'Mistake';
  return 'Blunder';
}

function symbolFor(tag: MoveEval['tag']): MoveEval['symbol'] {
  switch (tag) {
    case 'Genius':
      return '!!';
    case 'Best':
      return '!';
    case 'Good':
      return '';
    case 'Mistake':
      return '?';
    case 'Blunder':
      return '??';
    case 'Book':
    default:
      return '';
  }
}

// ---------- component ----------

export default function App() {
  const gameRef = useRef(new Chess());

  const [fen, setFen] = useState(gameRef.current.fen());
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [movesUci, setMovesUci] = useState<string[]>([]);
  const [ply, setPly] = useState(0);
  const [moveEvals, setMoveEvals] = useState<MoveEval[]>([]);
  const [opening, setOpening] = useState<OpeningMatch | null>(null);
  const [openingAt, setOpeningAt] = useState<(OpeningMatch | null)[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [engineBusy, setEngineBusy] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [engineStrength, setEngineStrength] = useState(() =>
    getNumber(ENGINE_STRENGTH_KEY, 10)
  );
  const [showEvalGraph, setShowEvalGraph] = useState(() => {
    const v = getNumber(SHOW_EVAL_GRAPH_KEY, 1);
    return v !== 0;
  });

  const [evalCp, setEvalCp] = useState<number | null>(null);
  const [evalPending, setEvalPending] = useState(false);
  const [suspendEval, setSuspendEval] = useState(false);
  const evalReqId = useRef(0);

  const replyScheduled = useRef(false);
  const userMovedRef = useRef(false);
  const analyzeCancel = useRef(false);

  useEffect(() => {
    setNumber(ENGINE_STRENGTH_KEY, engineStrength);
  }, [engineStrength]);

  useEffect(() => {
    setNumber(SHOW_EVAL_GRAPH_KEY, showEvalGraph ? 1 : 0);
  }, [showEvalGraph]);

  const currentMoveEval = useM(
    () => (ply > 0 ? moveEvals[ply - 1] ?? null : null),
    [moveEvals, ply]
  );

  // openings
  useEffect(() => {
    initOpenings().catch(() => {});
  }, []);

  useEffect(() => {
    const seq = movesUci.slice(0, ply);
    setOpening(findOpeningByMoves(seq) || null);
    const perPly: (OpeningMatch | null)[] = [];
    for (let i = 1; i <= movesUci.length; i++) {
      perPly[i] = findOpeningByMoves(movesUci.slice(0, i)) || null;
    }
    setOpeningAt(perPly);
  }, [movesUci, ply]);

  const openingText = opening
    ? `${opening.name}${opening.variation ? ' — ' + opening.variation : ''} (${opening.eco})`
    : '';

  const bookUci = useM(
    () => nextBookMoves(movesUci.slice(0, ply)) || [],
    [movesUci, ply]
  );

  // live eval (current board)
  useEffect(() => {
    if (suspendEval) return;
    const id = ++evalReqId.current;
    setEvalPending(true);
    (async () => {
      try {
        const res = await withTimeout(
          analyzeFen(gameRef.current.fen(), { movetimeMs: 120, multiPv: 1 }),
          2500
        );
        const cp = lastCp(res?.infos);
        if (evalReqId.current === id) {
          const turn = gameRef.current.turn();
          const whiteCp = cp == null ? null : turn === 'w' ? cp : -cp;
          setEvalCp(whiteCp);
        }
      } catch {
        if (evalReqId.current === id) setEvalCp(null);
      } finally {
        if (evalReqId.current === id) setEvalPending(false);
      }
    })();
  }, [ply, fen, suspendEval]);

  // rebuild game to ply N
  function rebuildTo(n: number) {
    const g = new Chess();
    for (let i = 0; i < n; i++) safeMove(g, movesUci[i]);
    gameRef.current = g;
    setPly(n);
    setFen(g.fen());
  }

  function applyUci(raw: string): boolean {
    const g = gameRef.current;
    const uci = withAutoQueen(raw, g);
    const mv = safeMove(g, uci);
    if (!mv) return false;
    const next = movesUci.slice(0, ply).concat([uci]);
    setMovesUci(next);
    setPly(next.length);
    setFen(g.fen());
    return true;
  }

  function scheduleReply() {
    if (!autoReply || replyScheduled.current || engineBusy) return;
    replyScheduled.current = true;
    requestAnimationFrame(() => {
      replyScheduled.current = false;
      engineMove();
    });
  }

  // ---------- analysis ----------

  async function analyzePgn() {
    if (movesUci.length === 0) {
      alert('Load or paste a PGN first');
      return;
    }

    analyzeCancel.current = false;
    setSuspendEval(true);
    evalReqId.current++;
    setAnalyzing(true);
    setProgress(0);

    try {
      const results: MoveEval[] = [];
      const g = new Chess();

      for (let i = 0; i < movesUci.length; i++) {
        if (analyzeCancel.current) break;

        const fenBefore = g.fen();

        // BEFORE
        let before: any = null;
        try {
          before = await withTimeout(
            analyzeFen(fenBefore, { movetimeMs: 1000, multiPv: 3 }),
            6000
          );
        } catch {
          before = null;
        }

        const bestCp = lastCp(before?.infos);
        const bestMoveUci = (before?.bestMove || null) as string | null;

        // apply played move
        const playedUci = movesUci[i];
        const mv = safeMove(g, playedUci);
        const san = mv?.san || '(?)';
        const fenAfter = g.fen();

        // AFTER
        let after: any = null;
        try {
          after = await withTimeout(
            analyzeFen(fenAfter, { movetimeMs: 700, multiPv: 2 }),
            4000
          );
        } catch {
          after = null;
        }
        const afterCpRaw = lastCp(after?.infos);

        // who moved?
        const mover = i % 2 === 0 ? 'w' : 'b';

        // mover-POV evals
        const bestForMover = bestCp == null ? null : bestCp;
        const afterForMover =
          afterCpRaw == null ? null : -afterCpRaw; // flip because side-to-move changed

        // white-POV for display
        const cpBeforeWhite =
          bestForMover == null
            ? null
            : mover === 'w'
            ? bestForMover
            : -bestForMover;

        const cpAfterWhite =
          afterForMover == null
            ? null
            : mover === 'w'
            ? afterForMover
            : -afterForMover;

        // CPL (mover POV)
        let cpl: number | null = null;
        if (bestForMover != null && afterForMover != null) {
          cpl = bestForMover - afterForMover;
          if (cpl < 0) cpl = 0;
        }

        // Book tagging
        const seqBefore = movesUci.slice(0, i);
        const candidatesUci = normalizeBookToUci(
          nextBookMoves(seqBefore),
          i,
          movesUci
        );
        const isBookMove =
          Array.isArray(candidatesUci) &&
          candidatesUci.includes(playedUci);

        const playedIsBest = sameBaseMove(playedUci, bestMoveUci);

        let tag: MoveEval['tag'];
        if (isBookMove) {
          tag = 'Book';
        } else if (playedIsBest && cpl === 0 && bestForMover != null) {
          tag = 'Best';
        } else {
          tag = severityTag(cpl);
        }

        const symbol = symbolFor(tag);

        results.push({
          index: i,
          moveNo: Math.floor(i / 2) + 1,
          side: mover === 'w' ? 'White' : 'Black',
          san,
          uci: playedUci,
          best: bestMoveUci,
          cpBefore: cpBeforeWhite,
          cpAfter: cpAfterWhite,
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

      if (!analyzeCancel.current) setMoveEvals(results);
    } finally {
      setAnalyzing(false);
      setSuspendEval(false);
      setProgress(null);
    }
  }

  function stopAnalyze() {
    analyzeCancel.current = true;
    setAnalyzing(false);
    setSuspendEval(false);
    setProgress(null);
  }

  // ---------- engine / auto reply ----------

  async function engineMove() {
    if (engineBusy) return;
    const g = gameRef.current;
    setEngineBusy(true);
    try {
      const res = await withTimeout(
        analyzeFen(g.fen(), { movetimeMs: strengthToMovetimeMs(engineStrength), multiPv: 1 }),
        3000
      );
      const uci = (res?.bestMove as string | undefined) || null;
      if (!uci) return;
      applyUci(uci);
    } finally {
      setEngineBusy(false);
    }
  }

  useEffect(() => {
    if (!autoReply) return;
    if (!userMovedRef.current) return;
    if (engineBusy) return;
    userMovedRef.current = false;
    setSuspendEval(true);
    (async () => {
      try {
        await engineMove();
      } finally {
        setSuspendEval(false);
      }
    })();
  }, [ply, autoReply, engineBusy]);

  // ---------- handlers passed to children ----------

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
    } catch {
      // ignore
    }
  }

  async function handleLoadPgnFile(file: File) {
    const text = await file.text();
    handleLoadPgnText(text);
  }

  function handleApplyBookMove(uci: string) {
    applyUci(uci);
  }

  // ---------- review (accuracy / avg CPL) ----------

  const evalSeries = useM(
    () => moveEvals.map((m) => m?.cpAfter ?? null),
    [moveEvals]
  );

  const qualityCounts = useM(
    () => {
      const base = { Best: 0, Good: 0, Mistake: 0, Blunder: 0, Book: 0 };
      for (const m of moveEvals) {
        switch (m?.tag) {
          case 'Best':
            base.Best++;
            break;
          case 'Good':
            base.Good++;
            break;
          case 'Mistake':
            base.Mistake++;
            break;
          case 'Blunder':
            base.Blunder++;
            break;
          case 'Book':
            base.Book++;
            break;
          default:
            break;
        }
      }
      return base;
    },
    [moveEvals]
  );

  const review = useM(() => {
    if (!moveEvals.length) return null;
    let sumW = 0,
      nW = 0;
    let sumB = 0,
      nB = 0;
    for (const m of moveEvals) {
      if (m.cpl == null) continue;
      if (m.side === 'White') {
        sumW += m.cpl;
        nW++;
      } else {
        sumB += m.cpl;
        nB++;
      }
    }
    const avgW = nW ? sumW / nW : null;
    const avgB = nB ? sumB / nB : null;

    const whiteAcc =
      avgW == null ? null : Math.round(accuracyFromAvgCpl(avgW));
    const blackAcc =
      avgB == null ? null : Math.round(accuracyFromAvgCpl(avgB));

    return { avgW, avgB, whiteAcc, blackAcc };
  }, [moveEvals]);

  // ---------- best-move arrow = what you should have played on last move ----------

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

// App.tsx – put near other hooks
const latestRunRef = useRef(0);

useEffect(() => {
  if (suspendEval) return;
  const id = ++latestRunRef.current;
  const t = setTimeout(async () => {
    try {
      const res = await bridge.analyzeFen(fenRef.current!, { movetimeMs: 120, multiPv: 1 });
      if (id !== latestRunRef.current) return; // drop stale
      // setEval should update your eval bar state; adapt to your shape
      setEval({ cp: res?.cp ?? null, pending: false });
    } catch {/* ignore */}
  }, 120);
  return () => clearTimeout(t);
}, [fen, ply, suspendEval]);

  // eval bar: prefer analyzed cpAfter for current move, else live eval
  const evalDisplayCp =
    currentMoveEval && currentMoveEval.cpAfter != null
      ? currentMoveEval.cpAfter
      : evalCp;

  const panelWidth = sidebarOpen ? 480 : 28;

return (
  <div className="app-shell">
    {/* Mount once, near the top */}
    <KeyboardNav
      ply={ply}
      movesUciLength={movesUci.length}
      onRebuildTo={rebuildTo}  // <-- your handler name
    />

    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `1fr ${panelWidth}px`,
        gap: 12,
        padding: 12,
        height: '100vh',
        boxSizing: 'border-box',
        minHeight: 0,
      }}
    >
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
          setOpening(null);
          setOpeningAt([]);
        }}

        // visuals
        bestArrow={bestArrow}
      />

      <SidebarPane
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        currentEval={currentMoveEval ?? undefined}
        openingText={openingText}
        movesUci={movesUci}
        openingAt={openingAt}
        ply={ply}
        bookUci={bookUci}
        analyzing={analyzing}
        progress={progress}
        review={review}
        moveEvals={moveEvals}
        qualityCounts={qualityCounts}
        onRebuildTo={rebuildTo}
        onAnalyze={analyzePgn}
        onStopAnalyze={stopAnalyze}
        onLoadPgnText={handleLoadPgnText}
        onLoadPgnFile={handleLoadPgnFile}
        onApplyBookMove={handleApplyBookMove}
      />
    </div>
  </div>
);

}
