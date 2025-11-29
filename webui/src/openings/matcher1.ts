// webui/src/openings/matcher.ts
// Bundled openings (no fetch): works in dev and in packaged Electron.
import { Chess } from '../chess-compat';

// Import JSON directly; Vite bundles it.
import ecoFull from '../data/openings/eco.json';

export type OpeningEntry = {
  eco: string;
  name: string;
  variation?: string;
  uci?: string[] | string;   // accept array or space-separated string
  pgn?: string;              // fallback: SAN PGN
};

type TrieNode = {
  children: Record<string, TrieNode>;
  opening?: { eco: string; name: string; variation?: string; ply: number };
};

let trieRoot: TrieNode | null = null;

/* ----------------------------- small utilities ---------------------------- */

function isUciMove(m: unknown): m is string {
  return typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(m);
}

/** Normalize a row to UCI array (handles uci[] | uci string | pgn SAN) */
function toUciArray(raw: OpeningEntry): string[] {
  if (Array.isArray(raw.uci)) {
    const xs = raw.uci.map(String).filter(isUciMove);
    if (xs.length) return xs;
  }
  if (typeof raw.uci === 'string') {
    const xs = raw.uci.split(/\s+/).map(s => s.trim()).filter(Boolean).filter(isUciMove);
    if (xs.length) return xs;
  }
  if (typeof raw.pgn === 'string' && raw.pgn.trim()) {
    try {
      const ch = new Chess();
      ch.loadPgn(raw.pgn, { sloppy: true });
      const verbose = ch.history({ verbose: true }) as any[];
      const xs = verbose.map(m => `${m.from}${m.to}${m.promotion || ''}`).filter(isUciMove);
      if (xs.length) return xs;
    } catch {/* ignore bad PGN */}
  }
  return [];
}

type Normalized = { eco: string; name: string; variation?: string; uci: string[] };

function normalize(entries: any[]): Normalized[] {
  if (!Array.isArray(entries)) return [];
  const out: Normalized[] = [];
  let skipped = 0;

  for (const raw of entries) {
    if (!raw) { skipped++; continue; }
    const eco = String(raw.eco ?? '').trim();
    const name = String(raw.name ?? raw.opening ?? '').trim();
    const variation = raw.variation != null ? String(raw.variation).trim() : undefined;
    if (!eco || !name) { skipped++; continue; }

    const uci = toUciArray(raw as OpeningEntry);
    if (!uci.length) { skipped++; continue; }

    out.push({ eco, name, variation, uci });
  }
  console.log(`[openings] validated ${out.length} rows; skipped ${skipped}`);
  return out;
}

function buildTrie(entries: Normalized[]) {
  const root: TrieNode = { children: {} };
  for (const o of entries) {
    let node = root;
    for (let i = 0; i < o.uci.length; i++) {
      const mv = o.uci[i];
      node.children[mv] = node.children[mv] || { children: {} };
      node = node.children[mv];
      node.opening = { eco: o.eco, name: o.name, variation: o.variation, ply: i + 1 };
    }
  }
  trieRoot = root;
}

function getNodeFor(prefix: string[]): TrieNode | null {
  if (!trieRoot) return null;
  let node: TrieNode | null = trieRoot;
  for (const mv of prefix) {
    const next = node.children[mv];
    if (!next) return null;
    node = next;
  }
  return node;
}

/* --------------------------------- API ------------------------------------ */

export async function initOpenings(): Promise<void> {
  if (trieRoot) return;

  // Prefer full DB; fallback to mini if it normalizes to zero.
  let data = normalize(ecoFull as any[]);
  if (!data.length) {
    console.warn('[openings] eco.json contained 0 valid rows; trying eco-mini.json');
    data = normalize(ecoMini as any[]);
  }
  if (!data.length) {
    console.warn('[openings] no usable openings data found');
    trieRoot = { children: {} };
    return;
  }
  console.log('[openings] loaded', data.length, 'entries');
  buildTrie(data);
}

export function findOpeningByMoves(uciMoves: string[]) {
  if (!trieRoot || !uciMoves?.length) return null;
  let node: TrieNode | null = trieRoot;
  let best: TrieNode['opening'] | null = null;
  for (const mv of uciMoves) {
    if (!node.children[mv]) break;
    node = node.children[mv];
    if (node.opening) best = node.opening;
  }
  return best;
}

export function nextBookMoves(prefix: string[]): string[] {
  const node = getNodeFor(prefix);
  if (!node) return [];
  return Object.keys(node.children);
}

export function isNovelty(prefixBeforeLast: string[], playedUci: string): boolean {
  const children = nextBookMoves(prefixBeforeLast);
  return children.length > 0 && !children.includes(playedUci);
}

