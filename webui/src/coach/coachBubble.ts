import { Chess } from '../chess-compat';
import type { CoachGate, MomentItem } from '../types/coach';

export type CoachBubble = {
  title: string;
  body: string;
  emoji?: string;
  gate?: CoachGate;
};

type AnchorKind = 'center' | 'target' | 'pin' | 'kingSafety' | 'hangs' | 'space' | 'opens' | 'develop' | 'loose';

type Anchor = {
  kind: AnchorKind;
  text: string;
  detail?: string;
};

type BubbleMemory = {
  bodyHistory: string[];
  anchorHistory: string[];
  templateHistory: string[];
};

const CENTER_SQUARES = new Set(['d4', 'd5', 'e4', 'e5']);
const KNIGHT_CENTER_SQUARES = new Set(['c3', 'f3', 'c6', 'f6']);
const HISTORY_LIMIT = 6;
const QUIET_TAGS = new Set(['book', 'best', 'excellent', 'good']);
const QUIET_CP_DELTA = 80;
const LARGE_SWING_CP = 150;
const CAUTION_ANCHORS = new Set<AnchorKind>(['hangs', 'loose']);
const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
const KNIGHT_FOCUSES: Record<string, string[]> = {
  f3: ['e5', 'd4'],
  c3: ['d5', 'e4'],
  f6: ['e4', 'd5'],
  c6: ['d4', 'e5'],
};
const HOT_SQUARE_HINTS: Record<string, string> = {
  c7: 'pressuring c7, the queenside weakness',
  f7: 'staring at f7, the king shield',
  h7: 'eyeing h7 for mating ideas',
  b7: 'pressing the b7 pawn next to the rook',
  g7: 'targeting g7, the fianchetto square',
  b2: 'watching b2 and the rook on a1',
  g2: 'poking at g2 near the king',
  e5: 'controlling the e5 outpost',
  d5: 'contesting d5, the central lever',
  e4: 'challenging e4 immediately',
  d4: 'fighting for d4',
};
type MoveFacts = {
  structuralChange: boolean;
  tacticEvent: boolean;
};
const QUIET_PURPOSE: Record<AnchorKind, string> = {
  center: 'you keep the center contested',
  target: 'you keep pressure on that weakness',
  pin: 'their piece stays tied down',
  kingSafety: 'your king stays safer for the middlegame',
  hangs: 'you must defend it immediately',
  loose: 'you can guard it before tactics erupt',
  space: 'you can expand on that flank soon',
  opens: 'your rooks can jump in later',
  develop: 'your pieces coordinate faster',
};
const FIANCHETTO_HINTS: Record<string, string> = {
  g6: 'preparing Bg7 and shielding f5',
  g3: 'preparing Bg2 and shielding f4',
  b6: 'readying Bb7 and guarding c5',
  b3: 'readying Bb2 and covering c4',
};

const LABEL_META: Record<
  string,
  { label: string; article: string | null; flair?: string; tone: keyof typeof TEMPLATE_POOLS }
> = {
  book: { label: 'book move', article: 'a', tone: 'book' },
  best: { label: 'best', article: null, flair: '!', tone: 'best' },
  excellent: { label: 'excellent', article: null, flair: '!', tone: 'best' },
  good: { label: 'good', article: null, tone: 'good' },
  inaccuracy: { label: 'inaccuracy', article: 'an', tone: 'inaccuracy' },
  mistake: { label: 'mistake', article: 'a', tone: 'mistake' },
  blunder: { label: 'blunder', article: 'a', flair: '??', tone: 'blunder' },
};

const TEMPLATE_POOLS = {
  book: [
    'Classic theory. {anchor}',
    'Straight into known territory. {anchor}',
    'Seen it a million times—still fun.',
    'Textbook reply—{anchor}.',
  ],
  best: [
    'Love it—{anchor}.',
    'Clean move: {anchor}.',
    'Nice touch—{anchor}, and you stay flexible.',
    'Big improvement here—{anchor}.',
  ],
  good: [
    'Solid choice—{anchor}.',
    'Makes sense: {anchor}.',
    'Practical and calm—{anchor}.',
  ],
  inaccuracy: [
    'A bit loose—{anchor}.',
    'Close, but {anchor}. Keep an eye on their reply.',
    'Room for improvement—{anchor}.',
  ],
  mistake: [
    'That gives them chances—{anchor}.',
    'Oops—{anchor}. Time to tighten up.',
    'Careful—{anchor}.',
  ],
  blunder: [
    'Yikes—{anchor}. Just like that.',
    'That drops material—{anchor}.',
    'This backfires—{anchor}.',
  ],
  caution: [
    'Careful—{anchor}.',
    'Heads up: {anchor}.',
    'Easy to overlook—{anchor}.',
  ],
};

