// webui/src/openings/matcher.ts
import { Chess } from '../chess-compat';

/* ----------------- Types ----------------- */
export type OpeningEntry = {
  eco: string;
  name: string;
  variation?: string;
  uci?: string[] | string; // accept array or space-separated string
  pgn?: string;            // fallback: SAN PGN
};

type OpeningMeta = { eco: string; name: string; variation?: string; ply: number };

type TrieNode = {
  children: Record<string /* base uci (4 chars) */, TrieNode>;
  childFullMoves: Record<string /* base */, string[]>; // full UCIs seen
  opening?: OpeningMeta;
};

let trieRoot: TrieNode | null = null;

/* ----------------- Utilities ----------------- */
function baseUci(uci: string): string {
  // normalize to 4-char, lowercased; ignore promotion
  return uci.slice(0, 4).toLowerCase();
}

function isUciMove(m: unknown): m is string {
  return typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(m);
}

function toUciArray(raw: OpeningEntry): string[] {
  // (1) explicit array
  if (Array.isArray(raw.uci)) {
    const xs = raw.uci.map(String).filter(isUciMove);
    if (xs.length) return xs;
  }
  // (2) space-separated string
  if (typeof raw.uci === 'string') {
    const xs = raw.uci.split(/\s+/).map(s => s.trim()).filter(Boolean).filter(isUciMove);
    if (xs.length) return xs;
  }
  // (3) PGN → UCI
  if (typeof raw.pgn === 'string' && raw.pgn.trim()) {
    try {
      const ch = new Chess();
      ch.loadPgn(raw.pgn, { sloppy: true });
      const verbose = ch.history({ verbose: true }) as any[];
      const xs = verbose.map(m => `${m.from}${m.to}${m.promotion || ''}`).filter(isUciMove);
      if (xs.length) return xs;
    } catch { /* ignore */ }
  }
  return [];
}

type Normalized = { eco: string; name: string; variation?: string; uci: string[] };

function normalize(entries: any[]): Normalized[] {
  if (!Array.isArray(entries)) return [];
  const out: Normalized[] = [];
  for (const raw of entries) {
    if (!raw) continue;
    const eco = String(raw.eco ?? '').trim();
    const name = String(raw.name ?? raw.opening ?? '').trim();
    const variation = raw.variation != null ? String(raw.variation).trim() : undefined;
    if (!eco || !name) continue;
    const uci = toUciArray(raw as OpeningEntry);
    if (!uci.length) continue;
    out.push({ eco, name, variation, uci });
  }
  return out;
}

/* ----------------- Trie build ----------------- */
function newNode(): TrieNode {
  return { children: Object.create(null), childFullMoves: Object.create(null) };
}

function buildTrie(rows: Normalized[]) {
  const root = newNode();

  for (const row of rows) {
    let node = root;
    for (let i = 0; i < row.uci.length; i++) {
      const full = row.uci[i];
      const base = baseUci(full);

      // remember full UCI variants at this ply
      (node.childFullMoves[base] ||= []).push(full);

      // descend
      node.children[base] ||= newNode();
      node = node.children[base];

      // opening meta at each ply (deeper overwrites earlier—fine)
      node.opening = { eco: row.eco, name: row.name, variation: row.variation, ply: i + 1 };
    }
  }

  trieRoot = root;
}

/* ----------------- Data loading ----------------- */
async function fetchJson(url: string): Promise<any[] | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      // avoid the classic “got index.html” case
      const head = (await r.text()).slice(0, 80);
      console.warn(`[openings] non-JSON at ${url} (content-type=${ct}). First bytes: ${head}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn('[openings] fetch error for', url, e);
    return null;
  }
}

/**
 * Load openings data from places you actually have:
 *  - public root:                /eco.json, /eco2.json
 *  - (legacy) public subfolders: /openings/eco.json, /data/openings/eco.json
 */
async function loadOpeningsRows(): Promise<Normalized[]> {
  const base = (import.meta as any).env.BASE_URL || '/';
  const candidates = [
    `${base}eco.json`,
    `${base}eco2.json`,
    `${base}openings/eco.json`,
    `${base}data/openings/eco.json`,
  ];

  for (const url of candidates) {
    const raw = await fetchJson(url);
    if (!raw?.length) continue;
    const data = normalize(raw);
    if (data.length) {
      console.log(`[openings] loaded ${data.length} entries from ${url}`);
      return data;
    }
  }

  console.warn('[openings] no usable openings data found');
  return [];
}

/* ----------------- Public API ----------------- */
export async function initOpenings(): Promise<void> {
  if (trieRoot) return;
  const rows = await loadOpeningsRows();
  buildTrie(rows);
}

function nodeFor(prefix: string[]): TrieNode | null {
  if (!trieRoot) return null;
  let node: TrieNode | null = trieRoot;
  for (const mv of prefix) {
    const key = baseUci(mv);
    const next = node.children[key];
    if (!next) return null;
    node = next;
  }
  return node;
}

/** Return representative next book moves as full UCIs (first seen per base) */
export function nextBookMoves(prefixUci: string[]): string[] {
  const node = nodeFor(prefixUci);
  if (!node) return [];
  const out: string[] = [];
  for (const base of Object.keys(node.childFullMoves)) {
    const variants = node.childFullMoves[base];
    if (variants?.length) out.push(variants[0]);
  }
  return out;
}

export function isNovelty(prefixBeforeLast: string[], playedUci: string): boolean {
  const node = nodeFor(prefixBeforeLast);
  if (!node) return true;
  const base = baseUci(playedUci);
  return !(base in node.childFullMoves);
}

/** Last-known opening meta that matches the given UCI sequence (promotion-agnostic) */
export function findOpeningByMoves(uciMoves: string[]) {
  if (!trieRoot || !uciMoves?.length) return null;
  let node: TrieNode | null = trieRoot;
  let best: OpeningMeta | null = null;
  for (const mv of uciMoves) {
    const key = baseUci(mv);
    const next = node.children[key];
    if (!next) break;
    node = next;
    if (node.opening) best = node.opening;
  }
  return best;
}

