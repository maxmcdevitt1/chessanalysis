// Electron engine bridge for Stockfish (UCI)
const { spawn } = require('child_process');
const readline = require('readline');
const os = require('os');

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
function pickThreads() {
  const cores = Math.max(1, os.cpus()?.length || 2);
  return clamp(cores <= 4 ? cores : Math.floor(cores * 0.75), 2, 8);
}

/* ---------------------- engine lifecycle & API ----------------------- */

async function createEngine({ bin, threads = 2, hash = 128 }) {
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
  const threadCount = pickThreads();
  send(`setoption name Threads value ${threadCount}`);
  send('setoption name Hash value 512');
  send('setoption name MultiPV value 1');
  try { send('setoption name UCI_AnalyseMode value true'); } catch {}
  try { send('setoption name Ponder value false'); } catch {}
  send('isready');
  await waitLine((l) => l === 'readyok', 10000);

  async function getCapabilities() {
    // naive probe; Stockfish 16 supports these options
    return {
      engineId: 'Stockfish 16',
      hasLimitStrength: true,
      hasElo: true,
      hasSkillLevel: true,
    };
  }

  /* --------------------- strength & time management --------------------- */

  let currentElo = 1500;
  let limitOn = false;

  async function applyStrength(elo = 1500) {
    return enqueue(async () => {
      currentElo = Number(elo) || 1500;

      const MIN_ELO = 800;
      const MAX_ELO = 2500;
      const clamped = Math.max(MIN_ELO, Math.min(MAX_ELO, Math.floor(currentElo)));

      send('stop');
      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});

      send('setoption name MultiPV value 1');
      send('setoption name UCI_LimitStrength value true');
      send(`setoption name UCI_Elo value ${clamped}`);
      send('setoption name Skill Level value 20');
      send('setoption name Contempt value 0');
      try { send('setoption name Analysis Contempt value Both'); } catch {}
      try { send('setoption name Ponder value false'); } catch {}

      send('setoption name Threads value 2');
      send('setoption name Hash value 256');

      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});
      limitOn = true;
      return { ok: true, eloApplied: clamped };
    });
  }

  function movetimeForElo(elo) {
    const e = Math.max(800, Math.min(2500, Math.floor(Number(elo) || 1500)));
    const points = [
      [800, 300],
      [1200, 450],
      [1600, 800],
      [2000, 1500],
      [2200, 2200],
      [2400, 3200],
      [2500, 3800],
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
      send('setoption name Threads value 2');
      send('setoption name Hash value 256');
      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});
      return await fn();
    } finally {
      await applyStrength(prevElo).catch(() => {});
      limitOn = prevLimit;
    }
  }

  /* -------------------------- search operations -------------------------- */

  async function analyzeFen({ fen, movetimeMs = 400, multiPv = 1 }) {
    return enqueue(async () => {
      const infos = [];
      const off = on((l) => {
        if (l.startsWith('info ')) {
          const parsed = parseInfoLine(l);
          if (parsed) infos.push(parsed);
        }
      });

      // ensure fresh search
      send('stop');
      send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});

      send(`setoption name MultiPV value ${multiPv}`);
      send(`position fen ${fen}`);
      send(`go movetime ${movetimeMs}`);

      const best = await waitLine((l) => l.startsWith('bestmove'));
      off();

      const m = /bestmove\s+(\S+)/.exec(best);
      const bestMove = m ? m[1] : null;
      return { bestMove, infos };
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

  async function analyzeOnce({ fen, movetimeMs = 120 }) {
    const off = on(() => {});
    send('stop');
    send('isready'); await waitLine((l) => l === 'readyok').catch(() => {});

    send('position fen ' + fen);
    send('go movetime ' + Math.max(60, movetimeMs));

    let lastScore = null;
    const off2 = on((l) => {
      const s = quickScoreFromInfo(l);
      if (s) lastScore = s;
    });

    const best = await waitLine((l) => l.startsWith('bestmove'));
    off(); off2();

    const m = /bestmove\s+(\S+)/.exec(best);
    const bestMove = m ? m[1] : null;
    return { bestMove, score: lastScore };
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
    return analyzeFen({ fen, movetimeMs: ms, multiPv });
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
