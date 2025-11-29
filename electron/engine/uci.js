// inprogress/electron/engine/uci.js
const { spawn } = require('child_process');
const readline = require('readline');

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
  // Very small parser: pull cp or mate if present
  // Examples:
  // info depth 13 seldepth 19 multipv 1 score cp 23 nodes ... pv e2e4 ...
  // info depth ... score mate 3 ...
  const out = {};
  const mCp = /\bscore\s+cp\s+(-?\d+)/.exec(line);
  if (mCp) out.cp = Number(mCp[1]);
  const mMate = /\bscore\s+mate\s+(-?\d+)/.exec(line);
  if (mMate) out.mate = Number(mMate[1]);
  return Object.keys(out).length ? out : null;
}

async function createEngine({ bin, threads = 1, hash = 128 }) {
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
        if (matchFn(l)) {
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
  await waitLine((l) => l.trim() === 'uciok', 10000);
  send(`setoption name Threads value ${threads}`);
  send(`setoption name Hash value ${hash}`);
  send('isready');
  await waitLine((l) => l.trim() === 'readyok', 10000);

  async function getCapabilities() {
    // naive probe; Stockfish 16 supports these options
    return {
      engineId: 'Stockfish 16',
      hasLimitStrength: true,
      hasElo: true,
      hasSkillLevel: true,
    };
  }

async function applyStrength(elo = 1000) {
  return enqueue(async () => {
    const MIN_ELO = 1320, MAX_ELO = 3190;               // Stockfish clamp range
    const clamped = Math.max(MIN_ELO, Math.min(MAX_ELO, Math.floor(elo)));

    send('stop');
    send('isready'); await waitLine(l => l === 'readyok').catch(()=>{});

    send('setoption name UCI_LimitStrength value true');
    send(`setoption name UCI_Elo value ${clamped}`);

    // map clamped Elo → Skill Level 0..20
    const skill = Math.max(0, Math.min(20, Math.round((clamped - MIN_ELO) / (MAX_ELO - MIN_ELO) * 20)));
    send(`setoption name Skill Level value ${skill}`);

    send('isready'); await waitLine(l => l === 'readyok').catch(()=>{});
    return { ok: true, eloRequested: elo, eloApplied: clamped, skill };
  });
}

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
      send('isready'); await waitLine((l)=>l==='readyok').catch(()=>{});

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

  async function moveWeak({ fen, movetimeMs = 300, multiPv = 1 }) {
    // Reuse analyzeFen so it's guaranteed to resolve from 'bestmove'
    return analyzeFen({ fen, movetimeMs, multiPv });
  }

  async function reviewPgn(/* { pgn, ... } */) {
    // Optional: left as a no-op for now
    return { ok: true, result: null };
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
    quit,
  };
}

module.exports = { createEngine };

