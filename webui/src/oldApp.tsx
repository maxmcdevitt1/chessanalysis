// webui/src/App.tsx
import { cplFromBeforeAfter, accuracyFromAvgCpl } from './ScoreHelpers';
import { useEffect, useMemo as useM, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { analyzeFen } from './bridge';
import { initOpenings, findOpeningByMoves, nextBookMoves } from './openings/matcher';
import BoardPane from './BoardPane';
import SidebarPane from './SidebarPane';

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

// ---------- helpers shared by analysis ----------

// CP from infos[] (side-to-move POV)
function cpFromInfos(infos?: any[]): number | null {
  if (!infos || !infos.length) return null;

  // take the smallest multipv
  let best: any = null;
  for (const it of infos) {
    if (!best) {
      best = it;
      continue;
    }
    const mpBest = Number(best.multipv ?? 1);
    const mpCur = Number(it.multipv ?? 1);
    if (mpCur < mpBest) best = it;
  }
  if (!best) return null;

  if (typeof best.cp === 'number') return best.cp;

  if (typeof best.mate === 'number') {
    const MATE_CP = 1000;
    return Math.sign(best.mate) * MATE_CP;
  }

  // fall back to Lichess-style fields if present
  if (best.type === 'cp' && Number.isFinite(Number(best.score))) {
    return Number(best.score);
  }
  if (best.type === 'mate' && Number.isFinite(Number(best.score))) {
    const MATE_CP = 1000;
    return Math.sign(Number(best.score)) * MATE_CP;
  }

  return null;
}

// Extract engine best move as UCI from an analyzeFen result
function extractBestMoveUci(res: any): string | null {
  const infos: any[] | undefined = Array.isArray(res?.infos) ? res.infos : undefined;

  if (infos && infos.length) {
    let bestEntry: any = null;

    for (const it of infos) {
      if (!bestEntry) {
        bestEntry = it;
        continue;
      }
      const mpBest = Number(bestEntry.multipv ?? 1);
      const mpCur = Number(it.multipv ?? 1);
      if (mpCur < mpBest) bestEntry = it;
    }

    if (bestEntry) {
      const u =
        bestEntry.pvUci?.[0] ||
        bestEntry.bestMove ||
        bestEntry.best ||
        bestEntry.uci;
      if (typeof u === 'string' && u.length >= 4) {
        return u.toLowerCase();
      }
    }
  }

  if (typeof res?.bestMove === 'string' && res.bestMove.length >= 4) {
    return res.bestMove.toLowerCase();
  }

  return null;
}

// Compare moves ignoring promotion piece
function sameBaseMove(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 4).toLowerCase() === b.slice(0, 4).toLowerCase();
}

