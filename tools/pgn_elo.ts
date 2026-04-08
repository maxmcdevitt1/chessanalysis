#!/usr/bin/env ts-node
/**
 * Summarize PGN results and convert them into Elo deltas per pairing.
 * Usage:
 *   npx tsx --tsconfig tsconfig.tools.json tools/pgn_elo.ts --pgn games.pgn
 */

import * as fs from 'fs';
import * as path from 'path';

type Game = {
  white: string;
  black: string;
  result: '1-0' | '0-1' | '1/2-1/2';
};

const args = process.argv.slice(2);
const val = (k: string, d?: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};

const PGN_PATH = val('pgn', 'games.pgn');
const BASE_ELO = (() => {
  const raw = val('baseline', '1200');
  const num = raw ? Number(raw) : 1200;
  return Number.isFinite(num) ? num : 1200;
})();

function parsePgnGames(pgnText: string): Game[] {
  const trimmed = pgnText.trim();
  if (!trimmed) return [];
  // Split on blank line followed by a new [Event ...] or end of file.
  const chunks = trimmed
    .split(/\n\s*\n(?=\[Event\b|\s*$)/g)
    .map((c) => c.trim())
    .filter(Boolean);

  const games: Game[] = [];
  for (const chunk of chunks) {
    const white = readTag(chunk, 'White');
    const black = readTag(chunk, 'Black');
    const result = readTag(chunk, 'Result') as Game['result'] | null;
    if (!white || !black || !result) continue;
    if (result !== '1-0' && result !== '0-1' && result !== '1/2-1/2') continue;
    games.push({ white, black, result });
  }
  return games;
}

function readTag(block: string, tag: string): string | null {
  const re = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`);
  const hit = block.match(re);
  return hit ? hit[1] : null;
}

type PairStats = {
  white: string;
  black: string;
  games: number;
  whiteWins: number;
  blackWins: number;
  draws: number;
  whiteScore: number; // total points for white side
};

type Outcome = 'win' | 'draw' | 'loss';

type ColorStats = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number; // total points from this player's POV
};

type PlayerStats = {
  name: string;
  white: ColorStats;
  black: ColorStats;
  overall: ColorStats;
};

const blankColorStats = (): ColorStats => ({ games: 0, wins: 0, draws: 0, losses: 0, score: 0 });

function applyOutcome(bucket: ColorStats, outcome: Outcome) {
  bucket.games += 1;
  if (outcome === 'win') {
    bucket.wins += 1;
    bucket.score += 1;
  } else if (outcome === 'draw') {
    bucket.draws += 1;
    bucket.score += 0.5;
  } else {
    bucket.losses += 1;
  }
}

function ensurePlayer(map: Map<string, PlayerStats>, name: string): PlayerStats {
  let stats = map.get(name);
  if (!stats) {
    stats = { name, white: blankColorStats(), black: blankColorStats(), overall: blankColorStats() };
    map.set(name, stats);
  }
  return stats;
}

function recordPlayer(map: Map<string, PlayerStats>, name: string, color: 'white' | 'black', outcome: Outcome) {
  const stats = ensurePlayer(map, name);
  const bucket = color === 'white' ? stats.white : stats.black;
  applyOutcome(bucket, outcome);
  applyOutcome(stats.overall, outcome);
}

function eloDiffFromScore(score: number): number {
  const clampScore = Math.max(0.01, Math.min(0.99, score));
  return 400 * Math.log10(clampScore / (1 - clampScore));
}

function summarize(games: Game[]): PairStats[] {
  const map = new Map<string, PairStats>();
  for (const g of games) {
    const key = `${g.white}|||${g.black}`;
    if (!map.has(key)) {
      map.set(key, {
        white: g.white,
        black: g.black,
        games: 0,
        whiteWins: 0,
        blackWins: 0,
        draws: 0,
        whiteScore: 0,
      });
    }
    const stats = map.get(key)!;
    stats.games += 1;
    if (g.result === '1-0') {
      stats.whiteWins += 1;
      stats.whiteScore += 1;
    } else if (g.result === '0-1') {
      stats.blackWins += 1;
    } else {
      stats.draws += 1;
      stats.whiteScore += 0.5;
    }
  }
  return Array.from(map.values());
}

function buildPlayerStats(games: Game[]): PlayerStats[] {
  const map = new Map<string, PlayerStats>();
  for (const g of games) {
    const whiteOutcome: Outcome = g.result === '1-0' ? 'win' : g.result === '0-1' ? 'loss' : 'draw';
    const blackOutcome: Outcome = g.result === '0-1' ? 'win' : g.result === '1-0' ? 'loss' : 'draw';
    recordPlayer(map, g.white, 'white', whiteOutcome);
    recordPlayer(map, g.black, 'black', blackOutcome);
  }
  return Array.from(map.values());
}

function formatPct(x: number, total: number) {
  if (!total) return '0.0%';
  return `${((x / total) * 100).toFixed(1)}%`;
}

const formatDiff = (diff: number) => `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`;
const diffToElo = (diff: number) => BASE_ELO + diff;
const fmtElo = (diff: number) => diffToElo(diff).toFixed(0);

function printColorLine(label: string, stats: ColorStats) {
  if (!stats.games) return;
  const pct = stats.score / stats.games;
  const diff = eloDiffFromScore(pct);
  console.log(
    `  ${label}: ${stats.games} games, W/D/L ${stats.wins}/${stats.draws}/${stats.losses}, ` +
    `score ${stats.score.toFixed(1)}/${stats.games} (${(pct * 100).toFixed(1)}%), ` +
    `est. Elo ${fmtElo(diff)} (${formatDiff(diff)} vs baseline ${BASE_ELO})`
  );
}

function main() {
  const pgnAbs = path.resolve(process.cwd(), PGN_PATH);
  let text: string;
  try {
    text = fs.readFileSync(pgnAbs, 'utf8');
  } catch (err) {
    console.error(`Failed to read PGN at ${pgnAbs}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const games = parsePgnGames(text);
  if (!games.length) {
    console.error('No games found in PGN.');
    process.exitCode = 1;
    return;
  }

  const pairStats = summarize(games);
  console.log(`Parsed ${games.length} games from ${PGN_PATH}\n`);

  for (const stats of pairStats) {
    const { white, black, games, whiteWins, blackWins, draws, whiteScore } = stats;
    const whitePct = whiteScore / games;
    const diff = eloDiffFromScore(whitePct);
    console.log(`${white} (White) vs ${black} (Black)`);
    console.log(
      `  Games: ${games}, White W/D/L: ${whiteWins}/${draws}/${blackWins} (${formatPct(
        whiteWins,
        games
      )} wins)`
    );
    console.log(`  White score: ${whiteScore.toFixed(1)} / ${games} (${(whitePct * 100).toFixed(1)}%)`);
    console.log(
      `  Est. Elo: White ${fmtElo(diff)} vs Black ${fmtElo(-diff)} ` +
      `(baseline ${BASE_ELO}, diff ${formatDiff(diff)})\n`
    );
  }

  const players = buildPlayerStats(games).sort((a, b) => a.name.localeCompare(b.name));
  console.log('Per-side summaries:\n');
  for (const player of players) {
    console.log(player.name);
    printColorLine('As White', player.white);
    printColorLine('As Black', player.black);
    printColorLine('Overall ', player.overall);
    console.log('');
  }
}

main();
