const { spawn } = require('child_process');
const readline = require('readline');

function spawnEngine(binPath) {
  const child = spawn(binPath, [], { stdio: ['pipe','pipe','pipe'] });
  child.on('error', (e) => console.error('[engine spawn error]', e));
  const rl = readline.createInterface({ input: child.stdout });
  const listeners = new Set();
  rl.on('line', (line) => { for (const fn of listeners) fn(line); });
  child.stderr.on('data', (buf) => console.warn('[engine stderr]', String(buf)));
  const send = (s) => child.stdin.write(s + '\n');
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  return { child, send, on };
}

function waitLine(on, predicate, timeoutMs=8000) {
  return new Promise((resolve, reject) => {
    const off = on((l)=>{ if (predicate(l)) { clearTimeout(t); off(); resolve(l); } });
    const t = setTimeout(() => { off(); reject(new Error('uci-timeout')); }, timeoutMs);
  });
}

async function createEngine({ bin='stockfish', threads=1, hash=128 }={}) {
  const e = spawnEngine(bin);
  const send = e.send;
  const on = e.on;

  let chain = Promise.resolve();
  function enqueue(task) {
    chain = chain.then(task, task);
    return chain;
  }

  async function init() {
    send('uci');      await waitLine(on, l => l === 'uciok').catch(()=>{});
    send('isready');  await waitLine(on, l => l === 'readyok').catch(()=>{});
    send(`setoption name Threads value ${threads}`);
    send(`setoption name Hash value ${hash}`);
    send('isready');  await waitLine(on, l => l === 'readyok').catch(()=>{});
  }
  await init();

  function parseInfos(lines) {
    const out = [];
    for (const l of lines) {
      if (!l.startsWith('info ')) continue;
      const mPv = l.match(/multipv\s+(\d+)/);
      const pvIdx = mPv ? parseInt(mPv[1],10) : 1;
      const mMate = l.match(/score\s+mate\s+(-?\d+)/);
      const mCp = l.match(/score\s+cp\s+(-?\d+)/);
      const pv = (l.split(' pv ')[1] || '').trim();
      let type=null, score=null;
      if (mMate) { type='mate'; score=Number(mMate[1]); }
      else if (mCp) { type='cp'; score=Number(mCp[1]); }
      out[pvIdx-1] = { type, score, pv, raw: l };
    }
    return out.filter(Boolean);
  }

  async function analyzeFen({ fen, movetimeMs=400, multiPv=1 }) {
    return enqueue(async () => {
      const lines = [];
      const off = on((l)=>{ if (l.startsWith('info ')) lines.push(l); });
      send('stop');
      send('isready'); await waitLine(on, l => l === 'readyok').catch(()=>{});
      send(`setoption name MultiPV value ${multiPv}`);
      send(`position fen ${fen}`);
      send(`go movetime ${movetimeMs}`);
      const best = await waitLine(on, l => l.startsWith('bestmove')).catch((e)=>{
        off(); throw e;
      });
      off();
      const m = /bestmove\s+(\S+)/.exec(best);
      const bestMove = m ? m[1] : null;
      const infos = parseInfos(lines);
      return { bestMove, infos };
    });
  }

  async function reviewPgn({ pgn, movetimeMs=200, multiPv=1 }) {
    return enqueue(async () => ({ ok: true }));
  }

  async function quit() { try { send('quit'); } catch {} }

  return { analyzeFen, reviewPgn, quit };
}

module.exports = { createEngine };
