'use strict';

// Polyglot helper: used only for opening identification/metadata.

const fs = require('fs');
const path = require('path');

let Polyglot = null;
try { Polyglot = require('polyglot-book'); } catch {}
if (!Polyglot) { try { Polyglot = require('chess-polyglot'); } catch {} }

const ROOT_DIR = path.join(__dirname, '..', '..');
const DEFAULT_BOOK = path.join(ROOT_DIR, 'data', 'book.bin');

let POLYGLOT_BOOK = null; // false => unavailable, object => ready

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

function identifyOpeningFromBook(fen, opts = {}) {
  const poly = ensurePolyglot(opts.path || DEFAULT_BOOK);
  if (!poly) return null;
  try {
    const entries = poly.find(fen) || [];
    if (!Array.isArray(entries) || !entries.length) return null;
    const top = entries[0] || {};
    const eco = top.eco || top.ECO || null;
    const name = top.name || null;
    if (eco || name) return { eco: eco || '', name: name || '' };
  } catch (e) {
    console.warn('[book] identify failed:', e?.message || e);
  }
  return null;
}

function bookSize() {
  const poly = ensurePolyglot(DEFAULT_BOOK);
  if (poly && typeof poly.size === 'number') return poly.size;
  return 0;
}

module.exports = { identifyOpeningFromBook, ensurePolyglot, bookSize };
