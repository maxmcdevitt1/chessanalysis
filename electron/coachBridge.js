'use strict';

const { ipcMain } = require('electron');
const http = require('http');
const https = require('https');

/* ------------------------------- Config ----------------------------------- */

// Default model can be overridden via env; use a small, likely-available default and fall back if missing.
const DEFAULT_MODEL = process.env.COACH_MODEL || 'llama3.2:3b-instruct-q5_K_M';
const FALLBACK_MODEL = 'llama3.1:8b-instruct-q5_K_M';
const COACH_DEBUG = process.env.COACH_DEBUG === '1';
// Keep batches small to improve adherence to "N items" instruction
const BATCH_PLIES = parseInt(process.env.COACH_BATCH_PLIES || '8', 10); // per-call plies
// Increase tokens-per-item to reduce truncation
const TOKENS_PER_ITEM = parseInt(process.env.COACH_TOKENS_PER_ITEM || '130', 10);
// Default to array for more predictable parsing; ndjson still supported via env
const COACH_OUTPUT_MODE = (process.env.COACH_OUTPUT_MODE || 'array').toLowerCase(); // 'ndjson' or 'array'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const TIMEOUT_MS = Number(process.env.COACH_TIMEOUT_MS || 60000);
const AUTO_PULL = String(process.env.AUTO_PULL_COACH || '1') === '1';

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function log(...args) { if (COACH_DEBUG) console.log('[coach]', ...args); }

// Node18+ global fetch ok in Electron main; polyfill if you need older
// (v18 ships fetch; keep a fallback for safety)
let _fetch = global.fetch;
if (!_fetch) {
  try { _fetch = require('node-fetch'); } catch {}
}

function fmt(n) { return Number.isFinite(n) ? Math.round(n) : '-'; }

