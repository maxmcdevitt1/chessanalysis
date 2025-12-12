import { Chess } from '../chess-compat';
import openingBookSource from '../data/beginneropenings.json';
import type { Color, UciMove } from '../types/chess';
import type { RNG } from '../utils/rng';

type OpeningLineJson = { variation?: string; weight?: number; moves?: string[] };
type OpeningJson = {
  name: string;
  eco: string;
  side: string;
  weight?: number;
  lines?: OpeningLineJson[];
};

export type NormalizedLine = {
  eco: string;
  name: string;
  variation?: string;
  side: Color;
  openingWeight: number;
  lineWeight: number;
  movesUci: string[];
};

type BookIndex = Map<Color, Map<string, NormalizedLine[]>>;
type PrefixMeta = { ply: number; line: NormalizedLine };

export type BookCandidate = {
  move: UciMove;
  line: NormalizedLine;
};

export type OpeningBook = {
  lookup(args: { side: Color; history: string[] }): NormalizedLine[];
  pick(args: {
    side: Color;
    history: string[];
    fen: string;
    maxPlies: number;
    topLines: number;
    favorCommon: boolean;
    rng: RNG;
    exitEarly?: { minPlies: number; probability: number };
  }): BookCandidate | null;
};

let cachedLines: NormalizedLine[] | null = null;
let cachedIndex: BookIndex | null = null;
let cachedPrefixes: Map<string, PrefixMeta> | null = null;

function baseMove(uci: string): string {
  return String(uci || '').slice(0, 4).toLowerCase();
}

function toUciMoves(moves: string[] | undefined | null): string[] {
  if (!moves?.length) return [];
  const g = new Chess();
  const out: string[] = [];
  try {
    for (const raw of moves) {
      const tok = String(raw || '').trim();
      if (!tok) break;
      if (/^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(tok)) {
        const uci = tok.toLowerCase();
        const mv = { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] } as any;
        if (!g.move(mv)) break;
        out.push(uci);
      } else {
        const mv = g.move(tok, { sloppy: true } as any);
        if (!mv) break;
        out.push(`${mv.from}${mv.to}${mv.promotion || ''}`);
      }
    }
  } catch {
    return [];
  }
  return out;
}

function normalizeLines(): NormalizedLine[] {
  if (cachedLines) return cachedLines;
  const src = (openingBookSource as { openings?: OpeningJson[] }) || {};
  const rows = Array.isArray(src.openings) ? src.openings : [];
  const lines: NormalizedLine[] = [];
  for (const opening of rows) {
    const side: Color = String(opening.side || '').toLowerCase().startsWith('b') ? 'b' : 'w';
    const openingWeight = Number.isFinite(opening.weight) && opening.weight! > 0 ? Number(opening.weight) : 1;
    if (!Array.isArray(opening.lines)) continue;
    for (const line of opening.lines) {
      const movesUci = toUciMoves(line.moves);
      if (!movesUci.length) continue;
      lines.push({
        eco: opening.eco || '',
        name: opening.name || '',
        variation: line.variation,
        side,
        openingWeight,
        lineWeight: Number.isFinite(line.weight) && line.weight! > 0 ? Number(line.weight) : 1,
        movesUci,
      });
    }
  }
  cachedLines = lines;
  return lines;
}

function buildIndex(lines: NormalizedLine[]): BookIndex {
  if (cachedIndex) return cachedIndex;
  const index: BookIndex = new Map();
  for (const line of lines) {
    const first = baseMove(line.movesUci[0]);
    if (!first) continue;
    const bySide = index.get(line.side) ?? new Map<string, NormalizedLine[]>();
    index.set(line.side, bySide);
    const bucket = bySide.get(first) ?? [];
    bucket.push(line);
    bySide.set(first, bucket);
  }
  cachedIndex = index;
  return index;
}

function buildPrefixMap(lines: NormalizedLine[]): Map<string, PrefixMeta> {
  if (cachedPrefixes) return cachedPrefixes;
  const map = new Map<string, PrefixMeta>();
  for (const line of lines) {
    for (let i = 1; i <= line.movesUci.length; i++) {
      const key = line.movesUci.slice(0, i).join(' ');
      const prev = map.get(key);
      if (!prev || prev.ply < i) {
        map.set(key, { ply: i, line });
      }
    }
  }
  cachedPrefixes = map;
  return map;
}

