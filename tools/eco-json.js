// Usage: node tools/eco-pgn-to-json.js path/to/ECO.pgn data/opening-book.json
import fs from 'fs';
import { Chess } from '../webui/src/chess-compat.js'; // or `chess.js` if you prefer

const [,, pgnPath, outPath = 'data/opening-book.json'] = process.argv;
if (!pgnPath) { console.error('Provide ECO.pgn path'); process.exit(1); }

const pgn = fs.readFileSync(pgnPath, 'utf8');
// naive split: one game per PGN block; adjust if your PGN has headers per game
const blocks = pgn.split(/\n\n(?=\[Event)|\n\n(?=\d+\.)/).filter(Boolean);

const book = [];
for (const block of blocks) {
  const headers = Object.fromEntries([...block.matchAll(/\[(\w+)\s+"([^"]*)"]/g)].map(m => [m[1], m[2]]));
  const eco   = headers.ECO || '';
  const name  = headers.Opening || headers.Event || '';
  const body  = block.replace(/\[[^\]]+]/g, '').trim();
  const game  = new Chess();
  try { game.load_pgn(body); } catch { continue; }
  const sanMoves = game.history(); // ["Nf3","c5",...]
  if (!eco || !sanMoves.length) continue;
  book.push({ eco, name, san: sanMoves, plies: sanMoves.length });
}

book.sort((a,b) => (a.eco+b.name).localeCompare(b.eco+b.name));

fs.mkdirSync(require('path').dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(book, null, 2), 'utf8');
console.log(`Wrote ${book.length} lines to ${outPath}`);

