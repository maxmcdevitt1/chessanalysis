// backend/server.js
// Minimal local Engine API (Stockfish) with a standardized response shape.
const express = require('express');
const cors = require('cors');
const { analyzeFen } = require('./engineRouter');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// health
app.get('/health', (_req, res) => res.json({ ok: true }));

// canonical endpoint
app.post('/api/engine/analyze', async (req, res) => {
  const { fen, movetimeMs = 1200, multiPv = 3 } = req.body || {};
  if (!fen) return res.status(400).json({ error: 'fen required' });
  try {
    const out = await analyzeFen(fen, { movetimeMs, multiPv });
    const payload = {
      bestMove: out?.bestMove ?? null,
      infos: Array.isArray(out?.infos)
        ? out.infos.map(i => ({
            type: i.type === 'mate' ? 'mate' : 'cp',
            score: Number(i.score),
            multipv: Number(i.multipv),
            pvUci: Array.isArray(i.pvUci) ? i.pvUci : []
          }))
        : []
    };
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// legacy alias with deprecation headers
app.post('/fen/analyze', (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Wed, 30 Apr 2025 23:59:59 GMT');
  res.set('Link', '</api/engine/analyze>; rel=\"successor-version\"');
  next();
}, async (req, res) => {
  // delegate to canonical handler logic
  const { fen, movetimeMs = 1200, multiPv = 3 } = req.body || {};
  if (!fen) return res.status(400).json({ error: 'fen required' });
  try {
    const out = await analyzeFen(fen, { movetimeMs, multiPv });
    const payload = {
      bestMove: out?.bestMove ?? null,
      infos: Array.isArray(out?.infos)
        ? out.infos.map(i => ({
            type: i.type === 'mate' ? 'mate' : 'cp',
            score: Number(i.score),
            multipv: Number(i.multipv),
            pvUci: Array.isArray(i.pvUci) ? i.pvUci : []
          }))
        : []
    };
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const port = process.env.PORT || 8788;
app.listen(port, () => console.log(`Engine server listening on :${port}`));
