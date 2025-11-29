// inprogress/electron/coachBridge.js
'use strict';

const { ipcMain } = require('electron');
const http = require('http');
const https = require('https');

const DEFAULT_MODEL = process.env.COACH_MODEL || 'qwen3:4b-instruct';
const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://127.0.0.1:11434';
const TIMEOUT_MS   = Number(process.env.COACH_TIMEOUT_MS || 30000); // allow cold starts

/** Minimal request helper (http/https, body, timeout). */
function httpRequest(url, { method = 'POST', headers = {}, body = null, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + (u.search || ''),
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function fmt(n) {
  return typeof n === 'number' && isFinite(n) ? Math.round(n) : '-';
}

function buildPrompt(inputs) {
  const summary = inputs?.summary || {};
  const moments = Array.isArray(inputs?.moments) ? inputs.moments : [];
  const pgn = inputs?.pgn;

  const head =
    `Opening: ${summary.opening ?? 'Unknown'}; ` +
    `WhiteAcc: ${fmt(summary.whiteAcc)}%; BlackAcc: ${fmt(summary.blackAcc)}%; ` +
    `AvgCPL(W/B): ${fmt(summary.avgCplW)} / ${fmt(summary.avgCplB)}.`;

  const lines = moments.map((m) => {
    const delta = m?.cpAfter != null && m?.cpBefore != null ? m.cpAfter - m.cpBefore : 'n/a';
    const side = (m?.side || '').toString().toUpperCase().startsWith('W') ? 'W' : 'B';
    return `#${m.moveNo}${side} ${m.san} [${m.tag}] Δcp=${delta}; best=${m.best ?? '-'}; idx=${m.index}`;
  });

  return [
    head,
    'Return ONLY JSON array of objects: {"type":"intro"|"move"|"summary","text":string,"moveIndex"?:number}.',
    'Each text <= 140 chars. Include moveIndex=idx when commenting a move. Prefer Mistake/Blunder and turning points.',
    'Moments:',
    ...lines,
    pgn ? '\nPGN (truncated):\n' + String(pgn).slice(0, 5000) : '',
  ].join('\n');
}

function tryParseArray(s) {
  try {
    const v = JSON.parse(String(s || ''));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function sanitizeNotes(arr) {
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 24) return null;
  const out = [];
  for (const o of arr) {
    if (!o || typeof o !== 'object') return null;
    const type = o.type;
    const text = o.text;
    if (typeof text !== 'string' || text.length < 1 || text.length > 140) return null;
    if (type === 'intro' || type === 'summary') {
      out.push({ type, text });
    } else if (type === 'move') {
      const idx = o.moveIndex;
      if (!Number.isInteger(idx) || idx < 0) return null;
      out.push({ type, moveIndex: idx, text });
    } else {
      return null;
    }
  }
  return out;
}

function registerCoachIpc() {
  ipcMain.handle('coach:generate', async (_e, payload) => {
    const inputs = payload?.inputs || {};
    const body = {
      model: DEFAULT_MODEL,
      stream: false,
      system:
        'You are a concise chess coach. Produce brief notes (<=140 chars). ' +
        'Explain big eval swings and missed tactics. No markdown, no preambles.',
      prompt: buildPrompt(inputs),
      format: 'json',
      options: { temperature: 0.2, num_ctx: 2048, num_predict: 160 },
    };

    try {
      const res = await httpRequest(
        `${OLLAMA_URL}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error(`ollama status ${res.status}`);

      const envelope = JSON.parse(res.text);         // { response: "<json or text>", ... }
      const raw = String(envelope?.response || '').trim();
      const arr = tryParseArray(raw);
      const notes = sanitizeNotes(arr || []);
      if (!notes) throw new Error('invalid coach JSON');

      return { notes };
    } catch (e) {
      console.error('[coach] error:', e && (e.stack || e.message || e));
      return { offline: true };
    }
  });
}

module.exports = { registerCoachIpc };

