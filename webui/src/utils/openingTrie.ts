// webui/src/utils/openingTrie.ts
// Detect opening by longest SAN prefix (tries opening-trie.json).
import { Chess } from '../chess-compat';

export type TrieNode = {
  [san: string]: TrieNode | any;
  _?: { eco: string; name: string };
};

let CACHE: TrieNode | null = null;

const URL = '/opening-trie.json'; // ensure this exists in webui/public

async function loadTrie(): Promise<TrieNode | null> {
  if (CACHE) return CACHE;
  try {
    const res = await fetch(URL);
    if (!res.ok) return null;
    CACHE = await res.json();
    return CACHE!;
  } catch {
    return null;
  }
}

function normSAN(s: string): string {
  if (!s) return s;
  if (s === '0-0' || s === 'O-O') return 'O-O';
  if (s === '0-0-0' || s === 'O-O-O') return 'O-O-O';
  return s.replace(/[+#!?]+$/g, '');
}

export function sanFromUci(movesUci: string[], initialFen?: string): string[] {
  const ch = new Chess(initialFen || undefined);
  const out: string[] = [];
  for (const uci of movesUci) {
    const mv = ch.move(uci, { sloppy: true });
    if (!mv) break;
    out.push(normSAN(mv.san));
  }
  return out;
}

export type DetectResult = { eco: string; name: string; depth: number } | null;

// --- Domain overrides for under-specific early ECO labels ---
// Upgrades A45/D00 shallow matches to London System (D02) when structure is clear.
function promoteLondonIfApplicable(san: string[], base: DetectResult): DetectResult {
  if (!san?.length) return base;
  const s = san.map(normSAN);
  // We detect: 1.d4 with either ...d5 or ...Nf6, early Bf4, and e3 within the first 6 plies.
  const hasD4   = s[0] === 'd4';
  const replyNF = s[1] === 'Nf6';
  const replyD5 = s[1] === 'd5';
  const bf4At   = s.findIndex(m => m === 'Bf4');
  const e3At    = s.findIndex(m => m === 'e3');
  const earlyBf4 = bf4At >= 0 && bf4At <= 3;   // within first two moves by White
  const earlyE3  = e3At  >= 0 && e3At  <= 5;   // within first three moves by White

  const shallow = !base || /^A45|^D00/.test(base.eco);
  if (hasD4 && (replyD5 || replyNF) && earlyBf4 && earlyE3 && shallow) {
    const depth = Math.max(base?.depth ?? 0, Math.max(bf4At + 1, e3At + 1));
    return { eco: 'D02', name: 'London System', depth };
  }
  return base;
}

export async function detectOpeningByTrie(
  movesUci: string[],
  opts?: { initialFen?: string; maxPlies?: number }
): Promise<DetectResult> {
  const trie = await loadTrie();
  if (!trie) return null;
  const san = sanFromUci(movesUci, opts?.initialFen);
  const max = Math.min(san.length, opts?.maxPlies ?? 40);
  let node: any = trie;
  let best: DetectResult = null;
  for (let i = 0; i < max; i++) {
    node = node?.[normSAN(san[i])];
    if (!node) break;
    if (node._) best = { eco: node._.eco, name: node._.name, depth: i + 1 };
  }
  // Promote shallow A45/D00 labels to D02 when the London pattern is present.
  return promoteLondonIfApplicable(san, best);
}

export function maskFromDepth(totalPlies: number, depth: number): boolean[] {
  const d = Math.max(0, Math.min(totalPlies, depth | 0));
  return Array.from({ length: totalPlies }, (_, i) => i < d);
}
