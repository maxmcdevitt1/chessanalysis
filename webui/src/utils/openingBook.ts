import { Chess } from 'chess.js';

// ---- Types ----
type BookMove = { uci: string; next: string; w: number };
type BookNode = { depth: number; labels?: { eco:string; name:string; variation?:string }[]; moves: BookMove[] };
type Book = { root: string; nodes: Record<string, BookNode> };

let BOOK_CACHE: Book | null = null;

function normFen3FromFull(fen: string): string {
  const [board, stm, cast] = fen.split(/\s+/);
  return [board, stm, cast || '-'].join(' ');
}

export async function loadOpeningBook(): Promise<Book | null> {
  if (BOOK_CACHE) return BOOK_CACHE;
  try {
    const res = await fetch('/opening-book.json');
    if (!res.ok) return null;
    const j = (await res.json()) as Book;
    if (!j || !j.nodes) return null;
    BOOK_CACHE = j;
    return BOOK_CACHE;
  } catch {
    return null;
  }
}

export async function bookMaskFromMoves(movesUci: string[]): Promise<boolean[]> {
  const book = await loadOpeningBook();
  if (!book) return movesUci.map(() => false);
  const ch = new Chess();
  const mask: boolean[] = [];
  for (let i = 0; i < movesUci.length; i++) {
    const mv = movesUci[i];
    const m = ch.move({ from: mv.slice(0,2), to: mv.slice(2,4), promotion: mv.slice(4) || undefined } as any);
    if (!m) { mask.push(false); continue; }
    const fen3 = normFen3FromFull(ch.fen());
    mask.push(Boolean(book.nodes[fen3]));
  }
  while (mask.length < movesUci.length) mask.push(false);
  return mask;
}

export function bookDepthFromMask(mask: boolean[]): number {
  let deepest = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) deepest = i + 1;
  }
  return deepest;
}

export async function openingLabelAtMask(movesUci: string[], mask: boolean[]):
  Promise<{ eco:string; name:string; variation?:string } | null> {
  const book = await loadOpeningBook();
  if (!book) return null;
  const ch = new Chess();
  let label: { eco:string; name:string; variation?:string } | null = null;
  for (let i = 0; i < movesUci.length && i < mask.length; i++) {
    const mv = movesUci[i];
    const m = ch.move({ from: mv.slice(0,2), to: mv.slice(2,4), promotion: mv.slice(4) || undefined } as any);
    if (!m) break;
    const fen3 = normFen3FromFull(ch.fen());
    if (mask[i]) {
      const node = book.nodes[fen3];
      if (node?.labels?.length) label = node.labels[0];
    }
  }
  return label;
}

export async function topBookMovesForCurrent(movesUci: string[]): Promise<BookMove[]> {
  const book = await loadOpeningBook();
  if (!book) return [];
  const ch = new Chess();
  for (const mv of movesUci) {
    const m = ch.move({ from: mv.slice(0,2), to: mv.slice(2,4), promotion: mv.slice(4) || undefined } as any);
    if (!m) return [];
  }
  const fen3 = normFen3FromFull(ch.fen());
  return book.nodes[fen3]?.moves ?? [];
}

export { normFen3FromFull };
