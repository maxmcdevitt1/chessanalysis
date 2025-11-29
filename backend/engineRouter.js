// backend/engineRouter.js
const { StockfishEngine } = require('./engine/stockfish');

const stockfish = new StockfishEngine(process.env.STOCKFISH_BIN || 'stockfish', {
  threads: Number(process.env.SF_THREADS || '2'),
  defaultMultiPv: Number(process.env.SF_DEFAULT_MULTIPV || '3'),
});

async function analyzeFen(fen, { movetimeMs, multiPv }) {
  return stockfish.analyzeFen(fen, { movetimeMs, multiPv });
}

module.exports = { analyzeFen };