// Converts SAN -> UCI moves from the *current* UCI history starting from a ply
function sanListToUciFromPosition(
  sans: string[],
  startPly: number,
  movesUci: string[]
): string[] {
  const g = new Chess();
  // rebuild to current ply from UCI history
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

function severityTag(cpl: number | null): MoveEval['tag'] | undefined {
  if (cpl == null) return undefined; // no eval → no tag

  if (cpl <= 30) return 'Good';      // small imperfection
  if (cpl <= 100) return 'Mistake';  // noticeable error
  return 'Blunder';                  // big swing
}

function symbolFor(tag: MoveEval['tag']): MoveEval['symbol'] {
  switch (tag) {
    case 'Genius':
      return '!!';
    case 'Best':
      return '!';
    case 'Good':
      return '';    // keep quiet
    case 'Mistake':
      return '?';
    case 'Blunder':
      return '??';
    case 'Book':
      return '';
    default:
      return '';
  }
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

// safeMove using UCI
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

  const [evalCp, setEvalCp] = useState<number | null>(null);
  const [evalPending, setEvalPending] = useState(false);
  const [suspendEval, setSuspendEval] = useState(false);
  const evalReqId = useRef(0);

  const replyScheduled = useRef(false);
  const userMovedRef = useRef(false);
  const analyzeCancel = useRef(false);

  // current move eval row
  const currentEvalRow: MoveEval | undefined =
    ply > 0 ? moveEvals[ply - 1] : undefined;

  // openings init
  useEffect(() => {
    initOpenings().catch(() => {});
  }, []);

  // update opening info per ply
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

  // live eval of current position (used until we have per-move analysis)
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
        const cpRoot = cpFromInfos(res?.infos);
        if (evalReqId.current === id) {
          const turn = gameRef.current.turn();
          const whiteCp = cpRoot == null ? null : turn === 'w' ? cpRoot : -cpRoot;
          setEvalCp(whiteCp);
        }
      } catch {
        if (evalReqId.current === id) setEvalCp(null);
      } finally {
        if (evalReqId.current === id) setEvalPending(false);
      }
    })();
  }, [ply, fen, suspendEval]);

  // Game rebuild to ply N
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

  // --- analysis ---
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
        const beforeInfos: any[] = Array.isArray(before?.infos) ? before.infos : [];
        const bestMoveUci = extractBestMoveUci(before);

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
        const afterInfos: any[] = Array.isArray(after?.infos) ? after.infos : [];

        // CPL: using ScoreHelpers (eval_after_best - eval_after_played, mover POV)
        const cpl = cplFromBeforeAfter(beforeInfos, afterInfos);

        // cpBefore / cpAfter: white POV
        const beforeCpRoot = cpFromInfos(beforeInfos); // side-to-move at fenBefore is the mover
        const afterCpRoot = cpFromInfos(afterInfos);   // side-to-move at fenAfter is opponent

        const mover = i % 2 === 0 ? 'w' : 'b';

        const cpBeforeWhite =
          beforeCpRoot == null
            ? null
            : mover === 'w'
            ? beforeCpRoot
            : -beforeCpRoot;

        const cpAfterWhite =
          afterCpRoot == null
            ? null
            : mover === 'w'
            ? -afterCpRoot
            : afterCpRoot;

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

        let tag: MoveEval['tag'] | undefined;
        if (isBookMove) {
          tag = 'Book';
        } else if (playedIsBest && cpl != null) {
          tag = 'Best';
        } else {
          tag = severityTag(cpl); // undefined if no eval / CPL
        }

        const symbol = tag && tag !== 'Book' ? symbolFor(tag) : '';

        results.push({
          index: i,
          moveNo: Math.floor(i / 2) + 1,
          side: mover === 'w' ? 'White' : 'Black',
          san,
          uci: playedUci,
          best: bestMoveUci || undefined,
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

  // --- engine move / auto reply ---
  async function engineMove() {
    if (engineBusy) return;
    const g = gameRef.current;
    setEngineBusy(true);
    try {
      const res = await withTimeout(
        analyzeFen(g.fen(), { movetimeMs: 120, multiPv: 1 }),
        3000
      );
      const uci = extractBestMoveUci(res) || res?.bestMove || null;
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

  // --- user handlers ---
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

  // --- review (accuracy, avg CPL) ---
  const review = useM(() => {
    if (!moveEvals.length) return null;
    let sumW = 0, nW = 0;
    let sumB = 0, nB = 0;
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

    const whiteAcc = avgW == null ? null : Math.round(accuracyFromAvgCpl(avgW));
    const blackAcc = avgB == null ? null : Math.round(accuracyFromAvgCpl(avgB));

    return { avgW, avgB, whiteAcc, blackAcc };
  }, [moveEvals]);

  // --- best-move arrow: show what you should have played on the last move (ply-1) ---
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

  // --- eval bar uses per-move cpAfter when available ---
  const evalDisplayCp =
    currentEvalRow && currentEvalRow.cpAfter != null
      ? currentEvalRow.cpAfter
      : evalCp;

  const panelWidth = sidebarOpen ? 480 : 28;

  return (
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
        fen={fen}
        orientation={orientation}
        onOrientationChange={setOrientation}
        evalCp={evalDisplayCp}
        evalPending={evalPending}
        movesUci={movesUci}
        ply={ply}
        moveEvals={moveEvals}
        openingAt={openingAt}
        engineBusy={engineBusy}
        autoReply={autoReply}
        setAutoReply={setAutoReply}
        onUserDrop={handleUserDrop}
        onUserClickMove={handleUserClickMove}
        onRebuildTo={rebuildTo}
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
        onEngineMove={engineMove}
        bestArrow={bestArrow}
      />

      <SidebarPane
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        currentEval={currentEvalRow}
        openingText={openingText}
        movesUci={movesUci}
        openingAt={openingAt}
        ply={ply}
        bookUci={bookUci}
        analyzing={analyzing}
        progress={progress}
        review={review}
        moveEvals={moveEvals}
        onRebuildTo={rebuildTo}
        onAnalyze={analyzePgn}
        onStopAnalyze={stopAnalyze}
        onLoadPgnText={handleLoadPgnText}
        onLoadPgnFile={handleLoadPgnFile}
        onApplyBookMove={handleApplyBookMove}
      />
    </div>
  );
}

