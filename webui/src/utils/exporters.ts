import { Chess } from '../chess-compat';

export type MoveEval = {
  ply: number;
  side: 'White' | 'Black' | 'W' | 'B';
  san: string;
  uci?: string;
  tag?: 'Book' | 'Best' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder' | 'Brilliant' | 'Review';
  cpBefore?: number;
  cpAfter?: number;
  comment?: string;
};

export function pgnFromMoves({
  movesUci,
  initialFen,
  headers,
  result,
}: {
  movesUci: string[];
  initialFen?: string;
  headers?: Record<string, string>;
  result?: '1-0' | '0-1' | '1/2-1/2' | '*';
}): string {
  const game = new Chess(initialFen || undefined);
  for (const u of movesUci || []) game.move(u, { sloppy: true });
  const h = headers || {};
  if (initialFen) {
    h['FEN'] = initialFen;
    h['SetUp'] = '1';
  }
  const lines: string[] = [];
  const keys = Object.keys(h);
  for (const k of keys) lines.push(`[${k} "${(h[k] || '').replace(/"/g, '\'')}"]`);
  const out = game.pgn({ newline: '\n' }); // includes result if set inside chess state
  // If result param provided, append at end if missing
  const body = out || game.history().join(' ');
  const res = result || (game.header() as any)?.Result || '*';
  return (lines.length ? lines.join('\n') + '\n\n' : '') + body + (body.endsWith(res) ? '' : (' ' + res)) + '\n';
}

export function annotatedPgn({
  movesUci,
  moveEvals,
  initialFen,
  headers,
  result,
}: {
  movesUci: string[];
  moveEvals: MoveEval[];
  initialFen?: string;
  headers?: Record<string, string>;
  result?: '1-0' | '0-1' | '1/2-1/2' | '*';
}): string {
  const game = new Chess(initialFen || undefined);
  const commentsByPly = new Map<number, string>();
  for (const me of moveEvals || []) {
    const bits: string[] = [];
    if (me.tag && me.tag !== 'Book') bits.push(me.tag);
    if (typeof me.cpBefore === 'number' && typeof me.cpAfter === 'number') {
      // Store mover-POV swing
      const delta = (-me.cpAfter) - me.cpBefore; // convert cpAfter to mover POV then delta
      bits.push(`Δ=${(delta / 100).toFixed(2)}`);
    }
    if (me.comment) bits.push(me.comment);
    if (bits.length) commentsByPly.set(me.ply, bits.join(' · '));
  }
  // Play moves and inject comments
  let ply = 1;
  for (const u of movesUci || []) {
    const move = game.move(u, { sloppy: true });
    if (!move) break;
    const c = commentsByPly.get(ply++);
    if (c) (game as any).comment(c);
  }
  const h = headers || {};
  if (initialFen) { h['FEN'] = initialFen; h['SetUp'] = '1'; }
  const head: string[] = [];
  for (const k of Object.keys(h)) head.push(`[${k} "${(h[k] || '').replace(/"/g, '\'')}"]`);
  const res = result || (game.header() as any)?.Result || '*';
  const body = game.pgn({ newline: '\n' });
  return (head.length ? head.join('\n') + '\n\n' : '') + (body.endsWith(res) ? body : (body + ' ' + res)) + '\n';
}

export function analysisJson({
  movesUci,
  moveEvals,
  opening,
  whiteAcc,
  blackAcc,
  avgCplW,
  avgCplB,
  result,
}: {
  movesUci: string[];
  moveEvals: MoveEval[];
  opening?: string | null;
  whiteAcc?: number | null;
  blackAcc?: number | null;
  avgCplW?: number | null;
  avgCplB?: number | null;
  result?: string;
}) {
  return JSON.stringify({
    schema: 'chess-analysis@1',
    opening,
    accuracy: { white: whiteAcc, black: blackAcc },
    acpl: { white: avgCplW, black: avgCplB },
    result: result || '*',
    movesUci,
    moves: moveEvals,
    exportedAt: new Date().toISOString(),
  }, null, 2);
}
