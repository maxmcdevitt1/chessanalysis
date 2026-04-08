// tools/eco-to-json.mjs
// Usage:
//   node tools/eco-to-json.mjs <input-file> <output.json> [--debug]
import fs from 'fs';
import path from 'path';
import { Chess } from 'chess.js';

const [, , inPath, outPath = 'data/opening-book.json', flag] = process.argv;
const DEBUG = flag === '--debug';

if (!inPath) {
  console.error('Usage: node tools/eco-to-json.mjs <input-file> [output.json] [--debug]');
  process.exit(1);
}

const absIn = path.resolve(inPath);
const absOut = path.resolve(outPath);
const raw = fs.readFileSync(absIn, 'utf8');

const records = [];

const headerRE = /^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"([^"]*)"\]\s*$/;
const moveNumberRE = /\d+\.(\.\.)?/;
const ecoCodeRE = /\b([A-E][0-9]{2})\b/;

// ---------- PGN block splitter (headers + movetext) ----------
function splitPGN(text) {
  const lines = text.split(/\r?\n/);
  const parts = [];
  let curH = [], curM = [], inHeaders = false;

  const flush = () => {
    if (curH.length || curM.length) {
      parts.push({ headers: curH.join('\n'), moves: curM.join('\n') });
      curH = []; curM = [];
    }
  };

  for (const line of lines) {
    if (headerRE.test(line)) {
      if (!inHeaders && (curH.length || curM.length)) flush();
      inHeaders = true;
      curH.push(line);
    } else if (inHeaders && /^\s*$/.test(line)) {
      // blank line between headers and moves
      continue;
    } else {
      inHeaders = false;
      curM.push(line);
    }
  }
  flush();
  return parts;
}

function parseHeaders(block) {
  const h = {};
  for (const line of block.split(/\r?\n/)) {
    const m = headerRE.exec(line);
    if (m) h[m[1]] = m[2];
  }
  return h;
}

function getHeader(h, key) {
  const k = Object.keys(h).find(k => k.toLowerCase() === key.toLowerCase());
  return k ? h[k] : undefined;
}

function stripHeaders(text) {
  return text.replace(/\s*\[[^\]]+\]\s*/g, '').trim();
}

function tryParsePGN(text) {
  const parts = splitPGN(text);
  if (DEBUG) console.log(`[eco] PGN candidate blocks: ${parts.length}`);
  for (const p of parts) {
    const headers = parseHeaders(p.headers);
    const eco = getHeader(headers, 'ECO');
    const openingRaw = getHeader(headers, 'Opening') || getHeader(headers, 'Event') || '';
    if (!eco || !openingRaw) continue;
    const movetext = stripHeaders(p.moves);
    if (!moveNumberRE.test(movetext)) continue;
    const game = new Chess();
    if (!game.loadPgn(movetext, { sloppy: true })) continue;
    const san = game.history();
    if (san.length === 0) continue;
    records.push({ eco, name: openingRaw.replace(/\s*\(([A-E]\d{2})\)\s*$/, ''), san, plies: san.length });
  }
}

// ---------- Plain-text fallback ----------
// Accept blocks like:
//   A04 Réti Opening: Sicilian Invitation
//   1. Nf3 c5 2. g3 ...
function tryParsePlain(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const ecoMatch = ecoCodeRE.exec(line);
    const looksName = ecoMatch && !moveNumberRE.test(line);
    if (!looksName) { i++; continue; }

    const eco = ecoMatch[1];
    const name = line.replace(/\s*\(([A-E]\d{2})\)\s*$/, '').trim();

    // accumulate following lines until blank line / next ECO header
    const buf = [];
    i++;
    while (i < lines.length) {
      const s = lines[i].trim();
      if (!s) break;
      if (ecoCodeRE.test(s) && !moveNumberRE.test(s)) break; // next header
      buf.push(s);
      i++;
    }
    const movetext = buf.join(' ');
    if (!moveNumberRE.test(movetext)) continue;

    const cleaned = movetext
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\$\d+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const game = new Chess();
    if (!game.loadPgn(cleaned, { sloppy: true })) continue;

    const san = game.history();
    if (san.length === 0) continue;

    records.push({ eco, name, san, plies: san.length });
  }
}

// ---------- Run both parsers ----------
tryParsePGN(raw);
const countAfterPGN = records.length;
tryParsePlain(raw);

if (DEBUG) console.log(`[eco] PGN parsed: ${countAfterPGN}, total after plain: ${records.length}`);

records.sort((a, b) => (a.eco + a.name).localeCompare(b.eco + b.name));

fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, JSON.stringify(records, null, 2), 'utf8');

console.log(`Converted ${records.length} ECO lines -> ${absOut}`);
if (records.length === 0 && DEBUG) {
  console.log('--- first 80 lines of input (inspect format) ---\n' +
    raw.split(/\r?\n/).slice(0, 80).join('\n') + '\n--- end preview ---');
}

