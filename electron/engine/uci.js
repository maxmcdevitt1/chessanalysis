// Electron engine bridge for Stockfish (UCI)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');
const { probeBookMove: probeBookMoveExternal, bookSize } = require('./book');

/* --------------------- process & small utilities --------------------- */

function createStockfish(binPath) {
  const child = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.on('error', (e) => console.error('[uci] spawn error', e));
  const rl = readline.createInterface({ input: child.stdout });
  return { child, rl };
}

function makeQueue() {
  let p = Promise.resolve();
  const enqueue = (fn) => (p = p.then(fn, fn));
  return enqueue;
}

function parseInfoLine(line) {
  // pull cp or mate if present
  const out = {};
  const mCp = /\bscore\s+cp\s+(-?\d+)/.exec(line);
  if (mCp) out.cp = Number(mCp[1]);
  const mMate = /\bscore\s+mate\s+(-?\d+)/.exec(line);
  if (mMate) out.mate = Number(mMate[1]);
  return Object.keys(out).length ? out : null;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function pickThreads(requested) {
  const env = Number(process.env.ENGINE_THREADS);
  if (Number.isFinite(env) && env > 0) return Math.max(1, Math.floor(env));
  if (Number.isFinite(requested) && requested > 0) return Math.max(1, Math.floor(requested));
  const cores = Math.max(1, os.cpus()?.length || 2);
  return Math.max(4, cores);
}
function pickHashMb(requested) {
  const env = Number(process.env.ENGINE_HASH_MB);
  const raw = Number.isFinite(env) ? env : requested;
  // Keep in the sane 1–4 GB window unless the caller overrides via env/arg.
  return clamp(Math.round(raw || 1024), 1024, 4096);
}

function applyDefaultStrength(send) {
  try { send('setoption name UCI_LimitStrength value false'); } catch {}
  try { send('setoption name Skill Level value 20'); } catch {}
  try { send('setoption name Contempt value 0'); } catch {}
  try { send('setoption name MultiPV value 1'); } catch {}
  try { send('setoption name Hash value 1024'); } catch {}
  try {
    const cores = Math.max(4, os.cpus()?.length || 4);
    send(`setoption name Threads value ${cores}`);
  } catch {}
}

/* --------------------------- opening book helpers --------------------------- */

const ROOT_DIR = path.join(__dirname, '..', '..');
const BOOK_MAX_PLY = 24; // only trust early-game book guidance
const EARLY_PLY_DEPTH_FLOOR = 20;
const EARLY_DEPTH_TIMEOUT_MS = 6000;

function plyFromFen(fen) {
  try {
    const parts = String(fen || '').trim().split(/\s+/);
    const moveNum = Number(parts[5]) || 1;
    const stm = (parts[1] || 'w').startsWith('b') ? 'b' : 'w';
    return (moveNum - 1) * 2 + (stm === 'b' ? 1 : 0);
  } catch {
    return 0;
  }
}

function normFenKey(fen) {
  const parts = String(fen || '').trim().split(/\s+/);
  return parts.slice(0, 4).join(' ');
}

function pgnToSanTokens(pgn) {
  if (!pgn) return [];
  let s = String(pgn);
  s = s
    .replace(/\[.*?\]\s*/g, ' ')                 // headers
    .replace(/\{[^}]*\}/g, ' ')                  // {comments}
    .replace(/\([^)]*\)/g, ' ')                  // (variations)
    .replace(/\$\d+/g, ' ')                      // NAGs
    .replace(/\b1-0\b|\b0-1\b|\b1\/2-1\/2\b|\*/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\d+…/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.split(' ').filter(Boolean) : [];
}

