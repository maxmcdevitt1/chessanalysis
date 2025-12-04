'use strict';

const { ipcMain } = require('electron');
const http = require('http');
const https = require('https');

/* ------------------------------- Config ----------------------------------- */

const DEFAULT_MODEL = process.env.COACH_MODEL || 'llama3.2:3b-instruct-q5_K_M';
const COACH_DEBUG = process.env.COACH_DEBUG === '1';
const BATCH_PLIES = parseInt(process.env.COACH_BATCH_PLIES || '12', 10); // per-call plies
const TOKENS_PER_ITEM = parseInt(process.env.COACH_TOKENS_PER_ITEM || '90', 10);
const COACH_OUTPUT_MODE = (process.env.COACH_OUTPUT_MODE || 'ndjson').toLowerCase(); // 'ndjson' or 'array'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const TIMEOUT_MS = Number(process.env.COACH_TIMEOUT_MS || 30000);
const AUTO_PULL = String(process.env.AUTO_PULL_COACH || '0') === '1';

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const fmt = (n) => (Number.isFinite(n) ? Math.round(n) : '-');

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
    return common.concat(['Return ONLY a JSON ARRAY with EXACTLY N objects, SAME ORDER.']).join(' ');
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

async function callModelStructured({ model, prompt, expected }) {
  const body = {
    model,
    stream: false,
    system: buildSystemPrompt(),
    prompt,
    ...(COACH_OUTPUT_MODE === 'array' ? { format: 'json' } : {}),
    options: {
      temperature: 0.1,
      top_p: 0.85,
      top_k: 40,
      repeat_penalty: 1.05,
      num_ctx: 4096,
      num_predict: Math.max(180, TOKENS_PER_ITEM * Math.max(1, expected || 1)),
      stop: ['\n#', '\nN='],
    },
    keep_alive: '45m',
  };
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const raw = String(json?.response || '');
  if (COACH_DEBUG) {
    console.log(`[coach] call len=${prompt.length} chars; response chars=${raw.length}`);
  }
  const tryParse = (txt) => {
    try { return JSON.parse(txt); } catch { return null; }
  };

  // Candidate payloads to inspect
  const candidates = [];
  if (Array.isArray(json)) candidates.push(json);
  if (json && typeof json === 'object') {
    if (Array.isArray(json.response)) candidates.push(json.response);
    if (typeof json.response === 'string') candidates.push(json.response);
  }

  let parsed = null;
  for (const c of candidates) {
    if (Array.isArray(c)) { parsed = c; break; }
    if (typeof c === 'string') {
      // 1) direct parse
      parsed = tryParse(c);
      if (Array.isArray(parsed)) break;
      // 2) first '[' .. last ']'
      const a = c.indexOf('['), b = c.lastIndexOf(']');
      if (a >= 0 && b > a) {
        const sub = tryParse(c.slice(a, b + 1));
        if (Array.isArray(sub)) { parsed = sub; break; }
      }
      // 3) line-by-line JSON
      const lines = c.split(/\r?\n/);
      for (const line of lines) {
        const v = tryParse(line);
        if (Array.isArray(v)) { parsed = v; break; }
      }
      if (Array.isArray(parsed)) break;
    }
  }

  // NDJSON: parse each line into an object
  const asItems = [];
  if (Array.isArray(parsed)) asItems.push(...parsed);
  else if (typeof parsed === 'object' && parsed) asItems.push(parsed);
  else {
    const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      const v = tryParse(line);
      if (v) asItems.push(v);
    }
  }

  if (!asItems.length) {
    if (COACH_DEBUG) {
      console.error('[coach] JSON parse failed. Raw model output (first 1500 chars):\n',
        raw.slice(0, 1500));
    }
    return [];
  }
  return asItems;
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
    } catch (e) {
      console.error('[coach] model error:', e.message);
      items = [];
    }
    let norm = normalizeItems(items, batch);
    // Fallback: if the model gave nothing usable, emit empty stubs to avoid “offline”
    if (!norm.length) {
      norm = batch.map((m, i) => ({
        moveIndex: Number.isFinite(m.idx) ? m.idx : (Number.isFinite(m.ply) ? m.ply : i),
        title: '',
        text: '',
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
      const model = String(inputs?.model || DEFAULT_MODEL);
      const available = await ensureModelAvailable(model);
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