async function fetchText(body) {
  // Prefer fetch if available; otherwise fall back to our httpRequest helper.
  if (_fetch) {
    const res = await _fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error(`ollama status ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }
  // Fallback: non-streaming HTTP helper
  const res = await httpRequest(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  return res.text || '';
}

/* ------------------------------ HTTP helper ------------------------------- */

function httpRequest(url, { method = 'POST', headers = {}, body = null, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      { protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.pathname + (u.search || ''), method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

async function listModels() {
  try {
    const res = await httpRequest(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    if (!res.ok) return null;
    const data = JSON.parse(res.text || '{}');
    return Array.isArray(data?.models) ? data.models : [];
  } catch { return null; }
}

async function ensureModelAvailable(model) {
  const models = await listModels();
  const found = !!models?.some((m) => m?.name === model);
  if (found) return true;
  if (!AUTO_PULL) return false;
  try {
    const res = await httpRequest(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      timeout: Math.max(TIMEOUT_MS, 10 * 60 * 1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* -------------------------------- Prompt ---------------------------------- */

function buildSystemPrompt() {
  const common = [
    'You are a concise chess coach. Be specific and encouraging.',
    'For each input line `#<ply><W|B> <SAN> [<tag>] Δcp=<delta>; best=<uci>; idx=<idx>` produce ONE coaching object.',
    'Schema: { "moveIndex": <idx>, "title": string (<=60 chars), "text": string (<=280 chars) }',
    'Do NOT change provided tags or numbers. No markdown.',
  ];
  if (COACH_OUTPUT_MODE === 'array') {
    return common.concat([
      'Return ONLY a JSON ARRAY with EXACTLY N objects, SAME ORDER.',
      'Conform strictly to the provided JSON schema.',
    ]).join(' ');
  }
  return common.concat(['Return ONLY NDJSON: EXACTLY N LINES, each line is ONE JSON object. No brackets, no commas, no prose.']).join(' ');
}

function buildPromptHead(summary) {
  return `Summary: ${summary?.opening || 'Unknown opening'} | Acc: W ${summary?.wAcc ?? '-'} / B ${summary?.bAcc ?? '-'}\n`;
}

function buildBatchPrompt({ summary, batch, expected }) {
  const head = buildPromptHead(summary);
  const lines = batch.map((m, i) => {
    const idx = Number.isFinite(m.idx) ? m.idx : (m.ply ?? i);
    return `#${m.ply}${m.color === 'w' ? 'W' : 'B'} ${m.san} [${m.tag}] Δcp=${m.deltaCp}; best=${m.bestUci}; idx=${idx}`;
  });
  if (COACH_OUTPUT_MODE === 'array') {
    return [head, `N=${expected}`, 'Respond with a JSON array of length N (SAME ORDER).', ...lines].join('\n');
  }
  return [head, `N=${expected}`, 'Respond with NDJSON: EXACTLY N lines, each a JSON object (SAME ORDER).', ...lines].join('\n');
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function tryParseArrayCandidates(cands) {
  for (const c of cands) {
    if (!c) continue;
    if (Array.isArray(c)) return c;
    if (typeof c === 'string') {
      const parsed = tryParse(c);
      if (Array.isArray(parsed)) return parsed;
      const a = c.indexOf('['), b = c.lastIndexOf(']');
      if (a >= 0 && b > a) {
        const sub = c.slice(a, b + 1);
        const parsedSub = tryParse(sub);
        if (Array.isArray(parsedSub)) return parsedSub;
      }
    }
  }
  return null;
}

async function callModelStructured({ model, prompt, expected }) {
  const baseBody = {
    model,
    stream: false, // explicit non-stream for array mode
    system: buildSystemPrompt(),
    prompt,
    options: {
      temperature: 0.1,
      top_p: 0.85,
      top_k: 40,
      repeat_penalty: 1.05,
      num_ctx: 4096,
      num_predict: Math.max(220, TOKENS_PER_ITEM * Math.max(1, expected || 1)),
      stop: ['\n#', '\nN='],
    },
    keep_alive: '45m',
  };

  const attempts = [];
  if (COACH_OUTPUT_MODE === 'array') {
    attempts.push({
      desc: 'array-schema',
      body: {
        ...baseBody,
        format: {
          type: 'json_schema',
          json_schema: {
            name: 'CoachNotes',
            schema: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['moveIndex', 'title', 'text'],
                properties: {
                  moveIndex: { type: 'integer' },
                  title: { type: 'string', maxLength: 60 },
                  text: { type: 'string', maxLength: 280 },
                },
              },
            },
          },
        },
      },
    });
    attempts.push({ desc: 'array-json', body: { ...baseBody, format: 'json' } });
    attempts.push({ desc: 'array-plain', body: { ...baseBody, format: undefined } });
    // Final fallback: NDJSON streaming
    attempts.push({ desc: 'ndjson', body: { ...baseBody, stream: true, format: undefined } });
  } else {
    // NDJSON-first if mode=ndjson
    attempts.push({ desc: 'ndjson', body: { ...baseBody, stream: true, format: undefined } });
    attempts.push({ desc: 'array-json', body: { ...baseBody, stream: false, format: 'json' } });
    attempts.push({ desc: 'array-plain', body: { ...baseBody, stream: false, format: undefined } });
  }

  let lastRawSample = '';
  for (const attempt of attempts) {
    let rawText = '';
    try {
      rawText = await fetchText(attempt.body);
    } catch (err) {
      console.error('[coach] fetch error', attempt.desc, err && (err.stack || err.message || err));
      continue;
    }
    if (!lastRawSample) {
      lastRawSample = rawText ? rawText.slice(0, 400) : '';
    }
    if (COACH_DEBUG) {
      console.log(`[coach] call (${attempt.desc}) len=${prompt.length} chars; response chars=${rawText.length}`);
    }

    const candidates = [];
    if (COACH_OUTPUT_MODE === 'ndjson') {
      candidates.push(rawText);
    } else {
      try {
        const json = JSON.parse(rawText);
        if (Array.isArray(json)) candidates.push(json);
        if (json && typeof json === 'object') {
          if (Array.isArray(json.response)) candidates.push(json.response);
          if (typeof json.response === 'string') candidates.push(json.response);
          if (Array.isArray(json.message?.content)) candidates.push(json.message.content);
          if (typeof json.message?.content === 'string') candidates.push(json.message.content);
        }
      } catch {
        candidates.push(rawText);
      }
    }

    const parsedArray = tryParseArrayCandidates(candidates);
    if (Array.isArray(parsedArray)) {
      return parsedArray.slice(0, expected);
    }

    // NDJSON-like fallback: parse each line into an object
    const asItems = [];
    const lines = rawText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      const v = tryParse(line);
      if (v) asItems.push(v);
    }
    if (asItems.length) {
      return asItems.slice(0, expected);
    }
  }

  console.error('[coach] model error: no valid JSON (array/ndjson). expected:', expected, 'raw sample:', lastRawSample || 'null');
  // Return empty stubs to avoid breaking UI flow
  return Array.from({ length: Math.max(0, expected | 0) }, (_, i) => ({ moveIndex: i, title: '', text: '' }));
}

function normalizeItems(items, batch) {
  const byOrderIdx = batch.map((m) => (Number.isFinite(m.idx) ? m.idx : m.ply));
  return items
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({
      moveIndex: Number.isFinite(Number(it.moveIndex))
        ? Number(it.moveIndex)
        : (Number.isFinite(Number(it.idx)) ? Number(it.idx) : undefined),
      title: String(it.title || '').slice(0, 60),
      text: String(it.text || '').slice(0, 280),
      type: 'move',
    }))
    .map((it, i) => ({
      ...it,
      moveIndex: Number.isFinite(it.moveIndex) ? it.moveIndex : byOrderIdx[i],
    }))
    .filter((it) => Number.isFinite(it.moveIndex));
}

