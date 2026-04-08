// Electron engine bridge for Stockfish (UCI)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { bookSize, identifyOpeningFromBook } = require('./book');

// Conservative defaults to keep memory tight on low-RAM machines.
const DEFAULT_THREADS = 2;
const DEFAULT_HASH_MB = 128;
const MIN_HASH_MB = 64;
const MAX_HASH_MB = 256;
const MAX_MULTIPV = 8;
const PV_LIMIT = 10; // cap PV stored in memory/UI

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

function trimPv(pv, limit = PV_LIMIT) {
  if (!Array.isArray(pv)) return [];
  return pv.slice(0, Math.max(1, limit | 0));
}

function parseInfoLine(line) {
  // depth/multipv/score/pv (enough to humanize selection)
  const out = {};
  const mDepth = /\bdepth\s+(\d+)/.exec(line);
  if (mDepth) out.depth = Number(mDepth[1]);
  const mPvIdx = /\bmultipv\s+(\d+)/.exec(line);
  if (mPvIdx) out.multipv = Number(mPvIdx[1]);
  const mCp = /\bscore\s+cp\s+(-?\d+)/.exec(line);
  if (mCp) out.cp = Number(mCp[1]);
  const mMate = /\bscore\s+mate\s+(-?\d+)/.exec(line);
  if (mMate) out.mate = Number(mMate[1]);
  const mPv = /\spv\s+(.+)$/.exec(line);
  if (mPv) out.pv = trimPv(mPv[1].trim().split(/\s+/));
  return Object.keys(out).length ? out : null;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function pickThreads(requested) {
  const env = Number(process.env.ENGINE_THREADS);
  if (Number.isFinite(env) && env > 0) return Math.max(1, Math.floor(env));
  if (Number.isFinite(requested) && requested > 0) return Math.max(1, Math.floor(requested));
  return DEFAULT_THREADS;
}
function pickHashMb(requested) {
  const env = Number(process.env.ENGINE_HASH_MB);
  const raw = Number.isFinite(env) ? env : requested;
  return clamp(Math.round(raw || DEFAULT_HASH_MB), MIN_HASH_MB, MAX_HASH_MB);
}

// Softmax sampling among candidate moves with cp (higher better)
function softmaxSample(cands, temperature = 0.6) {
  if (!Array.isArray(cands) || !cands.length) return null;
  const t = Math.max(0.05, Number(temperature) || 0.6);
  const maxCp = Math.max(...cands.map((c) => c.cp));
  const exps = cands.map((c) => Math.exp((c.cp - maxCp) / (100 * t)));
  const sum = exps.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < cands.length; i++) {
    r -= exps[i];
    if (r <= 0) return cands[i];
  }
  return cands[cands.length - 1];
}

function applyDefaultStrength(send) {
  try { send('setoption name UCI_LimitStrength value false'); } catch {}
  try { send('setoption name Skill Level value 20'); } catch {}
  try { send('setoption name Contempt value 0'); } catch {}
  try { send('setoption name MultiPV value 1'); } catch {}
  try { send(`setoption name Hash value ${DEFAULT_HASH_MB}`); } catch {}
  try { send(`setoption name Threads value ${DEFAULT_THREADS}`); } catch {}
  try { send('setoption name Ponder value false'); } catch {}
}

/* --------------------------- opening book helpers --------------------------- */

