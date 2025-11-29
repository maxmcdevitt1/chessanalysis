export type EcoEntry = { eco: string; name: string; ply: number };
export type EcoIndex = Map<string, EcoEntry>;

export function buildEcoIndex(raw: Array<{eco:string; name:string; moves:string; ply:number}>): EcoIndex {
  const idx: EcoIndex = new Map();
  for (const e of raw) {
    const key = e.moves.trim();
    idx.set(key, { eco: e.eco, name: e.name, ply: e.ply });
  }
  return idx;
}

export type BookTag = 'Book';
export function tagBookMoves(uciHistory: string[], ecoIndex: EcoIndex): (BookTag|undefined)[] {
  const tags: (BookTag|undefined)[] = [];
  let isStillBook = true;
  for (let i=0;i<uciHistory.length;i++) {
    if (!isStillBook) { tags.push(undefined); continue; }
    const seq = uciHistory.slice(0, i+1).join(' ');
    if (ecoIndex.has(seq)) tags.push('Book');
    else { tags.push(undefined); isStillBook = false; }
  }
  return tags;
}
