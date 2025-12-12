#!/usr/bin/env ts-node
/**
 * Elo Self-Play Harness (app-parity)
 * ------------------------------------------------------------
 * - Uses your app's *real* bot logic: dynamic import of webui/src/botPicker
 * - Uses your app's *real* review logic if present (dynamic import of common paths)
 * - Robust UCI pipe with buffering + timeouts
 * - Alternating-color self-play; writes a PGN; prints JSON summary
 *
 * Examples:
 *   STOCKFISH_BIN=$(which stockfish) npx tsx --tsconfig tsconfig.tools.json tools/elo_tester.ts \
 *     --games 100 --bandA developing --bandB intermediate --pgn games.pgn
 *
 *   # fixed Elos
 *   STOCKFISH_BIN=$(which stockfish) npx tsx --tsconfig tsconfig.tools.json tools/elo_tester.ts \
 *     --games 80 --eloA 900 --eloB 1150 --pgn out.pgn
 *
 * Flags:
 *   --games N                number of games (default 100)
 *   --maxMoves N             ply cap per game (default 200)
 *   --eloA N --eloB N        fixed Elos for sides A/B (overrides bands)
 *   --bandA X --bandB Y      bands: beginner|developing|intermediate|advanced|expert
 *   --fens file.txt          newline-separated FENs (optional)
 *   --pgn path               PGN output (default games.pgn)
 *   --noReview               skip calling app review (still writes PGN)
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { finished } from 'stream/promises';
import { Chess } from 'chess.js';

// --------------------- CLI ---------------------
const args = process.argv.slice(2);
const val = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] ?? d) : d; };
const flag = (k: string) => args.includes(`--${k}`);

const GAMES = parseInt(val('games', '100')!, 10);
const MAX_MOVES = parseInt(val('maxMoves', '200')!, 10);
const ELO_A = val('eloA'); const ELO_B = val('eloB');
const BAND_A = val('bandA'); const BAND_B = val('bandB');
const FENS_FILE = val('fens');
const PGN_PATH = val('pgn', 'games.pgn');
const NO_REVIEW = flag('noReview');

// ---------------- Engine interface (matches botPicker) ----------------
type Color = 'w' | 'b';
type Cand = { uci: string; cp?: number; mate?: number; pv?: string[] };

interface Engine {
  setOptions(opts: Record<string, number | string | boolean>): Promise<void>;
  analyse(args: {
    fen: string;
    movetimeMs: number;
    multiPv: number;
    finalOnly?: boolean;
  }): Promise<{ sideToMove: Color; cands: Cand[] }>;
}

// ---------------- UCI wrapper (robust I/O) ----------------
class UciEngine implements Engine {
  private proc = spawn(process.env.STOCKFISH_BIN || 'stockfish', [], { stdio: ['pipe', 'pipe', 'inherit'] });
  private buf = '';
  private q: Array<(l: string) => void> = [];
  private lineBuf: string[] = [];
  private ready = false;

  constructor() {
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d: string) => this.onData(d));
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      const waiter = this.q.shift();
      if (waiter) waiter(line);
      else this.lineBuf.push(line);
    }
  }

  private write(s: string) { this.proc.stdin.write(s + '\n'); }

  private readUntil(pred: (l: string) => boolean, timeoutMs = 10000): Promise<string[]> {
    const out: string[] = [];
    const tryDrain = () => {
      while (this.lineBuf.length) {
        const l = this.lineBuf.shift()!;
        out.push(l);
        if (pred(l)) return true;
      }
      return false;
    };
    if (tryDrain()) return Promise.resolve(out);
    return new Promise((resolve, reject) => {
      const h = (l: string) => {
        out.push(l);
        if (pred(l)) { clearTimeout(t); resolve(out); }
        else this.q.push(h);
      };
      const t = setTimeout(() => {
        reject(new Error(`UCI readUntil timeout after ${timeoutMs}ms; last lines: ${out.slice(-5).join(' | ')}`));
      }, timeoutMs);
      this.q.push(h);
    });
  }

  private async ensureReady() {
    if (this.ready) return;
    console.log('[elo] engine: sending uci');
    this.write('uci');
    await this.readUntil(l => l === 'uciok');
    console.log('[elo] engine: uciok');
    this.write('isready');
    await this.readUntil(l => l === 'readyok');
    console.log('[elo] engine: readyok');
    this.ready = true;
  }

  async setOptions(opts: Record<string, number | string | boolean>) {
    await this.ensureReady();
    for (const [k, v] of Object.entries(opts)) {
      if (k === 'UCI_Elo') {
        this.write('setoption name UCI_LimitStrength value true');
        this.write(`setoption name UCI_Elo value ${v}`);
      } else if (k === 'MultiPV') {
        this.write(`setoption name MultiPV value ${v}`);
      } else {
        this.write(`setoption name ${k} value ${v}`);
      }
    }
    this.write('isready');
    await this.readUntil(l => l === 'readyok');
  }

  async analyse(args: { fen: string; movetimeMs: number; multiPv: number; finalOnly?: boolean }) {
    await this.ensureReady();
    const { fen, movetimeMs, multiPv } = args;
    this.write('ucinewgame');
    this.write(`position fen ${fen}`);
    this.write(`setoption name MultiPV value ${multiPv}`);
    this.write(`go movetime ${movetimeMs}`);

    const infos: any[] = [];
    let bestMove: string | undefined;

    while (true) {
      const lines = await this.readUntil(l => l.startsWith('bestmove') || l.startsWith('info'));
      for (const l of lines) {
        if (l.startsWith('info ')) {
          const parsed = parseInfo(l);
          if (parsed) infos.push(parsed);
        }
        if (l.startsWith('bestmove')) {
          bestMove = l.split(/\s+/)[1];
          break;
        }
      }
      if (bestMove) break;
    }

    const latestDepth = Math.max(0, ...infos.map(x => x?.depth || 0));
    const finalInfos = infos.filter(x => (x?.depth || 0) === latestDepth);

    const byMove = new Map<string, Cand>();
    const rank = (s: Cand) =>
      typeof s.cp === 'number' ? s.cp : (typeof s.mate === 'number' ? (s.mate > 0 ? 10000 : -10000) : -1e9);

    for (const inf of finalInfos) {
      const uci = inf?.pv?.[0] || bestMove;
      if (!uci) continue;
      const cur: Cand = { uci, cp: inf?.score?.cp, mate: inf?.score?.mate, pv: inf?.pv };
      const prev = byMove.get(uci);
      if (!prev || rank(cur) > rank(prev)) byMove.set(uci, cur);
    }
    const cands = Array.from(byMove.values());
    if (!cands.length && bestMove) cands.push({ uci: bestMove });

    const turn = new Chess(fen).turn() as Color;
    return { sideToMove: turn, cands };
  }
}

function parseInfo(line: string) {
  const t = line.split(/\s+/);
  const out: any = {};
  for (let i = 0; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') out.depth = parseInt(t[++i] || '0', 10);
    else if (k === 'multipv') out.multipv = parseInt(t[++i] || '1', 10);
    else if (k === 'score') {
      const tp = t[++i];
      const v = parseInt(t[++i] || '0', 10);
      out.score = tp === 'cp' ? { cp: v } : { mate: v };
    } else if (k === 'pv') {
      out.pv = t.slice(i + 1); break;
    }
  }
  return out;
}

// ---------------- Openings ----------------
const DEFAULT_FENS: string[] = [
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
  'r1bqkbnr/pppp1ppp/2n5/4p3/3P4/5NP1/PPP1PPBP/RNBQK2R b KQkq - 2 4',
  'rnbqkb1r/pp2pppp/5n2/2pp4/3P4/2P1PN2/PP3PPP/RNBQKB1R w KQkq - 0 4',
  'r1bq1rk1/pppp1ppp/2n2n2/4p3/3P4/2P1PN2/PP3PPP/RNBQKB1R w KQ - 2 5',
  'r2qkbnr/ppp2ppp/2np4/4p3/3P4/2P1PN2/PP3PPP/RNBQKB1R w KQkq - 0 5',
];

function loadFens(): string[] {
  if (FENS_FILE) {
    const abs = path.resolve(FENS_FILE);
    if (fs.existsSync(abs)) {
      const list = fs.readFileSync(abs, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (list.length) return list;
    }
  }
  return DEFAULT_FENS;
}

// ------------- Helpers -------------
const bandDefaultElo = (b: string): number =>
  b === 'beginner' ? 700 : b === 'developing' ? 900 : b === 'intermediate' ? 1150 : b === 'advanced' ? 1500 : 1900;

const eloDiffFromScore = (p: number) => {
  const clampP = Math.max(0.01, Math.min(0.99, p));
  return 400 * Math.log10(clampP / (1 - clampP));
};

// ------------- Try to load your app's review logic -------------
async function loadAppReview(): Promise<null | ((x: any) => Promise<any>)> {
  if (NO_REVIEW) return null;
  const candidates = [
    '../webui/src/review/analyzeGame',
    '../webui/src/review/review',
    '../webui/src/analysis/analyzeGame',
    '../webui/src/analysis/review',
    '../webui/src/review/index',
  ];
  const names = ['analyzeGameWithAppLogic','analyzeGame','reviewGame','runPostGameReview','review','default'];
  for (const base of candidates) {
    try {
      const mod = await import(base);
      for (const n of names) {
        const fn = (mod as any)[n];
        if (typeof fn === 'function') return fn.bind(mod);
      }
    } catch { /* try next */ }
    try {
      const mod = await import(base + '.js');
      for (const n of names) {
        const fn = (mod as any)[n];
        if (typeof fn === 'function') return fn.bind(mod);
      }
    } catch { /* try next */ }
  }
  console.warn('[elo] review: no app review module found (run with --noReview to hide this).');
  return null;
}

