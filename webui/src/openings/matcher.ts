// webui/src/openings/matcher.ts
// Reliable opening detection via UCI prefix trie.
// Works in Vite dev and packaged Electron (offline).

import { Chess } from 'chess.js';

// Types for input rows (we normalize them to UCI arrays)
export type OpeningEntry = {
  eco: string;
  name: string;
  variation?: string;
  // any one of these may exist in your eco.json rows:
  uci?: string[] | string;
  pgn?: string;
  san?: string[];
  moves?: string[];
};

type TrieNode = {
  children: Record<string, TrieNode>;
  opening?: { eco: string; name: string; variation?: string; ply: number; lineUci: string[] };
};

let trieRoot: TrieNode | null = null;
let LOADED_ROWS = 0;

function isUciMove(s: string): boolean {
  return /^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(s);
}

function pgnToSanTokens(pgn: string): string[] {
  if (!pgn) return [];
  let s = String(pgn);
  // Remove headers, comments, variations, NAGs, results, and move numbers
  s = s.replace(/\[.*?\]\s*/g, ' ')
       .replace(/\{[^}]*\}/g, ' ')
       .replace(/\([^)]*\)/g, ' ')
       .replace(/\$\d+/g, ' ')
       .replace(/\b1-0\b|\b0-1\b|\b1\/2-1\/2\b|\*/g, ' ')
       .replace(/\d+\.(\.\.)?/g, ' ')
       .replace(/\d+…/g, ' ')
       .replace(/\s+/g, ' ')
       .trim();
  if (!s) return [];
  return s.split(' ').filter(Boolean);
}

/** Normalize entry to UCI array (prefers uci, falls back to pgn/san). */
function toUciArray(row: OpeningEntry): string[] {
  // uci: string[]
  if (Array.isArray(row.uci) && row.uci.length) {
    const xs = row.uci.map(String).filter(isUciMove);
    if (xs.length) return xs;
  }
  // uci: "e2e4 e7e5 ..."
  if (typeof row.uci === 'string' && row.uci.trim()) {
    const xs = row.uci.split(/\s+/).map(s => s.trim()).filter(Boolean).filter(isUciMove);
    if (xs.length) return xs;
  }

  // Gather SAN tokens from pgn/san/moves
  let san: string[] = [];
  if (typeof row.pgn === 'string' && row.pgn.trim()) san = pgnToSanTokens(row.pgn);
  else if (Array.isArray(row.san) && row.san.length) san = row.san;
  else if (Array.isArray(row.moves) && row.moves.length) san = row.moves;

  if (!san.length) return [];

  // SAN → UCI using chess.js (sloppy)
  const ch = new Chess();
  const out: string[] = [];
  for (const tokenRaw of san) {
    const token = tokenRaw.replace(/[+#?!]+/g, ''); // strip annotations; keep captures/promotions
    const m = ch.move(token, { sloppy: true });
    if (!m) break;
    out.push(m.from + m.to + (m.promotion ? m.promotion : ''));
  }
  return out.length ? out : [];
}

function insertLine(uci: string[], row: OpeningEntry) {
  if (!uci.length) return;
  if (!trieRoot) trieRoot = { children: {} };
  let node = trieRoot;
  for (let i = 0; i < uci.length; i++) {
    const mv = uci[i];
    node.children[mv] = node.children[mv] || { children: {} };
    node = node.children[mv];
    node.opening = {
      eco: row.eco,
      name: row.name,
      variation: row.variation,
      ply: i + 1,
      lineUci: uci.slice(0, i + 1),
    };
  }
}

function buildTrie(rows: OpeningEntry[]) {
  trieRoot = { children: {} };
  LOADED_ROWS = 0;
  for (const r of rows) {
    const u = toUciArray(r);
    if (!u.length) continue;
    insertLine(u, r);
    LOADED_ROWS++;
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[openings] trie built from rows:', LOADED_ROWS);
  }
}

// try to load from src bundle first, then public /eco.json
async function loadAll(): Promise<void> {
  if (trieRoot) return;

  let rows: OpeningEntry[] = [];

  const fetchEco = async (path: string, label: string) => {
    try {
      const res = await fetch(path);
      if (res.ok) {
        const j = await res.json();
        if (Array.isArray(j) && j.length) {
          rows = rows.concat(j as OpeningEntry[]);
          if (import.meta.env.DEV) console.debug(`[openings] loaded from ${label}:`, j.length);
        }
      }
    } catch {
      // ignore
    }
  };

  // 1) Bundled src/data/openings/eco.json if present
  try {
    const m: any = await import('../data/openings/eco.json');
    const arr = m?.default;
    if (Array.isArray(arr) && arr.length) {
      rows = rows.concat(arr as OpeningEntry[]);
      if (import.meta.env.DEV) console.debug('[openings] loaded from src/data/openings/eco.json:', arr.length);
    }
  } catch {
    // ignore — file may not exist
  }

  // 2) Public /eco.json (primary) and /eco1.json (fuller list)
  await fetchEco('/eco.json', '/eco.json');
  await fetchEco('/eco1.json', '/eco1.json');

  if (!rows.length) {
    console.warn('[openings] no usable openings data found (src nor /eco.json)');
    trieRoot = { children: {} };
    return;
  }

  // Optional: de-duplicate by (eco + name + first few moves) to avoid double insert
  const seen = new Set<string>();
  const dedup: OpeningEntry[] = [];
  for (const r of rows) {
    const key = `${r.eco}|${r.name}|${(Array.isArray(r.uci) ? r.uci.slice(0,3).join(' ') : (typeof r.uci === 'string' ? r.uci.split(/\s+/).slice(0,3).join(' ') : (r.pgn || ''))).toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(r);
  }

  buildTrie(dedup);
}

function getNodeFor(prefixUci: string[]): TrieNode | null {
  if (!trieRoot) return null;
  let node: TrieNode = trieRoot;
  for (const mv of prefixUci) {
    const next = node.children[mv];
    if (!next) return node.opening ? node : null;
    node = next;
  }
  return node;
}

export async function detectOpening(opts: { movesUci?: string[] }): Promise<{ eco:string; name:string; variation?:string; plyDepth:number } | null> {
  await loadAll();
  const moves = Array.isArray(opts.movesUci) ? opts.movesUci : [];
  if (!trieRoot || !moves.length) return null;

  let node: TrieNode | null = trieRoot;
  let best = trieRoot.opening || null;

  for (const mv of moves) {
    const next = node!.children[mv];
    if (!next) break;
    node = next;
    if (node.opening) best = node.opening;
  }

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[openings] match result:', best, 'after plies:', moves.length, 'loadedRows:', LOADED_ROWS);
  }

  return best ? { eco: best.eco, name: best.name, variation: best.variation, plyDepth: best.ply } : null;
}

export function nextBookMoves(prefixUci: string[]): string[] {
  if (!trieRoot) return [];
  const node = getNodeFor(prefixUci);
  if (!node) return [];
  return Object.keys(node.children);
}