export function bookMaskForHistory(moves: string[]): boolean[] {
  const lines = normalizeLines();
  const map = buildPrefixMap(lines);
  const mask: boolean[] = [];
  const prefix: string[] = [];
  let stillTheory = true;
  for (const move of moves) {
    if (!stillTheory) {
      mask.push(false);
      continue;
    }
    prefix.push(move);
    const key = prefix.join(' ');
    const inBook = map.has(key);
    mask.push(inBook);
    if (!inBook) stillTheory = false;
  }
  return mask;
}

export function bookLineForHistory(moves: string[]): NormalizedLine | null {
  const lines = normalizeLines();
  const map = buildPrefixMap(lines);
  const prefix: string[] = [];
  let best: PrefixMeta | null = null;
  for (const move of moves) {
    prefix.push(move);
    const key = prefix.join(' ');
    const entry = map.get(key);
    if (entry) {
      best = entry;
    } else {
      break;
    }
  }
  return best?.line ?? null;
}

function matchHistory(line: NormalizedLine, history: string[]): boolean {
  if (history.length > line.movesUci.length) return false;
  for (let i = 0; i < history.length; i++) {
    if (baseMove(line.movesUci[i]) !== baseMove(history[i])) return false;
  }
  return true;
}

export function createOpeningBook(): OpeningBook {
  const lines = normalizeLines();
  const index = buildIndex(lines);

  function candidates(side: Color, history: string[]): NormalizedLine[] {
    if (!history.length) {
      return lines.filter((ln) => ln.side === side);
    }
    const first = baseMove(history[0]);
    const bySide = index.get(side);
    if (!bySide) return [];
    const pool = first ? (bySide.get(first) ?? []) : Array.from(bySide.values()).flat();
    return pool.filter((ln) => matchHistory(ln, history));
  }

  function pick(args: {
    side: Color;
    history: string[];
    fen: string;
    maxPlies: number;
    topLines: number;
    favorCommon: boolean;
    rng: RNG;
    exitEarly?: { minPlies: number; probability: number };
  }): BookCandidate | null {
    const { history, side, maxPlies, favorCommon, rng, fen, exitEarly, topLines } = args;
    if (history.length >= maxPlies) return null;
    if (exitEarly && history.length >= exitEarly.minPlies) {
      if (rng.next() < exitEarly.probability) return null;
    }
    const matched = candidates(side, history);
    if (!matched.length) return null;
    const grouped = new Map<string, { weight: number; lines: NormalizedLine[] }>();
    for (const line of matched) {
      const key = `${line.side}|${line.eco}|${line.name}`;
      const grp = grouped.get(key);
      if (grp) {
        grp.lines.push(line);
      } else {
        grouped.set(key, { weight: line.openingWeight, lines: [line] });
      }
    }
    const openings = Array.from(grouped.values());
    let opening: { weight: number; lines: NormalizedLine[] } | null = null;
    if (favorCommon) {
      openings.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
      opening = openings[0] ?? null;
    } else {
      const total = openings.reduce((sum, row) => sum + (row.weight || 1), 0);
      let r = rng.next() * total;
      for (const row of openings) {
        r -= (row.weight || 1);
        if (r <= 0) { opening = row; break; }
      }
      if (!opening) opening = openings[openings.length - 1] ?? null;
    }
    if (!opening) return null;
    const lineVariants = opening.lines
      .slice()
      .sort((a, b) => (b.lineWeight ?? 1) - (a.lineWeight ?? 1));
    const pool = favorCommon
      ? lineVariants.slice(0, Math.max(1, topLines))
      : lineVariants;
    let linePick: NormalizedLine | undefined;
    if (favorCommon) {
      linePick = pool[0];
    } else {
      const total = pool.reduce((sum, row) => sum + (row.lineWeight || 1), 0);
      let r = rng.next() * total;
      for (const row of pool) {
        r -= (row.lineWeight || 1);
        if (r <= 0) { linePick = row; break; }
      }
      if (!linePick) linePick = pool[pool.length - 1];
    }
    if (!linePick) return null;
    const nextUci = linePick.movesUci[history.length];
    if (!nextUci) return null;
    try {
      const game = new Chess(fen);
      const mv = {
        from: nextUci.slice(0, 2),
        to: nextUci.slice(2, 4),
        promotion: nextUci[4] || undefined,
      } as any;
      const played = game.move(mv);
      if (!played) return null;
      const move = `${played.from}${played.to}${played.promotion || ''}`;
      return { move, line: linePick };
    } catch {
      return null;
    }
  }

  return {
    lookup: ({ side, history }) => candidates(side, history),
    pick,
  };
}