function toUciLine(row, ChessCtor) {
  // uci array
  if (Array.isArray(row?.uci) && row.uci.length) {
    return row.uci.map(String).filter(m => /^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(m));
  }
  // uci space-separated
  if (typeof row?.uci === 'string' && row.uci.trim()) {
    return row.uci.split(/\s+/).filter(m => /^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(m));
  }

  // san[] / moves[] / pgn
  let san = [];
  if (Array.isArray(row?.san) && row.san.length) san = row.san;
  else if (Array.isArray(row?.moves) && row.moves.length) san = row.moves;
  else if (typeof row?.pgn === 'string' && row.pgn.trim()) san = pgnToSanTokens(row.pgn);
  if (!san.length) return [];

  const ch = new ChessCtor();
  const uci = [];
  for (const tokRaw of san) {
    const tok = String(tokRaw || '').replace(/[+#?!]+/g, '');
    const m = ch.move(tok, { sloppy: true });
    if (!m) break;
    uci.push(m.from + m.to + (m.promotion ? m.promotion : ''));
  }
  return uci;
}

function loadOpeningBook() {
  try {
    // chess.js is bundled as a devDependency; bail gracefully if missing in dev envs.
    const { Chess } = require('chess.js');
    const candidates = [
      path.join(ROOT_DIR, 'data', 'opening-book.json'),
      path.join(ROOT_DIR, 'webui', 'public', 'opening-book.json'),
      path.join(ROOT_DIR, 'webui', 'public', 'eco.json'),
      path.join(ROOT_DIR, 'webui', 'public', 'eco1.json'),
    ];
    let rows = [];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(parsed) && parsed.length) rows = rows.concat(parsed);
      } catch {
        // ignore malformed sources
      }
    }
    if (!rows.length) {
      console.warn('[book] no opening sources found; skipping book probe');
      return null;
    }

    const tmp = new Map(); // fenKey -> Map<uci, weight>
    for (const r of rows) {
      const line = toUciLine(r, Chess);
      if (!line.length) continue;
      const ch = new Chess();
      for (let i = 0; i < line.length && i < BOOK_MAX_PLY; i++) {
        const fenKey = normFenKey(ch.fen());
        const move = line[i];
        tmp.set(fenKey, tmp.get(fenKey) || new Map());
        const bucket = tmp.get(fenKey);
        bucket.set(move, (bucket.get(move) || 0) + 1);
        const mv = { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move.slice(4) || undefined };
        if (!ch.move(mv)) break;
      }
    }

    const book = new Map();
    for (const [fenKey, moves] of tmp.entries()) {
      const arr = Array.from(moves.entries()).map(([uci, weight]) => ({ uci, weight }));
      arr.sort((a, b) => b.weight - a.weight);
      book.set(fenKey, arr);
    }
    console.log('[book] loaded entries:', book.size);
    return book;
  } catch (e) {
    console.warn('[book] disabled (chess.js missing?)', e?.message || e);
    return null;
  }
}

function probeBookMoveLocal(book, fen) {
  if (!book) return null;
  const key = normFenKey(fen);
  const moves = book.get(key);
  if (!moves || !moves.length) return null;
  return moves;
}

/* ---------------------- engine lifecycle & API ----------------------- */