// ---------------- MAIN ----------------
async function main() {
  // 1) Import your real picker (TS/JS, NodeNext resolves .ts or .js)
  let pickMove!: (fen: string, targetElo?: number, opts?: any) => Promise<string>;
  let setEngine!: (e: Engine) => void;
  try { ({ pickMove, setEngine } = await import('../webui/src/botPicker')); }
  catch { ({ pickMove, setEngine } = await import('../webui/src/botPicker.js')); }

  // 2) Engine + minimal baseline options (picker controls per-move params)
  const eng = new UciEngine();
  setEngine(eng);
  await eng.setOptions({ Threads: 2, Hash: 128, UCI_LimitStrength: true });

  // 3) Optional: your app's review pipeline (exact logic)
  const appReview = await loadAppReview();

  const fens = loadFens();
  const Aname = ELO_A ? `Elo${ELO_A}` : BAND_A ? `Band:${BAND_A}` : 'A';
  const Bname = ELO_B ? `Elo${ELO_B}` : BAND_B ? `Band:${BAND_B}` : 'B';
  const Aelo = ELO_A ? parseInt(ELO_A, 10) : (BAND_A ? bandDefaultElo(BAND_A) : 1200);
  const Belo = ELO_B ? parseInt(ELO_B, 10) : (BAND_B ? bandDefaultElo(BAND_B) : 1200);

  let scoreA = 0, played = 0;
  let winsA = 0, winsB = 0, draws = 0;
  const pgnStream = fs.createWriteStream(PGN_PATH, { flags: 'w' });

  // Accumulate per-side review stats *as reported by your app's analyzer*
  const accReview = { A: [] as any[], B: [] as any[] };

  for (let g = 0; g < GAMES; g++) {
    const fen0 = fens[g % fens.length];
    const game = new Chess(fen0);
    const moves: string[] = [];
    let ply = 0;

    while (!game.isGameOver() && ply < MAX_MOVES) {
      const fen = game.fen();
      const who = game.turn(); // 'w'|'b'
      const elo = (who === 'w') ? Aelo : Belo;
      const uci = await pickMove(fen, elo, { moves });
      const mv = game.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: (uci[4] || undefined) as any } as any);
      if (!mv) throw new Error(`Illegal move from picker: ${uci} in FEN ${fen}`);
      moves.push(uci);
      ply++;
    }

    // Game result from White POV; then map to side A by alternating colors
    let whiteScore = 0.5;
    if (game.isCheckmate()) {
      const winnerIsWhite = game.turn() === 'b';
      whiteScore = winnerIsWhite ? 1 : 0;
    }
    const AwasWhite = (g % 2 === 0);
    const scoreThis = AwasWhite ? whiteScore : (1 - whiteScore);
    scoreA += scoreThis; played++;
    if (scoreThis === 1) winsA++;
    else if (scoreThis === 0) winsB++;
    else draws++;

    // Write PGN with minimal headers
    const resultTag = whiteScore === 1 ? '1-0' : whiteScore === 0 ? '0-1' : '1/2-1/2';
    const whiteName = AwasWhite ? Aname : Bname;
    const blackName = AwasWhite ? Bname : Aname;
    const needsFen = fen0 !== new Chess().fen();
    const now = new Date(); const yyyy = now.getUTCFullYear(); const mm = String(now.getUTCMonth()+1).padStart(2,'0'); const dd = String(now.getUTCDate()).padStart(2,'0');
    const dateTag = `${yyyy}.${mm}.${dd}`;
    game.header('Event','Self-Play Elo Test','Site','Local','Date',dateTag,'Round',String(g+1),'White',whiteName,'Black',blackName,'Result',resultTag);
    if (needsFen) { game.header('SetUp','1'); game.header('FEN', fen0); }
    const pgnText = game.pgn({ max_width: 80, newline_char: '\n' });
    pgnStream.write(pgnText + '\n\n');

    // Optional: call *your app's* review/analyzer for ACPL/ACC/Elo (exact same logic)
    if (appReview) {
      try {
        const review = await appReview({ pgn: pgnText, engine: eng });
        // Heuristic mapping: accept several shapes returned by app analyzers
        // Expected: review.perSide.white/black.{acpl,acc,elo?}
        if (review?.perSide?.white && review?.perSide?.black) {
          const recA = AwasWhite ? review.perSide.white : review.perSide.black;
          const recB = AwasWhite ? review.perSide.black : review.perSide.white;
          accReview.A.push(recA); accReview.B.push(recB);
        } else if (review?.white && review?.black) {
          const recA = AwasWhite ? review.white : review.black;
          const recB = AwasWhite ? review.black : review.white;
          accReview.A.push(recA); accReview.B.push(recB);
        } else {
          // If your analyzer returns a different shape, it still ran with exact app logic.
          accReview.A.push({ raw: review });
          accReview.B.push({ raw: review });
        }
      } catch (e) {
        console.warn(`[elo] review: analyzer threw for game ${g+1}:`, (e as Error)?.message || e);
      }
    }

    if ((g + 1) % 10 === 0) console.log(`[elo] progress ${g + 1}/${GAMES}`);
  }

  // Summary
  const p = scoreA / played;
  const D = eloDiffFromScore(p);

  // If we collected app review metrics, reduce them to averages
  const avg = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const flatten = (xs:any[], key:string) => xs.map(x => (typeof x?.[key] === 'number') ? x[key] : NaN).filter(Number.isFinite) as number[];

  const result: any = {
    games: played,
    A: Aname, B: Bname,
    scoreA: Number(p.toFixed(3)),
    eloDiffAminusB: Math.round(D),
    pgn: PGN_PATH,
    notes: 'Positive means A stronger than B. Uses *app* picker logic; review uses *app* analyzer when available.'
  };

  if (!NO_REVIEW && (accReview.A.length || accReview.B.length)) {
    const acplA = avg(flatten(accReview.A, 'acpl'));
    const acplB = avg(flatten(accReview.B, 'acpl'));
    const accA = avg(flatten(accReview.A, 'acc'));
    const accB = avg(flatten(accReview.B, 'acc'));
    const eloA = avg(flatten(accReview.A, 'elo'));
    const eloB = avg(flatten(accReview.B, 'elo'));
    result.perSide = {
      A: { configuredElo: ELO_A ? parseInt(ELO_A,10) : (BAND_A ? bandDefaultElo(BAND_A) : undefined),
           acpl: Number((acplA||0).toFixed(1)),
           acc: Number((accA||0).toFixed(1)),
           reviewElo: Number.isFinite(eloA) ? Math.round(eloA) : undefined },
      B: { configuredElo: ELO_B ? parseInt(ELO_B,10) : (BAND_B ? bandDefaultElo(BAND_B) : undefined),
           acpl: Number((acplB||0).toFixed(1)),
           acc: Number((accB||0).toFixed(1)),
           reviewElo: Number.isFinite(eloB) ? Math.round(eloB) : undefined }
    };
  }

  console.log(JSON.stringify(result, null, 2));
  console.log(
    `[elo] ${Aname} vs ${Bname}: wins ${winsA}-${winsB}, draws ${draws}, ` +
    `score ${scoreA.toFixed(1)}/${played}, Elo diff ${Math.round(D)} (PGN -> ${PGN_PATH})`
  );
  pgnStream.end();
  try {
    await finished(pgnStream);
  } catch (err) {
    console.warn('[elo] warning: failed to flush PGN stream:', (err as Error)?.message || err);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