/* --------------------------------- Coach ---------------------------------- */

async function generateNotes(inputs) {
  const model = inputs?.model || DEFAULT_MODEL;
  const moments = Array.isArray(inputs?.moments) ? inputs.moments : [];
  const summary = inputs?.summary || {};

  if (COACH_DEBUG) {
    console.log(`[coach] model=${model} total_plies=${moments.length}`);
  }

  const batches = chunk(moments, BATCH_PLIES);
  const all = [];

  for (let b = 0; b < batches.length; b++) {
    const batchRaw = batches[b];
    const expected = batchRaw.length;
    const batch = batchRaw.map((m, idx) => {
      const cpBefore = Number.isFinite(m?.cpBefore) ? Number(m.cpBefore) : null;
      const cpAfter = Number.isFinite(m?.cpAfter) ? Number(m.cpAfter) : null;
      const deltaCp = cpAfter != null && cpBefore != null ? cpAfter - cpBefore : 'n/a';
      return {
        ply: Number.isInteger(m?.index) ? m.index : idx,
        idx: Number.isInteger(m?.index) ? m.index : idx,
        color: String(m?.side || m?.color || (m?.index % 2 === 0 ? 'W' : 'B')).toLowerCase().startsWith('w') ? 'w' : 'b',
        san: m?.san || '',
        tag: m?.tag || '',
        deltaCp,
        bestUci: m?.best || '-',
      };
    });

    const prompt = buildBatchPrompt({ summary, batch, expected });
    if (COACH_DEBUG) {
      console.log(`[coach] batch ${b + 1}/${batches.length} idx ${batch[0]?.idx ?? 0}..${batch[batch.length - 1]?.idx ?? batch.length - 1} expected=${expected}`);
      console.log(`[coach] prompt preview:\n${prompt.slice(0, 800)}\n---`);
    }

    let items = [];
    try {
      items = await callModelStructured({ model, prompt, expected });
      // If the model still gave nothing, retry once with half batch size (more focused)
      if (!items.length && expected > 1) {
        if (COACH_DEBUG) console.warn('[coach] retrying batch with smaller size due to empty result');
        const half = Math.max(1, Math.floor(expected / 2));
        const head = batch.slice(0, half);
        const prompt2 = buildBatchPrompt({ summary, batch: head, expected: head.length });
        const items2 = await callModelStructured({ model, prompt: prompt2, expected: head.length });
        items = items2;
      }
    } catch (e) {
      console.error('[coach] model error:', e && (e.stack || e.message || e));
      items = [];
    }
    let norm = normalizeItems(items, batch);
    // Fallback: if the model gave nothing usable, emit empty stubs to avoid “offline”
    if (!norm.length) {
      norm = batch.map((m, i) => ({
        moveIndex: Number.isFinite(m.idx) ? m.idx : (Number.isFinite(m.ply) ? m.ply : i),
        title: `Move ${(Number.isFinite(m.ply) ? m.ply : i) + 1}: ${m.san || ''}`,
        text: `${(m.tag || 'Move')} — Δcp=${m.deltaCp ?? 'n/a'}`,
        type: 'move',
      }));
    }
    if (COACH_DEBUG) console.log(`[coach] batch ${b + 1} got ${norm.length} items`);
    all.push(...norm);
  }

  all.sort((a, b) => a.moveIndex - b.moveIndex);
  return { notes: all, offline: false };
}

/* ---------------------------------- IPC ----------------------------------- */

let __coachIpcReady = false;
function registerCoachIpc() {
  // Dev/HMR safe: clear any existing handlers first
  try { ipcMain.removeHandler('coach:generate'); } catch {}
  try { ipcMain.removeHandler('coach:ping'); } catch {}
  ipcMain.handle('coach:generate', async (_e, payload) => {
    try {
      const inputs = payload?.inputs || {};
      let model = String(inputs?.model || DEFAULT_MODEL);
      let available = await ensureModelAvailable(model);
      if (!available && FALLBACK_MODEL) {
        log(`model ${model} missing; trying fallback ${FALLBACK_MODEL}`);
        const ok = await ensureModelAvailable(FALLBACK_MODEL);
        if (ok) { model = FALLBACK_MODEL; available = true; }
      }
      if (!available) {
        console.error(`[coach] model not available: ${model}. Install with: ollama pull ${model}`);
        return { offline: true, reason: 'model-missing', model };
      }
      const res = await generateNotes({ ...inputs, model });
      return res || { offline: true };
    } catch (e) {
      console.error('[coach] error:', e && (e.stack || e.message || e));
      return { offline: true, reason: 'exception' };
    }
  });
  ipcMain.handle('coach:ping', async () => ({ ok: true, ping: 'coach' }));
  __coachIpcReady = true;
}

module.exports = {
  registerCoachIpc,
  generateNotes,
};
