import { useMemo } from 'react';
import { Chess } from '../chess-compat';
import type { CoachInputs } from '../types/coach';
import type { MoveEval } from '../types/moveEval';
import { evalLabelFromWhiteCp } from '../utils/evalLabels';
import { cpAfterWhiteValue } from '../utils/moveAnnotations';

function phaseForIndex(index: number, total: number): 'opening' | 'middlegame' | 'endgame' {
  if (index < 20) return 'opening';
  if (index < Math.max(30, total - 16)) return 'middlegame';
  return 'endgame';
}

const FILES = 'abcdefgh';
type CastleSide = 'king' | 'queen' | null;

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

function describeMoveIdea(move: any, cpBefore: number | null, cpAfter: number | null, phase: 'opening'|'middlegame'|'endgame', side: 'W'|'B', game: any) {
  if (!move) return '';
  const hints: string[] = [];
  const swing = cpBefore != null && cpAfter != null ? cpAfter - cpBefore : null;
  const mover = side === 'W' ? 'White' : 'Black';
  const opponent = side === 'W' ? 'Black' : 'White';
  const captureName = move.captured ? PIECE_NAMES[move.captured] || 'piece' : null;

  if (move.flags?.includes('k')) hints.push(`${mover} castled short to connect the rooks`);
  if (move.flags?.includes('q')) hints.push(`${mover} castled long and signalled pawn storms on the opposite wing`);
  if (move.flags?.includes('c') && captureName) {
    hints.push(`${mover} captured a ${captureName} on ${move.to} to unbalance the structure`);
  }
  if (move.flags?.includes('e')) {
    hints.push(`${mover} used en passant to clear a pawn majority`);
  }
  if (move.flags?.includes('b')) {
    hints.push(`${mover} pushed a pawn two squares to grab space and challenge ${opponent}'s center`);
  }
  if (move.flags?.includes('p')) {
    hints.push(`${mover} promoted a pawn on ${move.to}, converting the advantage immediately`);
  }
  const inCheck =
    typeof game.inCheck === 'function'
      ? game.inCheck()
      : typeof game.in_check === 'function'
      ? game.in_check()
      : false;
  if (/[\+#]/.test(move.san || '')) {
    if ((move.san || '').includes('#')) hints.push(`${mover} delivered checkmate and ended the fight`);
    else hints.push(`${mover} delivered check, forcing the ${opponent.toLowerCase()} king to respond`);
  } else if (inCheck) {
    hints.push(`${mover} forced a check, limiting ${opponent}'s replies`);
  }
  if (!move.flags?.includes('c') && move.piece === 'p') {
    const targetRank = Number(move.to?.[1]);
    if (Number.isFinite(targetRank)) {
      const isDeepPush = (side === 'W' && targetRank >= 6) || (side === 'B' && targetRank <= 3);
      if (isDeepPush) hints.push(`${mover} advanced a pawn deep into enemy territory to fix weaknesses`);
    }
  }
  if (typeof swing === 'number' && Math.abs(swing) >= 120) {
    hints.push(`This move kicked off a forcing sequence worth roughly ${Math.abs(Math.round(swing))} cp in the ${phase}`);
  }
  return hints.join(' ');
}

function shortenOpeningIdea(text: string): string {
  if (!text) return text;
  const sentences = text.split('.').map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) return text;
  const picked: string[] = [];
  for (const sentence of sentences) {
    if (!sentence) continue;
    if (!picked.length) {
      picked.push(sentence);
    } else if (picked.length < 2) {
      picked.push(sentence);
    } else {
      break;
    }
  }
  return picked.join('. ') + (picked.length ? '.' : '');
}

