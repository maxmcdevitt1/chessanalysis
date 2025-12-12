// tools/make_opening_book.ts
// Build a transposition-aware opening DB from webui/public/eco.json (PGN lines).
// Outputs webui/public/opening-book.json

import fs from 'fs';
import path from 'path';
import { Chess } from 'chess.js';

type EcoRow = {
  eco: string;
  name: string;
  variation?: string;
  pgn?: string;
  san?: string[];
  moves?: string[];
  uci?: string[] | string;
};

type BookNode = {
  depth: number;
  labels?: { eco: string; name: string; variation?: string }[];
  moves: Array<{ uci: string; next: string; w: number }>;
};

type Book = {
  root: string;                 // normalized FEN (first 3 fields)
  nodes: Record<string, BookNode>;
};

function normFen3(fullFen: string): string {
  const [board, stm, cast] = fullFen.split(/\s+/);
  return [board, stm, cast || '-'].join(' ');
}

function pgnToSanTokens(pgn: string): string[] {
  if (!pgn) return [];
  let s = pgn;
  s = s
    .replace(/\[.*?\]\s*/g, ' ')                 // headers
    .replace(/\{[^}]*\}/g, ' ')                  // {comments}
    .replace(/\([^)]*\)/g, ' ')                  // (variations)
    .replace(/\$\d+/g, ' ')                      // NAGs
    .replace(/\b1-0\b|\b0-1\b|\b1\/2-1\/2\b|\*/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\d+…/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.split(' ').filter(Boolean) : [];
}

function toUciLine(row: EcoRow): string[] {
  // uci array
  if (Array.isArray(row.uci) && row.uci.length) {
    return row.uci.map(String).filter(m => /^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(m));
  }
  // uci space-separated
  if (typeof row.uci === 'string' && row.uci.trim()) {
    return row.uci.split(/\s+/).filter(m => /^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(m));
  }
  // san[] / moves[] / pgn
  let san: string[] = [];
  if (Array.isArray(row.san) && row.san.length) san = row.san;
  else if (Array.isArray(row.moves) && row.moves.length) san = row.moves;
  else if (typeof row.pgn === 'string' && row.pgn.trim()) san = pgnToSanTokens(row.pgn);
  if (!san.length) return [];

  const ch = new Chess();
  const uci: string[] = [];
  for (const tokRaw of san) {
    const tok = tokRaw.replace(/[+#?!]+/g, '');
    const m = ch.move(tok, { sloppy: true });
    if (!m) break;
    uci.push(m.from + m.to + (m.promotion ? m.promotion : ''));
  }
  return uci;
}

function addLineToBook(book: Book, row: EcoRow) {
  const uci = toUciLine(row);
  if (!uci.length) return;

  const ch = new Chess();
  const root = normFen3(ch.fen());
  if (!book.root) book.root = root;

  for (let i = 0; i < uci.length; i++) {
    const mv = uci[i];
    const m = ch.move({ from: mv.slice(0,2), to: mv.slice(2,4), promotion: mv.slice(4) || undefined } as any);
    if (!m) break;

    const fen3Prev = normFen3(ch.fen()); // after move; we want edge from previous position
    // we need previous position’s fen3; re-create by undoing once:
    ch.undo();
    const fen3Before = normFen3(ch.fen());
    // redo to keep going
    ch.move({ from: mv.slice(0,2), to: mv.slice(2,4), promotion: mv.slice(4) || undefined } as any);
    const fen3After = fen3Prev;

    // ensure nodes exist
    book.nodes[fen3Before] ||= { depth: i, moves: [] };
    book.nodes[fen3After]  ||= { depth: i+1, moves: [] };

    // attach label on the deepest node reached so far
    const n = book.nodes[fen3After];
    n.labels ||= [];
    // avoid dup labels
    if (!n.labels.some(l => l.eco === row.eco && l.name === row.name && l.variation === row.variation)) {
      n.labels.push({ eco: row.eco, name: row.name, variation: row.variation });
    }

    // add edge (increment weight if present)
    const arr = book.nodes[fen3Before].moves;
    const existing = arr.find(e => e.uci === mv && e.next === fen3After);
    if (existing) existing.w += 1; else arr.push({ uci: mv, next: fen3After, w: 1 });
  }
}

function main() {
  const rootDir = process.cwd();
  const sources = ['eco.json', 'eco1.json'].map(f => path.join(rootDir, 'webui', 'public', f));
  const raw: EcoRow[] = [];
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(src, 'utf8')) as EcoRow[];
      if (Array.isArray(rows) && rows.length) raw.push(...rows);
      else console.warn('No rows in', src);
    } catch (e) {
      console.error('Failed to read', src, e);
    }
  }
  if (!raw.length) {
    console.error('No opening sources found:', sources.join(', '));
    process.exit(1);
  }
  const book: Book = { root: '', nodes: {} };

  let ok = 0, bad = 0;
  for (const r of raw) {
    try { addLineToBook(book, r); ok++; } catch { bad++; }
  }
  // cap branching per node (optional)
  for (const k of Object.keys(book.nodes)) {
    book.nodes[k].moves.sort((a,b)=>b.w-a.w);
    book.nodes[k].moves = book.nodes[k].moves.slice(0, 8);
  }

  const outPath = path.join(rootDir, 'webui', 'public', 'opening-book.json');
  fs.writeFileSync(outPath, JSON.stringify(book));
  console.log('Opening book written:', outPath, 'rows:', raw.length, 'ok:', ok, 'bad:', bad, 'nodes:', Object.keys(book.nodes).length);
}

main();