async function createEngine({ bin, threads, hash } = {}) {
  const { child, rl } = createStockfish(bin);

  const listeners = new Set();
  rl.on('line', (line) => {
    // console.log('[uci <<]', line);
    for (const fn of listeners) {
      try { fn(line); } catch {}
    }
  });

  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function send(cmd) {
    // console.log('[uci >>]', cmd);
    child.stdin.write(cmd + '\n');
  }

  function waitLine(matchFn, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const off = on((l) => {
        if (matchFn(l.trim())) {
          clear();
          resolve(l);
        }
      });
      const t = setTimeout(() => {
        clear();
        reject(new Error('uci waitLine timeout'));
      }, timeoutMs);
      function clear() {
        try { clearTimeout(t); } catch {}
        off();
      }
    });
  }

  const enqueue = makeQueue();
  const openingBook = loadOpeningBook();

  // --- UCI init ---
  send('uci');
  await waitLine((l) => l === 'uciok', 10000);
  applyDefaultStrength(send);
  const threadCount = pickThreads(threads);
  const hashMb = pickHashMb(hash);
  const baseThreads = threadCount;
  const baseHashMb = hashMb;
  send(`setoption name Threads value ${threadCount}`);
  send(`setoption name Hash value ${hashMb}`);
  send('setoption name MultiPV value 1');
  send('setoption name UCI_LimitStrength value false');
  send('setoption name Skill Level value 20');
  send('setoption name Contempt value 0');
  try { send('setoption name UCI_AnalyseMode value true'); } catch {}
  try { send('setoption name Ponder value false'); } catch {}
  send('isready');
  await waitLine((l) => l === 'readyok', 10000);

  async function getCapabilities() {
    // naive probe; Stockfish 16 supports these options
    return {
      engineId: 'Stockfish 16 (analysis)',
      hasLimitStrength: true,
      hasElo: true,
      hasSkillLevel: false,
      threads: baseThreads,
      hashMb: baseHashMb,
      bookEntries: (typeof bookSize === 'function' ? bookSize() : (openingBook?.size || 0)),
    };
  }

  /* --------------------- strength & time management --------------------- */

  let currentElo = 2000;
  let limitOn = true;

  async function applyStrength(elo = 1500) {
    return enqueue(async () => {
      currentElo = Number(elo) || 2000;

      send('stop');
      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});

      const MIN_ELO = 400;
      const MAX_ELO = 2500;
      const clamped = Math.max(MIN_ELO, Math.min(MAX_ELO, Math.floor(currentElo)));
      const lowElo = clamped <= 900;
      const midElo = clamped <= 1400;

      send('setoption name MultiPV value 1');
      send('setoption name UCI_LimitStrength value true');
      send(`setoption name UCI_Elo value ${clamped}`);
      const skill = lowElo ? 1 : (midElo ? 5 : 20);
      send(`setoption name Skill Level value ${skill}`);
      send('setoption name Contempt value 0');
      try { send('setoption name Analysis Contempt value Both'); } catch {}
      try { send('setoption name Ponder value false'); } catch {}

      const threadsForElo = lowElo ? 1 : (midElo ? Math.max(1, Math.min(baseThreads, 2)) : baseThreads);
      const hashForElo = lowElo ? Math.min(baseHashMb, 256) : (midElo ? Math.min(baseHashMb, 512) : baseHashMb);
      send(`setoption name Threads value ${threadsForElo}`);
      send(`setoption name Hash value ${hashForElo}`);

      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});
      limitOn = true;
      return { ok: true, eloApplied: clamped, limitStrength: true };
    });
  }

  function movetimeForElo(elo) {
    const e = Math.max(800, Math.min(2500, Math.floor(Number(elo) || 1500)));
    const points = [
      [800, 200],
      [1200, 350],
      [1600, 650],
      [2000, 1100],
      [2200, 1500],
      [2400, 2000],
      [2500, 2400],
    ];
    for (let i = 0; i < points.length - 1; i++) {
      const [e0, t0] = points[i];
      const [e1, t1] = points[i + 1];
      if (e >= e0 && e <= e1) {
        const k = (e - e0) / (e1 - e0);
        return Math.round(t0 + k * (t1 - t0));
      }
    }
    return e < points[0][0] ? points[0][1] : points[points.length - 1][1];
  }

  async function withStrongAnalysis(fn) {
    // Temporarily disable limit for accurate review
    const prevElo = currentElo;
    const prevLimit = limitOn;
    try {
      send('stop');
      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});
      send('setoption name UCI_LimitStrength value false');
      send('setoption name Skill Level value 20');
      send('setoption name MultiPV value 1');
      send(`setoption name Threads value ${baseThreads}`);
      send(`setoption name Hash value ${baseHashMb}`);
      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});
      return await fn();
    } finally {
      await applyStrength(prevElo).catch(() => {});
      limitOn = prevLimit;
    }
  }

  /* -------------------------- search operations -------------------------- */

  async function analyzeFen({ fen, movetimeMs = 400, multiPv = 1, useBook = true, bookMaxFullMoves = 16, forceDepthFloor = false }) {
    return runSearch({
      fen,
      movetimeMs,
      multiPv,
      allowBook: useBook,
      collectScore: false,
      forceDepthFloor,
      bookMaxFullMoves,
    });
  }

  // Parse cp/mate from info lines quickly
  function quickScoreFromInfo(line) {
    if (!line.startsWith('info ')) return null;
    const mMate = /\bscore\s+mate\s+(-?\d+)/.exec(line);
    if (mMate) return { type: 'mate', value: Number(mMate[1]) };
    const mCp = /\bscore\s+cp\s+(-?\d+)/.exec(line);
    if (mCp) return { type: 'cp', value: Number(mCp[1]) };
    return null;
  }

  async function runSearch(opts) {
    const {
      fen,
      movetimeMs = 400,
      multiPv = 1,
      allowBook = true,
      collectScore = false,
      forceDepthFloor = false,
      bookMaxFullMoves = 16,
      bookSample = false,
      verifyBookMs = 300,
    } = opts || {};

    return enqueue(async () => {
      if (allowBook) {
        const ext = typeof probeBookMoveExternal === 'function'
          ? probeBookMoveExternal(fen, { maxFullMoves: bookMaxFullMoves })
          : null;
        const localMoves = probeBookMoveLocal(openingBook, fen) || [];
        const candidates = [];
        if (ext?.uci) candidates.push({ uci: ext.uci, weight: ext.weight || 1 });
        for (const m of localMoves) candidates.push({ uci: m.uci, weight: m.weight || 1 });

        const pickWeighted = (arr) => {
          const sum = arr.reduce((s, m) => s + (Number(m.weight) || 1), 0);
          const r = Math.random() * Math.max(sum, 1);
          let acc = 0;
          for (const m of arr) {
            acc += Number(m.weight) || 1;
            if (r <= acc) return m;
          }
          return arr[0];
        };

        const hit = candidates.length
          ? (bookSample && candidates.length > 1 ? pickWeighted(candidates) : candidates[0])
          : null;

        if (hit && hit.uci) {
          console.log('[book] hit', hit.uci, 'fen=', fen);
          if (verifyBookMs > 0) {
            // Run a quick verification search to get a score while keeping the book move.
            const infos = [];
            let lastScore = null;
            const off = on((l) => {
              if (l.startsWith('info ')) {
                const parsed = parseInfoLine(l);
                if (parsed) infos.push(parsed);
                if (collectScore) {
                  const s = quickScoreFromInfo(l);
                  if (s) lastScore = s;
                }
              }
            });

            send('stop');
            send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});
            send(`setoption name MultiPV value ${multiPv}`);
            send(`position fen ${fen}`);
            send(`go movetime ${Math.max(80, verifyBookMs)}`);

            const bestLine = await waitLine((l) => l.startsWith('bestmove'), Math.max(4000, verifyBookMs + 2000));
            off();
            return { bestMove: hit.uci, infos, score: lastScore, book: true, bookMoves: candidates };
          }
          return { bestMove: hit.uci, infos: [], book: true, bookMoves: candidates };
        }
      }

      const infos = [];
      let lastScore = null;
      const off = on((l) => {
        if (l.startsWith('info ')) {
          const parsed = parseInfoLine(l);
          if (parsed) infos.push(parsed);
          if (collectScore) {
            const s = quickScoreFromInfo(l);
            if (s) lastScore = s;
          }
        }
      });

      // ensure fresh search
      send('stop');
      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});

      send(`setoption name MultiPV value ${multiPv}`);
      send(`position fen ${fen}`);

      const openingPly = plyFromFen(fen);
      const forceDeep = forceDepthFloor && openingPly <= BOOK_MAX_PLY;
      const safeMs = Math.max(80, Number(movetimeMs) || 0);
      let depthTimer = null;

      let waitBudget = forceDeep
        ? Math.max(Math.max(safeMs, EARLY_DEPTH_TIMEOUT_MS) + 7000, 25000)
        : Math.max(6000, safeMs + 4000);

      if (forceDeep) {
        const capMs = Math.max(safeMs, EARLY_DEPTH_TIMEOUT_MS);
        send(`go depth ${EARLY_PLY_DEPTH_FLOOR}`);
        depthTimer = setTimeout(() => {
          try { send('stop'); } catch {}
        }, capMs);
      } else {
        // play mode: honor movetime and stop shortly after as a guard
        send(`go movetime ${safeMs}`);
        depthTimer = setTimeout(() => {
          try { send('stop'); } catch {}
        }, safeMs + 2000);
      }

      let best = null;
      try {
        best = await waitLine((l) => l.startsWith('bestmove'), waitBudget);
        const m = /bestmove\s+(\S+)/.exec(best);
        const bestMove = m ? m[1] : null;
        return { bestMove, infos, score: lastScore, book: false };
      } finally {
        if (depthTimer) { try { clearTimeout(depthTimer); } catch {} }
        off();
      }
    });
  }

  async function analyzeOnce({ fen, movetimeMs = 120 }) {
    const res = await runSearch({
      fen,
      movetimeMs: Math.max(60, movetimeMs),
      multiPv: 1,
      allowBook: true,
      collectScore: true,
      forceDepthFloor: false,
      bookMaxFullMoves: 16,
    });
    return { bestMove: res?.bestMove || null, score: res?.score || null };
  }

  async function reviewPositionsFast(fens, opts = {}) {
    const pass1Time = opts.pass1Ms ?? 120;
    const pass2Time = opts.pass2Ms ?? 600;
    const swingCp = opts.swingCp ?? 120;
    const maxDeepen = opts.maxDeepen ?? 12;

    const first = [];
    for (let i = 0; i < fens.length; i++) {
      const r = await analyzeOnce({ fen: fens[i], movetimeMs: pass1Time });
      first.push({ idx: i, ...r });
    }

    const scored = first.map((x) => {
      const cp = x.score?.type === 'cp'
        ? x.score.value
        : (x.score ? (x.score.value > 0 ? 10000 : -10000) : 0);
      return { idx: x.idx, mag: Math.abs(cp) };
    }).sort((a, b) => b.mag - a.mag);

    const revisit = scored.slice(0, maxDeepen)
      .filter((s) => s.mag >= swingCp)
      .map((s) => s.idx);

    const pass2 = new Map();
    for (const idx of revisit) {
      const r = await analyzeOnce({ fen: fens[idx], movetimeMs: pass2Time });
      pass2.set(idx, r);
    }

    const merged = first.map((x) => pass2.get(x.idx) ? { idx: x.idx, ...pass2.get(x.idx) } : x);
    return merged;
  }

  async function moveWeak({ fen, movetimeMs, multiPv = 1 }) {
    // Scale move time by currentElo to avoid too-weak play
    const ms = Math.max(Number(movetimeMs || 0), movetimeForElo(currentElo));
    return runSearch({
      fen,
      movetimeMs: ms,
      multiPv,
      allowBook: true,
      collectScore: false,
      forceDepthFloor: false, // play mode: honor movetime, avoid depth floor timeouts
      bookMaxFullMoves: 16,
      bookSample: currentElo <= 1100, // low Elo: sample weighted book move for variety
    });
  }

  async function reviewPgn(args /* { pgn, ... } */) {
    // Run analysis with limiter off for quality
    return withStrongAnalysis(async () => {
      // Plug in your existing review logic here (loop over positions, etc.)
      return { ok: true, result: null };
    });
  }

  async function quit() {
    try { send('quit'); } catch {}
    try { child.kill('SIGTERM'); } catch {}
  }

  return {
    getCapabilities,
    applyStrength,
    analyzeFen,
    moveWeak,
    reviewPgn,
    reviewPositionsFast,
    quit,
  };
}

module.exports = { createEngine };
