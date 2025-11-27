// backend/engine/stockfish.js
// Simple Stockfish UCI driver that returns { bestMove, infos[] }.
const { spawn } = require('node:child_process');

class StockfishEngine {
  constructor(bin = 'stockfish', opts = {}) {
    this.bin = bin;
    this.opts = opts;
    this.p = null;
    this.buf = '';
    this.readyOk = false;
  }

  async _waitFor(token) {
    while (true) {
      if (this.buf.includes(token)) return;
      await new Promise(r => setTimeout(r, 10));
    }
  }

  async ready() {
    if (this.readyOk) return;
    this.p = spawn(this.bin, [], { stdio: 'pipe' });
    this.p.stdout.setEncoding('utf8');
    this.p.stdout.on('data', d => (this.buf += d));
    this.p.stdin.write('uci\n');
    await this._waitFor('uciok');

    // Recommended defaults; let server override via env.
    const threads = Number(this.opts.threads || 2);
    this.p.stdin.write(`setoption name Threads value ${threads}\n`);

    // MultiPV is set per-analyze call, but a default helps.
    const defaultMpv = Number(this.opts.defaultMultiPv || 3);
    this.p.stdin.write(`setoption name MultiPV value ${defaultMpv}\n`);

    this.p.stdin.write('isready\n');
    await this._waitFor('readyok');
    this.readyOk = true;
  }

  async analyzeFen(fen, { movetimeMs, multiPv }) {
    await this.ready();
    this.buf = '';

    this.p.stdin.write('ucinewgame\n');
    this.p.stdin.write(`position fen ${fen}\n`);
    if (Number(multiPv) > 0) {
      this.p.stdin.write(`setoption name MultiPV value ${Number(multiPv)}\n`);
    }
    this.p.stdin.write(`go movetime ${Number(movetimeMs || 1000)}\n`);

    const infos = [];
    let best = null;

    // read until bestmove
    while (true) {
      const chunk = this.buf; this.buf = '';
      const lines = chunk.split('\n');
      for (const ln of lines) {
        if (!ln) continue;
        if (ln.startsWith('bestmove')) {
          best = ln.split(/\s+/)[1] || null;
          return { bestMove: best, infos };
        }
        if (ln.startsWith('info ')) {
          // Parse: info depth 20 multipv 2 score cp 34 pv e2e4 e7e5 ...
          const m = ln.match(/multipv\s+(\d+).*?score\s+(cp|mate)\s+(-?\d+).*?pv\s+(.+)$/);
          if (!m) continue;
          const multipv = Number(m[1]);
          const kind = m[2] === 'mate' ? 'mate' : 'cp';
          const score = Number(m[3]);
          const pvUci = m[4].trim().split(/\s+/);
          infos.push({ type: kind, score, multipv, pvUci });
        }
      }
      await new Promise(r => setTimeout(r, 10));
    }
  }
}

module.exports = { StockfishEngine };
