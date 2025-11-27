// webui/src/openings/matcher.ts
import { Chess } from 'chess.js';

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

function isUciMove(m: unknown): m is string {
  return typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m);
}

function toUciArray(raw: OpeningEntry): string[] {
  // 1) explicit array
  if (Array.isArray(raw.uci)) {
    const xs = raw.uci.map(String).filter(isUciMove);
    return xs;
  }
  // 2) space-separated string
  if (typeof raw.uci === 'string') {
    const xs = raw.uci.split(/\s+/).map(s => s.trim()).filter(Boolean).filter(isUciMove);
    if (xs.length) return xs;
  }
  // 3) PGN -> UCI (fallback)
  if (typeof raw.pgn === 'string' && raw.pgn.trim()) {
    try {
      const ch = new Chess();
      ch.loadPgn(raw.pgn, { sloppy: true });
      const verbose = ch.history({ verbose: true }) as any[];
      const xs = verbose.map(m => `${m.from}${m.to}${m.promotion || ''}`).filter(isUciMove);
      return xs;
    } catch {
      // ignore
    }
  }
  return [];
}

function normalize(entries: any[]): Required<Pick<OpeningEntry, 'eco'|'name'>> & { variation?: string; uci: string[] }[] {
  if (!Array.isArray(entries)) return [];
  const out: { eco: string; name: string; variation?: string; uci: string[] }[] = [];

  for (const raw of entries) {
    if (!raw) continue;
    const eco = String(raw.eco ?? '').trim();
    const name = String(raw.name ?? raw.opening ?? '').trim();
    const variation = raw.variation != null ? String(raw.variation).trim() : undefined;
    if (!eco || !name) continue;

    const uci = toUciArray(raw);
    if (!uci.length) continue;

    out.push({ eco, name, variation, uci });
  }
  return out;
}

function buildTrie(entries: { eco: string; name: string; variation?: string; uci: string[] }[]) {
  trieRoot = { children: {} };
  for (const o of entries) {
    let node = trieRoot!;
    for (let i = 0; i < o.uci.length; i++) {
      const mv = o.uci[i];
      node.children[mv] = node.children[mv] || { children: {} };
      node = node.children[mv];
      node.opening = { eco: o.eco, name: o.name, variation: o.variation, ply: i + 1 };
    }
  }
}

export async function initOpenings(baseUrl = (import.meta as any).env.BASE_URL || './') {
  if (trieRoot) return;

  const candidates = ['eco.json', 'eco-mini.json'];
  for (const f of candidates) {
    try {
      const r = await fetch(baseUrl + f);
      if (!r.ok) continue;
      const raw = await r.json();
      const data = normalize(raw);
      if (data.length === 0) {
        console.warn(`[openings] ${f} loaded but contained 0 valid rows (bad/missing uci/pgn?)`);
        continue;
      }
      console.log(`[openings] loaded ${data.length} entries from ${f}`);
      buildTrie(data);
      return;
    } catch (e) {
      console.warn('[openings] load error for', f, e);
    }
  }
  console.warn('[openings] no DB found (eco.json / eco-mini.json)');
}
// --- keep your existing imports/types/buildTrie/initOpenings/findOpeningByMoves ---

// Add below, near the bottom of matcher.ts
type TrieNode = {
  children: Record<string, TrieNode>;
  opening?: { eco: string; name: string; variation?: string; ply: number };
};
declare let trieRoot: TrieNode | null; // (already declared earlier)

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

export function nextBookMoves(prefix: string[]): string[] {
  const node = getNodeFor(prefix);
  if (!node) return [];
  return Object.keys(node.children);
}

export function isNovelty(prefixBeforeLast: string[], playedUci: string): boolean {
  const children = nextBookMoves(prefixBeforeLast);
  return children.length > 0 && !children.includes(playedUci);
}

export function findOpeningByMoves(uciMoves: string[]) {
  if (!trieRoot) return null;
  let node: TrieNode | null = trieRoot;
  let best: TrieNode['opening'] | null = null;
  for (const mv of uciMoves) {
    if (!node.children[mv]) break;
    node = node.children[mv];
    if (node.opening) best = node.opening;
  }
  return best;
}