function calcDeltaCp(moment: MomentItem) {
  const raw = Number(moment?.deltaCp);
  return Number.isFinite(raw) ? Math.abs(raw) : 0;
}

function motifsContainTactic(moment: MomentItem) {
  if (!Array.isArray(moment?.motifs)) return false;
  return moment!.motifs!.some((motif) => /tactic|capture|fork|pin|check/i.test(motif));
}

function detectMoveFacts(moment: MomentItem, context: MoveContext | null): MoveFacts {
  const move = context?.move;
  const san = String(move?.san || moment?.san || '');
  const structural =
    Boolean(moment?.structureTag) ||
    Boolean(move && move.piece === 'p' && (CENTER_SQUARES.has(move.to) || /x/.test(move.san || ''))) ||
    Boolean(move?.flags && /[cbep]/.test(move.flags));
  const tactic = Boolean(moment?.tacticSummary) || /[x+#]/.test(san) || motifsContainTactic(moment);
  return { structuralChange: structural, tacticEvent: tactic };
}

function classifyCoachGate(moment: MomentItem, facts: MoveFacts, hangingVerified: boolean): CoachGate {
  const tag = normalizeTag(moment?.tag);
  const delta = calcDeltaCp(moment);
  const isQuiet = QUIET_TAGS.has(tag) && !facts.structuralChange && !facts.tacticEvent && delta < QUIET_CP_DELTA;
  const criticalTag = tag === 'blunder' || tag === 'mistake' || tag === 'inaccuracy';
  const allowWhy = !isQuiet && (criticalTag || facts.structuralChange || facts.tacticEvent || hangingVerified);
  const allowDetails = criticalTag || delta >= LARGE_SWING_CP;
  return { isQuiet, allowWhy, allowDetails };
}

export function buildCoachBubbles(moments: MomentItem[] | null | undefined): Map<number, CoachBubble> {
  const map = new Map<number, CoachBubble>();
  if (!Array.isArray(moments)) return map;
  const memory: BubbleMemory = { bodyHistory: [], anchorHistory: [], templateHistory: [] };
  for (const moment of moments) {
    if (!moment || typeof moment.index !== 'number') continue;
    const context = prepareMoveContext(moment);
    const bubble = buildBubble(moment, context, memory);
    if (bubble) map.set(moment.index, bubble);
  }
  return map;
}

function buildBubble(moment: MomentItem, context: MoveContext | null, memory: BubbleMemory): CoachBubble | null {
  const san = moment?.san || '(?)';
  const normalizedTag = normalizeTag(moment?.tag);
  const meta = LABEL_META[normalizedTag] || LABEL_META.good;
  const facts = detectMoveFacts(moment, context);
  const gateHint = classifyCoachGate(moment, facts, false);
  const anchors = gatherAnchors(moment, context, gateHint.isQuiet);
  const anchor = chooseAnchor(anchors, memory);
  const gate = classifyCoachGate(moment, facts, anchor?.kind === 'hangs');
  if (gate.isQuiet) {
    const quietSentence = buildQuietSentence(moment, context, anchor);
    if (!quietSentence) return null;
    return { title: buildTitle(san, meta), body: quietSentence, gate };
  }
  const toneKey = anchor && CAUTION_ANCHORS.has(anchor.kind) ? 'caution' : meta.tone;
  const template = chooseTemplate(toneKey, memory);
  const anchorText = anchor ? ensureSecondPerson(anchor.text) : '';
  const sentenceLimit = gate.isQuiet ? 1 : 2;
  const bodyRaw = anchorText
    ? template.includes('{anchor}')
      ? template.replace('{anchor}', anchorText)
      : `${template} ${anchorText}`.trim()
    : fallbackSentence(toneKey, gate);
  const body = enforceSentenceLimit(cleanWhitespace(bodyRaw), sentenceLimit);
  remember(memory.bodyHistory, body.toLowerCase());
  remember(memory.templateHistory, template);
  const title = buildTitle(san, meta);
  return { title, body, gate };
}

function normalizeTag(tag: string | null | undefined) {
  const value = String(tag || '').toLowerCase();
  if (value.includes('book')) return 'book';
  if (value.includes('blunder')) return 'blunder';
  if (value.includes('mistake') || value.includes('error')) return 'mistake';
  if (value.includes('inacc')) return 'inaccuracy';
  if (value.includes('best') || value.includes('brilliant') || value.includes('genius')) return 'best';
  if (value.includes('excel')) return 'excellent';
  return 'good';
}

function buildTitle(san: string, meta: { label: string; article: string | null; flair?: string }) {
  const labelText = meta.article ? `${meta.article} ${meta.label}` : meta.label;
  const flair = meta.flair || '';
  return `${san} is ${labelText}${flair}`;
}

function gatherAnchors(moment: MomentItem, context: MoveContext | null, quietCandidate: boolean): Anchor[] {
  const anchors: Anchor[] = [];
  const move = context?.move;
  if (!move) return anchors;
  const capture = captureAnchor(move);
  if (capture) anchors.push(capture);
  anchors.push(...centerAnchors(move));
  anchors.push(...knightAnchors(move));
  anchors.push(...bishopAnchors(moment, move, context));
  anchors.push(...queenAnchors(moment, move));
  anchors.push(...pawnAnchors(moment, move, context));
  anchors.push(...castlingAnchors(move));
  anchors.push(...hotSquareAnchors(move, context));
  if (!anchors.length) anchors.push(...fallbackAnchors(moment, move));
  const hanging = hangingAnchor(move, context, quietCandidate);
  if (hanging) anchors.unshift(hanging);
  return anchors;
}

function centerAnchors(move: any): Anchor[] {
  const anchors: Anchor[] = [];
  if (move.piece === 'p' && CENTER_SQUARES.has(move.to)) {
    anchors.push({
      kind: 'center',
      text: `you claim ${move.to} and bully the center`,
      detail: `claiming ${move.to} to contest the center`,
    });
  }
  return anchors;
}

function knightAnchors(move: any): Anchor[] {
  const anchors: Anchor[] = [];
  if (move.piece !== 'n') return anchors;
  if (KNIGHT_CENTER_SQUARES.has(move.to)) {
    const focus = KNIGHT_FOCUSES[move.to] || [];
    const detail = focus.length ? `covering ${focus.join(' and ')}` : 'jumping toward the center';
    anchors.push({ kind: 'center', text: `you jump toward the center and cover key squares`, detail });
  } else if (/^[bcg]1$|^[bcg]8$/.test(move.from)) {
    anchors.push({
      kind: 'develop',
      text: `you reroute that knight to find better outposts`,
      detail: `rerouting from ${move.from} to find a safer outpost`,
    });
  }
  return anchors;
}

function bishopAnchors(moment: MomentItem, move: any, context: MoveContext | null): Anchor[] {
  const anchors: Anchor[] = [];
  if (move.piece !== 'b') return anchors;
  const before = context ? new Chess(context.beforeFen) : null;
  if (moment.side === 'W' && move.from === 'c1' && move.to === 'f4') {
    anchors.push({ kind: 'target', text: 'you bring out the London bishop eyeing c7', detail: 'eyeing c7 from f4' });
  }
  if (moment.side === 'W' && move.to === 'g5') {
    const knight = before?.get('f6');
    if (knight?.type === 'n') anchors.push({ kind: 'pin', text: 'you pin their knight and annoy the king', detail: 'pinning the knight on f6' });
  }
  if (moment.side === 'B' && move.to === 'g4') {
    const knight = before?.get('f3');
    if (knight?.type === 'n') anchors.push({ kind: 'pin', text: 'you pin the knight on f3 and poke the king side', detail: 'pinning Nf3 and pressuring the king' });
  }
  if (move.to === 'g7' || move.to === 'b7') {
    anchors.push({
      kind: 'target',
      text: 'that fianchetto bishop will breathe fire down the long diagonal',
      detail: `staring down the long diagonal from ${move.to}`,
    });
  }
  return anchors;
}

function queenAnchors(moment: MomentItem, move: any): Anchor[] {
  const anchors: Anchor[] = [];
  if (move.piece !== 'q') return anchors;
  if (move.to === 'b6') {
    anchors.push({ kind: 'target', text: 'you eyeball b2 and d4 at the same time', detail: 'eyeing b2 and d4' });
  }
  if (move.to === 'h5') {
    anchors.push({ kind: 'target', text: 'you glance at h7 and dare them to slip', detail: 'staring at h7' });
  }
  return anchors;
}

function pawnAnchors(moment: MomentItem, move: any, context: MoveContext | null): Anchor[] {
  const anchors: Anchor[] = [];
  if (move.piece !== 'p') return anchors;
  const before = context ? new Chess(context.beforeFen) : null;
  if (move.to === 'c5' && moment.side === 'B') {
    const target = before?.get('d4');
    const detail = target?.type === 'p' && target.color === 'w'
      ? 'challenging the d4 pawn immediately'
      : 'grabbing queenside space';
    anchors.push({ kind: 'space', text: 'you push ...c5 to grab queenside space', detail });
  }
  if (!move.flags?.includes('c') && FIANCHETTO_HINTS[move.to]) {
    anchors.push({
      kind: 'kingSafety',
      text: `you prepare a fianchetto with ${move.to}`,
      detail: FIANCHETTO_HINTS[move.to],
    });
  }
  if (move.to === 'c4' && moment.side === 'W') {
    anchors.push({ kind: 'space', text: 'you shove c4 to clamp down on the queenside', detail: 'clamping the queenside via c4' });
  }
  if (move.san === 'exf4' || move.san === 'cxd4') {
    anchors.push({ kind: 'opens', text: 'you open that file and change the pawn structure', detail: 'opening the file for your rook' });
  }
  return anchors;
}

function castlingAnchors(move: any): Anchor[] {
  if (move.san === 'O-O' || move.san === 'O-O-O') {
    return [{
      kind: 'kingSafety',
      text: 'you tuck the king away and link the rooks',
      detail: 'the king tucks away and the rooks connect',
    }];
  }
  return [];
}

function fallbackAnchors(moment: MomentItem, move: any): Anchor[] {
  const anchors: Anchor[] = [];
  const to = move?.to;
  if (!to) return anchors;
  const color = move?.color || (moment.side === 'B' ? 'b' : 'w');
  if (move.piece === 'n') {
    const focus = KNIGHT_FOCUSES[to] || [];
    const detail = focus.length ? `it covers ${focus.join(' and ')}` : `it jumps toward ${to}`;
    anchors.push({ kind: 'center', text: 'you jump toward the center', detail });
  } else if (move.piece === 'b') {
    const diag = (to === 'f4' && moment.side === 'W') ? 'c7' : (to === 'g5' ? 'f6' : '');
    const detail = diag ? `it eyes ${diag}` : `it activates on the diagonal from ${to}`;
    anchors.push({ kind: 'target', text: 'you activate the bishop on a long diagonal', detail });
  } else if (move.piece === 'p') {
    if (CENTER_SQUARES.has(to)) {
      anchors.push({ kind: 'center', text: `you claim ${to} and fight for the center`, detail: `it controls ${to}` });
    } else {
      anchors.push({ kind: 'space', text: 'you gain space with a pawn push', detail: `it grabs space on ${to}` });
    }
  } else if (move.piece === 'q' && to === 'b6') {
    anchors.push({ kind: 'target', text: 'you eyeball b2 and d4 at the same time', detail: 'it eyes b2 and d4' });
  } else if (move.piece === 'r') {
    anchors.push({ kind: 'develop', text: 'you bring the rook into play', detail: `it lines up along the ${to[0]}-file` });
  }
  if ((move.san === 'O-O' || move.san === 'O-O-O') && !anchors.length) {
    anchors.push({
      kind: 'kingSafety',
      text: 'you tuck the king away and link the rooks',
      detail: 'bringing the king to safety and connecting the rooks',
    });
  }
  if (!anchors.length && color === 'w' && move.piece === 'b' && to === 'f4') {
    anchors.push({ kind: 'target', text: 'you bring out the London bishop eyeing c7', detail: 'eyeing c7' });
  }
  return anchors;
}

function captureAnchor(move: any): Anchor | null {
  if (!move?.flags || !move.flags.includes('c')) return null;
  const captured = PIECE_NAMES[move.captured] || 'piece';
  return {
    kind: 'target',
    text: `you capture the ${captured} on ${move.to}`,
    detail: `removing the ${captured} on ${move.to}`,
  };
}

function hangingAnchor(move: any, context: MoveContext | null, quietCandidate: boolean): Anchor | null {
  if (!context) return null;
  const afterFen = context.afterFen;
  const attackerCount = countAttackers(afterFen, move.to, move.color === 'w' ? 'b' : 'w');
  if (!attackerCount) return null;
  const defenderCount = countAttackers(flipTurn(afterFen), move.to, move.color);
  if (defenderCount >= attackerCount) return null;
  const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const pieceName = names[move.piece] || 'piece';
  const verified = verifyImmediateLoss(context, move.to, move.color);
  if (!verified) {
    if (quietCandidate) return null;
    return { kind: 'loose', text: `${pieceName} on ${move.to} could become a target` };
  }
  return { kind: 'hangs', text: `${pieceName} on ${move.to} is hanging` };
}

function countAttackers(fen: string, square: string, color: 'w' | 'b') {
  const parts = fen.split(' ');
  if (parts.length < 2) return 0;
  const clone = [...parts];
  clone[1] = color;
  let attackers = 0;
  try {
    const chess = new Chess(clone.join(' '));
    const moves = chess.moves({ verbose: true });
    attackers = moves.filter((m) => m.to === square).length;
  } catch {
    attackers = 0;
  }
  return attackers;
}

function attackedSquares(fen: string, square: string, color: 'w' | 'b') {
  try {
    const parts = fen.split(' ');
    if (parts.length < 2) return [];
    parts[1] = color;
    const chess = new Chess(parts.join(' '));
    const moves = chess.moves({ verbose: true });
    return moves.filter((m) => m.from === square).map((m) => m.to);
  } catch {
    return [];
  }
}

function hotSquareAnchors(move: any, context: MoveContext | null) {
  if (!context) return [];
  const attacks = attackedSquares(context.afterFen, move.to, move.color);
  const hit = attacks.find((sq) => HOT_SQUARE_HINTS[sq]);
  if (!hit) return [];
  return [{
    kind: 'target',
    text: `you aim at ${hit} with your ${PIECE_NAMES[move.piece] || 'piece'}`,
    detail: HOT_SQUARE_HINTS[hit],
  }];
}

function verifyImmediateLoss(context: MoveContext, square: string, moverColor: 'w' | 'b') {
  try {
    const opponentColor = moverColor === 'w' ? 'b' : 'w';
    const root = new Chess(context.afterFen);
    const enemyMoves = root.moves({ verbose: true });
    const captureCandidates = enemyMoves.filter((m) => m.to === square && m.flags?.includes('c'));
    for (const capture of captureCandidates) {
      const test = new Chess(context.afterFen);
      const performed = test.move({ from: capture.from, to: capture.to, promotion: capture.promotion });
      if (!performed) continue;
      const replies = test.moves({ verbose: true }).filter((m) => m.to === capture.to && m.color === moverColor);
      const enemyValue = PIECE_VALUES[capture.piece] || 1;
      if (!replies.length) return true;
      const safeReply = replies.some((reply) => (PIECE_VALUES[reply.piece] || 1) >= enemyValue);
      if (!safeReply) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function flipTurn(fen: string) {
  const parts = fen.split(' ');
  if (parts.length < 2) return fen;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  return parts.join(' ');
}

function chooseAnchor(anchors: Anchor[], memory: BubbleMemory): Anchor | null {
  if (!anchors.length) return null;
  const preferred = anchors.find((anchor) => !memory.anchorHistory.includes(anchor.kind));
  const picked = preferred || anchors[0];
  remember(memory.anchorHistory, picked.kind);
  return picked;
}

function chooseTemplate(tone: keyof typeof TEMPLATE_POOLS, memory: BubbleMemory) {
  const pool = TEMPLATE_POOLS[tone] || TEMPLATE_POOLS.good;
  const candidate = pool.find((tpl) => !memory.templateHistory.includes(tpl));
  return candidate || pool[0];
}

function fallbackSentence(tone: keyof typeof TEMPLATE_POOLS, gate: CoachGate) {
  if (tone === 'blunder') return 'Careful—this hands them material and momentum.';
  if (tone === 'mistake' || tone === 'inaccuracy') return 'This gives the opponent an easy target, so stay sharp.';
  if (tone === 'book') return 'Textbook theory move; keep development smooth.';
  if (gate.isQuiet) return 'Calm move that keeps your options open.';
  return 'Practical choice that keeps the plan flexible.';
}

function buildQuietSentence(moment: MomentItem, context: MoveContext | null, anchor: Anchor | null) {
  const move = context?.move;
  const action = describeQuietAction(move, moment);
  const anchorPhrase = anchor?.detail || stripSecondPerson(anchor?.text || '');
  const purpose = anchor ? (QUIET_PURPOSE[anchor.kind] || 'you keep the plan ready') : '';
  if (anchorPhrase && purpose) {
    return enforceSentenceLimit(`${action}, ${anchorPhrase}, so ${purpose}.`, 1);
  }
  if (!anchorPhrase && move) {
    const fallbackAnchor = fallbackAnchors(moment, move)[0];
    if (fallbackAnchor?.detail) {
      const fallbackPurpose = QUIET_PURPOSE[fallbackAnchor.kind] || 'you keep the plan ready';
      return enforceSentenceLimit(`${action}, ${fallbackAnchor.detail}, so ${fallbackPurpose}.`, 1);
    }
  }
  return 'Develops and keeps options open.';
}

function describeQuietAction(move: any, moment: MomentItem) {
  if (!move) return 'Improves the position calmly';
  const san = String(move.san || moment?.san || '');
  if (san === 'O-O') return 'Castles short to tuck the king';
  if (san === 'O-O-O') return 'Castles long to launch the rooks';
  const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
  const pieceName = names[move.piece] || 'piece';
  if (move.flags?.includes('c')) {
    const captured = PIECE_NAMES[move.captured] || 'piece';
    return `Captures the ${captured} on ${move.to}`;
  }
  if (move.piece === 'n') return 'Develops the knight toward the center';
  if (move.piece === 'b') return 'Develops the bishop to an active diagonal';
  if (move.piece === 'p') return `Pushes the ${pieceName} to ${move.to}`;
  if (move.piece === 'q') return `Activates the queen on ${move.to}`;
  if (move.piece === 'r') return `Places the rook on ${move.to}`;
  return `Improves the ${pieceName}`;
}

function stripSecondPerson(text: string | undefined) {
  if (!text) return '';
  return text.replace(/^(you|your)\s+/i, '').replace(/^that\s+/i, '').trim();
}

function ensureSecondPerson(text: string) {
  if (!text) return 'you keep the plan rolling';
  if (/^(you|your|that|those|this)/i.test(text)) return text;
  return `you ${text}`;
}

function cleanWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function enforceSentenceLimit(text: string, limit: number) {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= limit) return parts.join(' ');
  return parts.slice(0, limit).join(' ');
}

function remember(history: string[], value: string) {
  if (!value) return;
  history.push(value);
  if (history.length > HISTORY_LIMIT) history.shift();
}

type MoveContext = {
  move: any;
  beforeFen: string;
  afterFen: string;
};

function prepareMoveContext(moment: MomentItem): MoveContext | null {
  const fenBefore = moment?.fenBefore;
  const san = moment?.san;
  if (!fenBefore || !san) return null;
  try {
    const chess = new Chess(fenBefore);
    const move = chess.move(san, { sloppy: true });
    if (!move) return null;
    const afterFen = moment.fenAfter || chess.fen();
    return { move, beforeFen: fenBefore, afterFen };
  } catch {
    return null;
  }
}
