'use strict';

// Opening book helper: tries Polyglot .bin first, then bundled JSON/eco sources.

const fs = require('fs');
const path = require('path');

let Polyglot = null;
try { Polyglot = require('polyglot-book'); } catch {}
if (!Polyglot) { try { Polyglot = require('chess-polyglot'); } catch {} }

const ROOT_DIR = path.join(__dirname, '..', '..');
const DEFAULT_BOOK = path.join(ROOT_DIR, 'data', 'book.bin');
const JSON_SOURCES = [
  path.join(ROOT_DIR, 'data', 'opening-book.json'),
  path.join(ROOT_DIR, 'webui', 'public', 'opening-book.json'),
  path.join(ROOT_DIR, 'webui', 'public', 'eco.json'),
  path.join(ROOT_DIR, 'webui', 'public', 'eco1.json'),
];
const MAX_PLY = 24; // up to 12 full moves

let POLYGLOT_BOOK = null; // false => unavailable, object => ready
let JSON_BOOK_CACHE = null;

function normFenKey(fen) {
  const parts = String(fen || '').trim().split(/\s+/);
  return parts.slice(0, 4).join(' ');
}

function ensurePolyglot(bookPath = DEFAULT_BOOK) {
  if (POLYGLOT_BOOK !== null) return POLYGLOT_BOOK;
  if (!Polyglot) { POLYGLOT_BOOK = false; return POLYGLOT_BOOK; }
  if (!fs.existsSync(bookPath)) { POLYGLOT_BOOK = false; return POLYGLOT_BOOK; }
  try {
    POLYGLOT_BOOK = new Polyglot(bookPath);
  } catch (e) {
    console.warn('[book] polyglot load failed:', e?.message || e);
    POLYGLOT_BOOK = false;
  }
  return POLYGLOT_BOOK;
}

function pgnToSanTokens(pgn) {
  if (!pgn) return [];
  let s = String(pgn);
  s = s
    .replace(/\[.*?\]\s*/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\b1-0\b|\b0-1\b|\b1\/2-1\/2\b|\*/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\d+…/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.split(' ').filter(Boolean) : [];
}

function toUciLine(row, ChessCtor) {
  if (Array.isArray(row?.uci) && row.uci.length) {
    return row.uci.map(String).filter(m => /^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(m));
  }
  if (typeof row?.uci === 'string' && row.uci.trim()) {
    return row.uci.split(/\s+/).filter(m => /^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(m));
  }

  let san = [];
  if (Array.isArray(row?.san) && row.san.length) san = row.san;
  else if (Array.isArray(row?.moves) && row.moves.length) san = row.moves;
  else if (typeof row?.pgn === 'string' && row.pgn.trim()) san = pgnToSanTokens(row.pgn);
  if (!san.length) return [];

  const ch = new (require('chess.js').Chess)();
  const uci = [];
  for (const tokRaw of san) {
    const tok = String(tokRaw || '').replace(/[+#?!]+/g, '');
    const m = ch.move(tok, { sloppy: true });
    if (!m) break;
    uci.push(m.from + m.to + (m.promotion ? m.promotion : ''));
  }
  return uci;
}

function loadJsonBook() {
  if (JSON_BOOK_CACHE !== null) return JSON_BOOK_CACHE;
  let book = new Map();
  try {
    let rows = [];
    for (const p of JSON_SOURCES) {
      if (!fs.existsSync(p)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(parsed) && parsed.length) rows = rows.concat(parsed);
      } catch {
        // ignore malformed files
      }
    }
    if (!rows.length) {
      JSON_BOOK_CACHE = book;
      return book;
    }

    const tmp = new Map();
    for (const r of rows) {
      const line = toUciLine(r);
      if (!line.length) continue;
      const ch = new (require('chess.js').Chess)();
      for (let i = 0; i < line.length && i < MAX_PLY; i++) {
        const fenKey = normFenKey(ch.fen());
        const move = line[i];
        tmp.set(fenKey, tmp.get(fenKey) || new Map());
        const bucket = tmp.get(fenKey);
        bucket.set(move, (bucket.get(move) || 0) + 1);
        const mv = { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move.slice(4) || undefined };
        if (!ch.move(mv)) break;
      }
    }

    for (const [k, v] of tmp.entries()) {
      const arr = Array.from(v.entries()).map(([uci, weight]) => ({ uci, weight }));
      arr.sort((a, b) => b.weight - a.weight);
      book.set(k, arr);
    }
    JSON_BOOK_CACHE = book;
    return book;
  } catch (e) {
    console.warn('[book] json unavailable:', e?.message || e);
    JSON_BOOK_CACHE = new Map();
    return JSON_BOOK_CACHE;
  }
}

function probeBookMove(fen, opts = {}) {
  const maxFullMoves = Number(opts.maxFullMoves) || 12;
  const parts = String(fen || '').trim().split(/\s+/);
  const moveNum = Number(parts[5]) || 1;
  if (moveNum > maxFullMoves) return null;

  // 1) Polyglot .bin
  const poly = ensurePolyglot(opts.path || DEFAULT_BOOK);
  if (poly) {
    try {
      const entries = poly.find(fen) || [];
      if (entries.length) {
        entries.sort((a, b) => (b.weight || 0) - (a.weight || 0));
        const top = entries[0];
        const uci = top.uci || (top.move ? (top.move.from + top.move.to + (top.move.promotion || '')) : null);
        if (uci) return { uci, weight: top.weight };
      }
    } catch (e) {
      console.warn('[book] polyglot probe failed:', e?.message || e);
    }
  }

  // 2) JSON fallback
  const book = loadJsonBook();
  const moves = book.get(normFenKey(fen));
  if (!moves || !moves.length) return null;
  return moves[0];
}

function bookSize() {
  const poly = ensurePolyglot(DEFAULT_BOOK);
  if (poly && typeof poly.size === 'number') return poly.size;
  const book = loadJsonBook();
  return typeof book?.size === 'number' ? book.size : 0;
}

module.exports = { probeBookMove, ensurePolyglot: ensurePolyglot, bookSize };