const BOOK_MAX_PLY = 24; // only trust early-game depth floor
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

  // --- UCI init ---
  send('uci');
  await waitLine((l) => l === 'uciok', 10000);
  applyDefaultStrength(send);
  const desiredThreads = Number(process.env.ENGINE_THREADS) || threads || DEFAULT_THREADS;
  const desiredHash = Number(process.env.ENGINE_HASH_MB) || hash || DEFAULT_HASH_MB;
  const baseThreads = Math.max(1, Math.min(4, Math.floor(desiredThreads)));
  const baseHashMb = Math.max(MIN_HASH_MB, Math.min(MAX_HASH_MB, Math.floor(desiredHash)));
  send(`setoption name Threads value ${baseThreads}`);
  send(`setoption name Hash value ${baseHashMb}`);
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
      bookEntries: (typeof bookSize === 'function' ? bookSize() : 0),
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

      send('setoption name MultiPV value 1');
      send('setoption name UCI_LimitStrength value true');
      send(`setoption name UCI_Elo value ${Math.max(400, Math.min(2500, Math.floor(currentElo)))}`);
      send('setoption name Skill Level value 20');
      send('setoption name Contempt value 0');
      try { send('setoption name Analysis Contempt value Both'); } catch {}
      try { send('setoption name Ponder value false'); } catch {}

      // Consistent defaults across ladder
      send(`setoption name Threads value ${baseThreads}`);
      send(`setoption name Hash value ${baseHashMb}`);

      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});
      limitOn = true;
      return { ok: true, eloApplied: currentElo, limitStrength: true };
    });
  }

  function movetimeForElo(elo) {
    const e = Math.max(800, Math.min(2500, Math.floor(Number(elo) || 1500)));
    const points = [
      [800, 180],
      [1000, 210],
      [1200, 240],
      [1500, 280],
      [1800, 320],
      [2000, 360],
      [2200, 420],
      [2400, 480],
      [2500, 520],
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

  async function analyzeFen({
    fen,
    movetimeMs = 250,
    multiPv = 1,
    useBook = false,
    bookMaxFullMoves = 16,
    forceDepthFloor = false,
    strong = false,
  }) {
    const exec = () => runSearch({
      fen,
      movetimeMs,
      multiPv,
      allowBook: useBook,
      collectScore: false,
      forceDepthFloor,
      bookMaxFullMoves,
    });
    return strong ? withStrongAnalysis(exec) : exec();
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
      movetimeMs = 250,
      multiPv = 1,
      allowBook = true,
      // allowBook is retained for compatibility; JSON/Polyglot move selection is disabled.
      collectScore = false,
      forceDepthFloor = false,
      bookMaxFullMoves = 16,
      bookSample = false,
      verifyBookMs = 300,
      humanMode = false,
      human = null,
    } = opts || {};

    const openingPly = plyFromFen(fen);
    const multiPvBudget = Math.max(1, Math.min(MAX_MULTIPV, Number(multiPv) || 1));

    return enqueue(async () => {
      const infos = [];
      let lastScore = null;
      let lastInfoTs = 0;
      const off = on((l) => {
        if (l.startsWith('info ')) {
          const parsed = parseInfoLine(l);
          if (parsed) {
            const now = Date.now();
            const last = infos[infos.length - 1];
            const samePv = last && (last.multipv ?? 1) === (parsed.multipv ?? 1);
            const sameDepth = last && (last.depth ?? 0) === (parsed.depth ?? 0);
            if (infos.length && (now - lastInfoTs) < 80 && samePv && sameDepth) {
              infos[infos.length - 1] = parsed;
            } else {
              infos.push(parsed);
            }
            lastInfoTs = now;
          }
          if (collectScore) {
            const s = quickScoreFromInfo(l);
            if (s) lastScore = s;
          }
        }
      });

      // ensure fresh search
      send('stop');
      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});

      send(`setoption name MultiPV value ${multiPvBudget}`);
      send(`position fen ${fen}`);

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
        let bestMove = m ? m[1] : null;

        // Human-mode: sample among near-equals if requested
        if (humanMode && Array.isArray(infos) && infos.length) {
          const latestDepth = Math.max(...infos.map((x) => x.depth || 0));
          const finalInfos = infos.filter((x) => (x.depth || 0) === latestDepth && Array.isArray(x.pv) && x.pv.length);
          const byMove = new Map();
          for (const inf of finalInfos) {
            const mv = inf.pv[0];
            if (!mv) continue;
            const cp = (typeof inf.cp === 'number')
              ? inf.cp
              : (typeof inf.mate === 'number' ? (inf.mate > 0 ? 10000 : -10000) : 0);
            if (!byMove.has(mv) || byMove.get(mv).cp < cp) byMove.set(mv, { uci: mv, cp });
          }
          const cands = Array.from(byMove.values()).sort((a, b) => b.cp - a.cp);
          const maxPickDelta = Number(human?.maxPickDeltaCp ?? 60);
          const topCp = cands.length ? cands[0].cp : null;
          const near = (topCp == null)
            ? []
            : cands.filter((c) => (topCp - c.cp) <= maxPickDelta)
                   .slice(0, multiPvBudget);
          const temp = Number(human?.temperature ?? 0.6);
          const pick = softmaxSample(
            near.length ? near : cands.slice(0, multiPvBudget),
            temp
          );
          if (pick?.uci) bestMove = pick.uci;

          // Optionally pick a controlled imperfection: a move slightly worse than best but not a blunder.
          const imperfectRate = Math.max(0, Math.min(1, Number(human?.imperfectRate ?? 0)));
          const imperfectMinDrop = Math.max(0, Number(human?.imperfectMinDropCp ?? 0));
          const imperfectMaxDrop = Math.max(imperfectMinDrop, Number(human?.imperfectMaxDropCp ?? 0));
          const anchorMove = cands.length ? cands[0].uci : bestMove;
          if (imperfectRate > 0 && topCp != null && cands.length > 1 && Math.random() < imperfectRate) {
            const withDiff = cands
              .map((c) => ({ ...c, diff: topCp - c.cp }))
              .filter((c) => c.diff > 0 && c.uci !== anchorMove)
              .filter((c) => c.diff >= imperfectMinDrop && (imperfectMaxDrop > 0 ? c.diff <= imperfectMaxDrop : true));
            const pool = withDiff.length
              ? withDiff
              : cands
                  .map((c) => ({ ...c, diff: topCp - c.cp }))
                  .filter((c) => c.diff > 0 && c.uci !== anchorMove);
            if (pool.length) {
              const ranked = pool.sort((a, b) => a.diff - b.diff);
              const take = ranked.slice(0, Math.min(3, ranked.length));
              const imperfect = take[Math.floor(Math.random() * take.length)];
              if (imperfect?.uci) bestMove = imperfect.uci;
            }
          }

          // Optional rare blunder
          const blunderRate = Math.max(0, Math.min(1, Number(human?.blunderRate ?? 0)));
          const blunderMaxCp = Number(human?.blunderMaxCp ?? 250);
          if (blunderRate > 0 && Math.random() < blunderRate && cands.length > 1 && topCp != null) {
            const minDrop = 70; // target mild blunder ≥0.7 pawn
            const candidates = cands
              .map((c) => ({ ...c, diff: topCp - c.cp }))
              .filter((c) => c.diff >= minDrop && c.diff <= blunderMaxCp)
              .sort((a, b) => a.diff - b.diff);
            if (candidates.length) {
              // Bias toward the least-bad few options
              const idx = Math.min(candidates.length - 1, Math.floor(Math.random() * 2));
              const pickBad = candidates[idx];
              if (pickBad?.uci) bestMove = pickBad.uci;
            }
          }
        }

        return { bestMove, infos, score: lastScore, book: false };
      } finally {
        if (depthTimer) { try { clearTimeout(depthTimer); } catch {} }
        off();
      }
    });
  }

  async function analyzeOnce({ fen, movetimeMs = 200 }) {
    const res = await runSearch({
      fen,
      movetimeMs: Math.max(120, movetimeMs),
      multiPv: 1,
      allowBook: false,
      collectScore: true,
      forceDepthFloor: false,
      bookMaxFullMoves: 16,
    });
    return { bestMove: res?.bestMove || null, score: res?.score || null };
  }

  async function reviewPositionsFast(fens, opts = {}) {
    const pass1Time = opts.pass1Ms ?? 200;
    const pass2Time = opts.pass2Ms ?? 320;
    const swingCp = opts.swingCp ?? 120;
    const maxDeepen = opts.maxDeepen ?? 12;
    const strong = !!opts.strong;

    const run = async () => {
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
    };

    return strong ? withStrongAnalysis(run) : run();
  }

  async function reviewPgn(args /* { pgn, ... } */) {
    // Run analysis with limiter off for quality
    return withStrongAnalysis(async () => {
      // Plug in your existing review logic here (loop over positions, etc.)
      return { ok: true, result: null };
    });
  }

  async function identifyOpening(fen) {
    if (typeof identifyOpeningFromBook !== 'function') return null;
    try {
      return identifyOpeningFromBook(fen) || null;
    } catch {
      return null;
    }
  }

  async function quit() {
    try { send('quit'); } catch {}
    try { child.kill('SIGTERM'); } catch {}
  }

  return {
    getCapabilities,
    applyStrength,
    analyzeFen,
    reviewPgn,
    reviewPositionsFast,
    identifyOpening,
    quit,
  };
}

module.exports = { createEngine };