function detectMotifs(move: any, swing: number | null, phase: 'opening'|'middlegame'|'endgame', side: 'W'|'B'): string[] {
  if (!move) return [];
  const motifs: string[] = [];
  const captureName = move.captured ? PIECE_NAMES[move.captured] || 'piece' : null;
  if (move.flags?.includes('c')) {
    motifs.push(captureName ? `capture ${captureName}` : 'capture');
  }
  if (move.flags?.includes('b')) motifs.push('pawn break');
  if (move.flags?.includes('k') || move.flags?.includes('q')) motifs.push('castling');
  if (move.flags?.includes('p')) motifs.push('promotion');
  if (/[\+#]/.test(move.san || '')) motifs.push(move.san?.includes('#') ? 'mate' : 'check');
  const targetRank = Number(move.to?.[1]);
  if (
    move.piece === 'p' &&
    Number.isFinite(targetRank) &&
    ((side === 'W' && targetRank >= 6) || (side === 'B' && targetRank <= 3))
  ) {
    motifs.push(phase === 'opening' ? 'early pawn storm' : 'passed pawn push');
  }
  if (captureName === 'queen' || captureName === 'rook') motifs.push('wins material');
  if (Math.abs(swing ?? 0) >= 200) motifs.push('large evaluation swing');
  if (move.piece === 'n' && Math.abs(swing ?? 0) >= 120) motifs.push('knight tactic');
  if (move.piece === 'q' && move.flags?.includes('c')) motifs.push('queen aggression');
  return Array.from(new Set(motifs));
}

function summarizePosition(game: any, castle: { white: CastleSide; black: CastleSide }) {
  const board = game.board();
  let whiteMaterial = 0;
  let blackMaterial = 0;
  let whiteLane = { queenside: 0, kingside: 0 };
  let blackLane = { queenside: 0, kingside: 0 };
  let whiteCenterPawn = { d: false, e: false };
  let blackCenterPawn = { d: false, e: false };

  board.forEach((row: any[], rankIdx: number) => {
    row.forEach((piece, fileIdx) => {
      if (!piece) return;
      const square = `${FILES[fileIdx]}${8 - rankIdx}`;
      const value =
        piece.type === 'p'
          ? 1
          : piece.type === 'n' || piece.type === 'b'
          ? 3
          : piece.type === 'r'
          ? 5
          : piece.type === 'q'
          ? 9
          : 0;
      if (piece.color === 'w') whiteMaterial += value;
      else blackMaterial += value;
      if (piece.type === 'p') {
        const lane = fileIdx <= 3 ? 'queenside' : 'kingside';
        if (piece.color === 'w') whiteLane[lane as 'queenside' | 'kingside'] += 1;
        else blackLane[lane as 'queenside' | 'kingside'] += 1;
        if (FILES[fileIdx] === 'd') {
          if (piece.color === 'w') whiteCenterPawn.d = true;
          else blackCenterPawn.d = true;
        }
        if (FILES[fileIdx] === 'e') {
          if (piece.color === 'w') whiteCenterPawn.e = true;
          else blackCenterPawn.e = true;
        }
      }
    });
  });

  const materialEdge = Math.round((whiteMaterial - blackMaterial) * 100);

  const centerSummary = (() => {
    const whiteHold = whiteCenterPawn.d || whiteCenterPawn.e;
    const blackHold = blackCenterPawn.d || blackCenterPawn.e;
    if (!whiteHold && !blackHold) return 'Center is fully open';
    if (whiteHold && blackHold) return 'Center tension remains';
    if (whiteHold) return 'White holds the center pawn chain';
    return 'Black holds the center pawn chain';
  })();

  const structureTag = (() => {
    const whiteDiff = whiteLane.queenside - whiteLane.kingside;
    const blackDiff = blackLane.queenside - blackLane.kingside;
    if (whiteDiff >= 2) return 'White enjoys a queenside pawn majority';
    if (whiteDiff <= -2) return 'White massed pawns on the kingside';
    if (blackDiff >= 2) return 'Black has the queenside pawn majority';
    if (blackDiff <= -2) return 'Black focuses pawns on the kingside';
    return '';
  })();

  const kingSafety = (() => {
    const white = castle.white;
    const black = castle.black;
    if (white && black && white !== black) return 'Opposite-side castling';
    if (white && black) return 'Both kings castled the same side';
    if (!white && !black) return 'Both kings remain in the center';
    if (!white) return 'White king is still uncastled';
    if (!black) return 'Black king is still uncastled';
    return 'Mixed king safety';
  })();

  const parts = [
    centerSummary,
    structureTag,
    kingSafety,
    materialEdge ? `Material edge ${materialEdge > 0 ? 'White' : 'Black'} ${(Math.abs(materialEdge) / 100).toFixed(1)} pawns` : '',
  ].filter(Boolean);

  return {
    materialEdge,
    kingSafety,
    centerSummary,
    structureTag,
    summary: parts.join('. '),
  };
}

function applyMove(game: any, uci: string) {
  const moveSpec: any = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
  try {
    return game.move(moveSpec, { sloppy: true });
  } catch {
    return null;
  }
}

function bestSanFromUci(fen: string | null, bestUci: string | null | undefined) {
  if (!fen || !bestUci) return null;
  try {
    const scratch = new Chess(fen);
    const moveSpec: any = {
      from: bestUci.slice(0, 2),
      to: bestUci.slice(2, 4),
      promotion: bestUci.length > 4 ? bestUci[4] : undefined,
    };
    const move = scratch.move(moveSpec, { sloppy: true });
    return move?.san || null;
  } catch {
    return null;
  }
}

export function useCoachMoments(movesUci: string[], moveEvals: MoveEval[]): CoachInputs['moments'] {
  return useMemo(() => {
    const total = movesUci.length;
    const game = new Chess();
    let whiteCastle: CastleSide = null;
    let blackCastle: CastleSide = null;
    let lastSummary: string | null = null;
    let lastCenter: string | null = null;
    let lastStructure: string | null = null;
    let lastKingSafety: string | null = null;
    return movesUci.map((uci, index) => {
      const m: any = moveEvals[index] ?? {};
      const side: 'W' | 'B' = game.turn() === 'w' ? 'W' : 'B';
      const positionSummary = summarizePosition(game, { white: whiteCastle, black: blackCastle });
      const fenBefore = typeof m.fenBefore === 'string' ? m.fenBefore : game.fen();
      const move = applyMove(game, uci);
      const san =
        typeof m.san === 'string'
          ? m.san
          : typeof m.playedSan === 'string'
          ? m.playedSan
          : move?.san || uci;
      if (move?.san === 'O-O') {
        if (side === 'W') whiteCastle = 'king';
        else blackCastle = 'king';
      } else if (move?.san === 'O-O-O') {
        if (side === 'W') whiteCastle = 'queen';
        else blackCastle = 'queen';
      }
      const bestSanExplicit = typeof m.engineBestSan === 'string' ? m.engineBestSan : typeof m.bestSan === 'string' ? m.bestSan : null;
      const best =
        bestSanExplicit ||
        bestSanFromUci(fenBefore, typeof m.engineBest === 'string' ? m.engineBest : typeof m.best === 'string' ? m.best : null);
      const tag = typeof m.tag === 'string' ? m.tag : '';
      const cpBeforeVal =
        typeof m.cpBefore === 'number'
          ? m.cpBefore
          : typeof m.cpBestBefore === 'number'
          ? m.cpBestBefore
          : typeof m.bestCpBefore === 'number'
          ? m.bestCpBefore
          : null;
      const cpAfterVal = typeof m.cpAfter === 'number' ? m.cpAfter : null;
      const phase = phaseForIndex(index, total);
      const swing = cpAfterVal != null && cpBeforeVal != null ? cpAfterVal - cpBeforeVal : null;
      const lowTag = tag.toLowerCase?.() || '';
      const motifs = detectMotifs(move, swing, phase, side);
      const dropMagnitude = swing != null ? Math.abs(swing) : null;
      const importantTag = /blunder|mistake|inacc|best|genius/.test(lowTag) && lowTag !== 'good' && lowTag !== 'book';
      const keepDetail = importantTag || (dropMagnitude != null && dropMagnitude >= 45) || motifs.length > 0;
      let tacticSummary = keepDetail ? describeMoveIdea(move, cpBeforeVal, cpAfterVal, phase, side, game) : '';
      if (keepDetail && index <= 2) tacticSummary = shortenOpeningIdea(tacticSummary);
      const motifsForMove = keepDetail ? motifs : [];
      const isEarly = index < 4;
      const summaryChanged = positionSummary.summary && positionSummary.summary !== lastSummary;
      const centerChanged = positionSummary.centerSummary && positionSummary.centerSummary !== lastCenter;
      const structureChanged = positionSummary.structureTag && positionSummary.structureTag !== lastStructure;
      const kingChanged = positionSummary.kingSafety && positionSummary.kingSafety !== lastKingSafety;
      if (positionSummary.summary) lastSummary = positionSummary.summary;
      if (positionSummary.centerSummary) lastCenter = positionSummary.centerSummary;
      if (positionSummary.structureTag) lastStructure = positionSummary.structureTag;
      if (positionSummary.kingSafety) lastKingSafety = positionSummary.kingSafety;
      const fenAfter = typeof m.fenAfter === 'string' ? m.fenAfter : game.fen();
      const evalBeforeLabel = evalLabelFromWhiteCp(cpBeforeVal);
      const afterWhite = typeof m.cpAfterWhite === 'number' ? m.cpAfterWhite : cpAfterWhiteValue(m);
      const evalAfterLabel = evalLabelFromWhiteCp(afterWhite);
      return {
        index,
        moveNo: Math.floor(index / 2) + 1,
        side,
        san,
        best,
        tag,
        cpBefore: cpBeforeVal,
        cpAfter: cpAfterVal,
        deltaCp: swing ?? undefined,
        fenBefore,
        fenAfter,
        evalBeforeLabel,
        evalAfterLabel,
        phase,
        positionSummary: !isEarly && summaryChanged ? positionSummary.summary : undefined,
        kingSafety: !isEarly && kingChanged ? positionSummary.kingSafety : undefined,
        materialEdge: !isEarly ? positionSummary.materialEdge : null,
        centerSummary: !isEarly && centerChanged ? positionSummary.centerSummary : undefined,
        structureTag: !isEarly && structureChanged ? positionSummary.structureTag : undefined,
        tacticSummary: tacticSummary || undefined,
        motifs: motifsForMove,
      };
    });
  }, [movesUci, moveEvals]);
}
