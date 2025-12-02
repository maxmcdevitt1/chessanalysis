'use strict';

const { ipcMain } = require('electron');
const http = require('http');
const https = require('https');

/* ------------------------------- Config ----------------------------------- */

const DEFAULT_MODEL = process.env.COACH_MODEL || 'llama3.2:3b-instruct-q5_K_M';
const COACH_DEBUG = process.env.COACH_DEBUG === '1';
const BATCH_PLIES = parseInt(process.env.COACH_BATCH_PLIES || '14', 10);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const TIMEOUT_MS = Number(process.env.COACH_TIMEOUT_MS || 30000);
const AUTO_PULL = String(process.env.AUTO_PULL_COACH || '0') === '1';

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
  return [
    'You are a concise chess coach. Output JSON only. No markdown.',
    'Do NOT change provided tags or numbers.',
    'For each input line `#<idx> <SAN> [<tag>] Δcp=<delta>; best=<uci>; idx=<idx>` you must produce one JSON object.',
    'Return a JSON ARRAY with EXACTLY N objects, in the SAME ORDER.',
    'Each object MUST be: { "moveIndex": <idx>, "title": <<=60 chars>, "text": <<=280 chars> }',
  ].join(' ');
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
  return [
    head,
    `N=${expected}`,
    'Respond with a JSON array of length N. One object per line in the same order.',
    lines.join('\n'),
  ].join('\n');
}

async function callModelJSON({ model, prompt, options }) {
  const body = {
    model,
    stream: false,
    system: buildSystemPrompt(),
    prompt,
    format: 'json',
    options: {
      temperature: 0.1,
      top_p: 0.85,
      top_k: 40,
      repeat_penalty: 1.05,
      num_ctx: 4096,
      num_predict: Math.max(options?.num_predict ?? 0, 80 * (options?.expected ?? 1)),
    },
    keep_alive: '45m',
  };
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  let parsed;
  try { parsed = JSON.parse(json.response); } catch {}
  if (!parsed) {
    const s = String(json.response || '');
    const a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a >= 0 && b > a) {
      try { parsed = JSON.parse(s.slice(a, b + 1)); } catch {}
    }
  }
  if (!Array.isArray(parsed)) {
    if (COACH_DEBUG) {
      console.error('[coach] JSON parse failed. Raw model output (first 1500 chars):\n',
        String(json.response || '').slice(0, 1500));
    }
    return [];
  }
  return parsed;
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

    const items = await callModelJSON({ model, prompt, options: { expected } });
    const norm = normalizeItems(items, batch);
    if (COACH_DEBUG) console.log(`[coach] batch ${b + 1} got ${norm.length} items`);
    all.push(...norm);
  }

  all.sort((a, b) => a.moveIndex - b.moveIndex);
  if (COACH_DEBUG && all.length === 0) {
    console.error('[coach] ERROR: model returned 0 items across all batches');
  }
  return { notes: all, offline: all.length === 0 };
}

/* ---------------------------------- IPC ----------------------------------- */

function registerCoachIpc() {
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
}

module.exports = {
  registerCoachIpc,
  generateNotes,
};
