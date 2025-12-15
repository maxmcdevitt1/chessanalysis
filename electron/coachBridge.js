'use strict';

const { ipcMain } = require('electron');
const http = require('http');
const https = require('https');

/* ------------------------------- Config ----------------------------------- */

// Default model can be overridden via env; use a small, likely-available default and fall back if missing.
const DEFAULT_MODEL = process.env.COACH_MODEL || 'llama3.2:3b-instruct-q5_K_M';
const FALLBACK_MODEL = 'llama3.2:1b-instruct-q8_0';
const COACH_DEBUG = process.env.COACH_DEBUG === '1';
// Keep batches small to improve adherence to "N items" instruction
const TOKENS_PER_ITEM = parseInt(process.env.COACH_TOKENS_PER_ITEM || '256', 10);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const TIMEOUT_MS = Number(process.env.COACH_TIMEOUT_MS || 60000);
const AUTO_PULL = String(process.env.AUTO_PULL_COACH || '1') === '1';
const COACH_KEEP_ALIVE = process.env.COACH_KEEP_ALIVE || '2m';
const NUM_CTX = Number(process.env.COACH_NUM_CTX || 1536);
const MAX_COACH_NOTES = Number(process.env.COACH_MAX_NOTES || '10');
const SECTION_SCHEMA_TEXT = `{
  "executive": {"text": string},
  "opening": {"text": string},
  "middlegame": {"text": string},
  "endgame": {"text": string},
  "keyMoments": {"bullets": ["string","string","string"]},
  "lessons": {"bullets": ["string","string","string"]}
}`;
const NOTE_SCHEMA_TEXT = `{
  "title": string,
  "tag": "Best"|"Good"|"Inaccuracy"|"Mistake"|"Blunder",
  "one_liner": string,
  "why": ["string","string"],
  "better": {"move": string, "idea": string},
  "habit": string
}`;
const NOTE_SYSTEM_PROMPT = [
  'You are a titled chess coach producing concise per-move feedback.',
  'FOLLOW THESE RULES EXACTLY:',
  `- Output ONLY valid JSON matching this schema:\n${NOTE_SCHEMA_TEXT}`,
  '- one_liner <= 140 characters. Each why entry <= 110 characters.',
  '- If tag is Best or Good, better.move and better.idea MUST be empty strings.',
  '- For Inaccuracy/Mistake/Blunder, provide exactly one better move (SAN) and a one-sentence idea.',
  '- Never mention cp, centipawn, motifs, “multi-move tactic”, or debug headings.',
  '- Every explanation must cite one concrete positional fact (king safety, open file/diagonal, center tension, hanging piece, or tactic).',
  '- Use provided eval labels to describe shifts, e.g. "This shifts the game from equal to a clear edge for Black."',
  '- Avoid generic praise unless it immediately states what it enables.',
  'Available inputs will be listed below.',
].join('\n');

const SECTION_SYSTEM_PROMPT = [
  'You are a Chess.com-style coach summarising a single game. Output JSON only.',
  `Schema:\n${SECTION_SCHEMA_TEXT}`,
  'Rules:',
  '- Executive/Opening/Middlegame/Endgame texts must be <=2 sentences each.',
  '- Each text must reference either a move number (e.g., "move 14") or the detected opening name.',
  '- Use concrete anchors: mention plans, structures, or turning points—no generic filler or contradictions.',
  '- Key moments require exactly 3 bullets formatted "Move X: ... → Habit: ...".',
  '- Lessons require exactly 3 bullets formatted "Pattern: ... → Fix: ...".',
  '- Do not list multiple alternative moves unless a PV line is provided; otherwise suggest a plan.',
  '- Never include evaluation numbers, centipawns, or engine jargon.',
].join('\n');

function log(...args) { if (COACH_DEBUG) console.log('[coach]', ...args); }

// Node18+ global fetch ok in Electron main; polyfill if you need older
// (v18 ships fetch; keep a fallback for safety)
let _fetch = global.fetch;
if (!_fetch) {
  try { _fetch = require('node-fetch'); } catch {}
}

function fmt(n) { return Number.isFinite(n) ? Math.round(n) : '-'; }
function fmtPercent(n) { return Number.isFinite(n) ? `${Math.round(n)}%` : '—'; }

function describePhaseFocus(totalPlies) {
  if (!Number.isFinite(totalPlies) || totalPlies <= 0) return 'balanced middlegame';
  if (totalPlies < 28) return 'sharp miniature';
  if (totalPlies < 60) return 'middlegame battle';
  return 'long endgame grind';
}

function phaseForPly(ply, totalPlies) {
  if (!Number.isFinite(ply)) return 'middlegame';
  if (ply < 20) return 'opening';
  if (ply > Math.max(totalPlies - 16, 54)) return 'endgame';
  return 'middlegame';
}

function safeMoments(list) {
  return Array.isArray(list) ? list : [];
}

function keySwingMoment(moments) {
  const list = safeMoments(moments);
  let best = null;
  for (const m of list) {
    const before = Number(m?.cpBefore);
    const after = Number(m?.cpAfter);
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    const delta = after - before;
    const absDelta = Math.abs(delta);
    if (!best || absDelta > best.absDelta) {
      best = { ...m, delta, absDelta };
    }
  }
  return best;
}

function heuristicSections(inputs = {}) {
  const summary = inputs?.summary || {};
  const total = safeMoments(inputs?.moments).length;
  const hasMiddlegame = total >= 18;
  const hasEndgame = total >= 34;
  const swing = keySwingMoment(inputs?.moments);
  const swingLine = swing
    ? `Key moment: move ${swing.moveNo} (${swing.side === 'W' ? 'White' : 'Black'} ${swing.san}) shifted the evaluation by ${Math.round(swing.delta || 0)} cp during the ${swing.phase || 'middlegame'}.`
    : 'The evaluation stayed balanced; no single move decided the game.';
  const openingLine = openingInsight(summary?.opening);
  return {
    executiveSummary: `This game began as ${summary?.opening || 'an unknown opening'}. Accuracy: White ${fmtPercent(summary?.whiteAcc)} vs Black ${fmtPercent(summary?.blackAcc)}. Expect a ${describePhaseFocus(total)} with emphasis on king safety and central control.`,
    openingReview: openingLine,
    middlegameReview: hasMiddlegame
      ? 'Piece coordination and awareness of forcing replies decided the struggle. Slow moves that ignored opponent threats led to swings.'
      : 'No true middlegame battle unfolded; the result was decided before the pieces fully mobilised.',
    endgameReview: hasEndgame
      ? 'When pieces left the board, king activity and pawn structure mattered most. Bringing the king toward the center earlier would have helped.'
      : 'No endgame phase occurred; the game was resolved before heavy simplification.',
    keyMoments: [swingLine],
    lessons: pickLessons(summary, swing),
  };
}

const OPENING_PLANS = [
  { match: /Sicilian/i, text: 'Sicilian structures emphasise countering White\'s center with ...d5/...e5 and queenside play; remember to develop the queenside knight and strike back in the center.' },
  { match: /French/i, text: 'The French all but guarantees a locked center; press on the queenside as Black or prepare f3/e4 breaks as White.' },
  { match: /Caro/i, text: 'The Caro-Kann yields a sturdy pawn chain. White aims for space on the kingside, Black targets the c-file and breaks with ...c5.' },
  { match: /King.*Indian/i, text: 'King’s Indian systems revolve around kingside pawn storms for Black while White must push queenside pawns and restrain ...f5.' },
  { match: /Queen'?s Gambit/i, text: 'Queen’s Gambit positions revolve around c-file control and minority attacks; White presses on the queenside while Black counterstrikes in the center.' },
  { match: /London|Colle/i, text: 'Systems with Bd3 and c3 aim for a lasting pawn chain and kingside pressure; watch the e5 square and prepare timely pawn breaks.' },
  { match: /English/i, text: 'The English focuses on slow queenside expansion and controlling d5. Use flank pawn pushes to provoke weaknesses before committing in the center.' },
  { match: /Pirc|Modern/i, text: 'Pirc/Modern defenses keep a hypermodern center; White should seize space and restrict ...c5/...e5, while Black looks for counterpunches with pawn breaks.' },
];

function openingInsight(name) {
  if (!name) return 'Development mostly followed classical principles. Support advanced pieces before launching pawn thrusts so the center remains stable.';
  const hit = OPENING_PLANS.find((item) => item.match.test(name));
  if (hit) return hit.text;
  if (/d4\s*e6|d4\s*d5/.test(name)) return 'Queen pawn structures reward steady development and c-file pressure; keep the dark squares under control before stretching.';
  if (/e4\s*e5/.test(name)) return 'Open games reward rapid development and early central exchanges; fight for e4/e5 and watch for tactics on the f-file.';
  return 'Development mostly followed classical principles. Support advanced pieces before launching pawn thrusts so the center remains stable.';
}

const openingSnippets = [
  { match: /^d4/, text: 'Queen pawn start — aims for long-term central control and flexible pawn breaks.' },
  { match: /^e4/, text: 'King pawn start — invites open files and tactical fights.' },
  { match: /^c4/, text: 'English-style move — pressures the center from the flank and keeps plans flexible.' },
  { match: /^Nf3/, text: 'Reti development — keeps pawn choices in reserve while developing quickly.' },
];

const BOOK_OPENING_TEMPLATES = {
  e4: {
    idea: 'Claims central space and frees two pieces.',
    plan: 'Develop Nf3/Nc3, bring bishops out, then castle.',
  },
  d4: {
    idea: 'Claims space and controls e5/c5 squares.',
    plan: 'Support with Nf3, c4, and Bf4/Bg5 before castling.',
  },
  c4: {
    idea: 'Pressures d5 from the flank while staying flexible.',
    plan: 'Use Nc3 and g3/Bg2, then aim for d4 when ready.',
  },
  nf3: {
    idea: 'Develops flexibly without committing the center.',
    plan: 'Follow with g3/c4 or d4 depending on Black’s reply.',
  },
};

const PRIMARY_REASON_TEXT = {
  development: 'develops a piece',
  defense: 'stops a threat',
  consolidation: 'improves the worst piece',
  attack: 'creates a threat',
  tactic: 'creates a threat',
  mistake: 'misses a tactic',
};

const PLAN_TEXT = {
  development: 'Plan: keep developing and castle early.',
  defense: 'Plan: neutralize pressure and guard the king.',
  consolidation: 'Plan: coordinate rooks and cover weak squares.',
  attack: 'Plan: bring more pieces toward the target.',
  tactic: 'Plan: calculate forcing lines before committing.',
  mistake: 'Plan: reset the plan and repair the structure.',
};

const WHY_LINES = {
  development: 'Why it mattered: guarded central squares before new plans.',
  defense: 'Why it mattered: shielded the king from looming pressure.',
  consolidation: 'Why it mattered: tightened the structure before counterplay.',
  attack: 'Why it mattered: maintained threats and limited counterplay.',
  tactic: 'Why it mattered: swung momentum through concrete threats.',
  mistake: 'Why it mattered: handed the opponent easy counterplay.',
};

const tagInsights = {
  blunder: [
    'overlooked a direct tactic near the king.',
    'left a piece undefended and allowed an immediate rebuttal.',
    'ignored a forcing capture; always count checks and captures.',
  ],
  mistake: [
    'misjudged the move order, letting the opponent seize the initiative.',
    'attacked before the pieces were coordinated.',
    'weakened the pawn shield without creating counterplay.',
  ],
  inaccuracy: [
    'played a natural move but gave the opponent time to equalize.',
    'spent a tempo on a slow plan instead of improving the worst piece.',
    'missed the chance to create dual threats.',
  ],
  best: [
    'kept the pressure and matched the engine’s priorities.',
    'harmonized the pieces and limited counterplay.',
    'anticipated the opponent’s tricks and stayed ahead.',
  ],
  book: [
    'stayed inside opening theory and kept development smooth.',
    'followed a classical plan with a solid structure.',
    'maintained flexibility, waiting for the right pawn break.',
  ],
  default: [
    'kept the balance; continue improving piece placement.',
    'played patiently, leaving options open for both flanks.',
    'maintained a sturdy structure; watch the opponent’s forcing tries.',
  ],
};

function pickInsight(list, seed) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list[Math.abs(seed) % list.length];
}

const LESSON_POOL = [
  'Before committing, list the opponent’s forcing moves.',
  'Coordinate pieces fully before chasing tactics.',
  'Activate the king immediately once queens leave the board.',
  'Improve the worst-placed piece before launching pawn storms.',
  'When a tactic appears, double-check what changed in the position.',
  'Convert advantages by tightening control, not by rushing pawn grabs.',
  'Develop, safeguard the king, then strike in the center.',
  'Ask what the opponent wants each move; prophylaxis prevents cheap tactics.',
];

function pickLessons(summary = {}, swing) {
  const seeds = [
    Math.round(summary?.whiteAcc ?? 50),
    Math.round(summary?.blackAcc ?? 50),
    Math.round(swing?.absDelta ?? 120),
  ];
  const chosen = new Set();
  for (let i = 0; i < LESSON_POOL.length && chosen.size < 3; i++) {
    const raw = seeds[i % seeds.length] + i * 17;
    const idx = Math.abs(raw) % LESSON_POOL.length;
    chosen.add(LESSON_POOL[idx]);
  }
  return Array.from(chosen);
}

function detectPhase(moment) {
  if (moment?.phase) return moment.phase;
  if (moment?.moveNo >= 30) return 'endgame';
  if (moment?.moveNo > 10) return 'middlegame';
  return 'opening';
}

function isBookOpening(moment) {
  const tag = String(moment?.tag || '').toLowerCase();
  const delta = Math.abs(Number(moment?.deltaCp || 0));
  return tag.includes('book') && moment?.moveNo <= 10 && delta < 30;
}

function classifyMoveIntent(moment) {
  const tag = String(moment?.tag || '').toLowerCase();
  const san = String(moment?.san || '');
  const delta = Math.abs(Number(moment?.deltaCp || 0));
  if (isBookOpening(moment)) return 'development';
  if (tag.includes('blunder')) return 'mistake';
  if (tag.includes('mistake')) return delta >= 120 ? 'tactic' : 'mistake';
  if (delta >= 220) return 'tactic';
  if (san.includes('+') || san.includes('x')) return 'attack';
  if (moment?.kingSafety && /uncastled|king/.test(moment.kingSafety)) return 'defense';
  if (moment?.structureTag) return 'consolidation';
  return 'development';
}

function sentenceCap(intent, moment) {
  const phase = detectPhase(moment);
  if (isBookOpening(moment)) return 2;
  if (phase === 'opening') return 2;
  if (phase === 'endgame') return 3;
  if (intent === 'tactic' || intent === 'mistake') return 5;
  return 4;
}

function normalizeSentence(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function enforceSentenceLimit(sentences, cap) {
  const out = [];
  for (const sentence of sentences) {
    if (!sentence) continue;
    out.push(normalizeSentence(sentence));
    if (out.length >= cap) break;
  }
  return out.join(' ').trim();
}

function formatBookOpeningNote(moment) {
  const key = String(moment?.san || '').toLowerCase();
  const template = BOOK_OPENING_TEMPLATES[key];
  const idea = template?.idea || 'Keeps theory and prepares smooth development.';
  const plan = template?.plan || 'Continue normal development and castle soon.';
  const text = [
    `${moment.san || '?'} — Book.`,
    `Idea: ${idea}`,
    `Plan: ${plan}`,
  ].join(' ');
  return { text, whyLine: null };
}

function normalizeIntent(intent) {
  return WHY_LINES[intent] ? intent : 'development';
}

function buildWhyLine(intent) {
  return WHY_LINES[normalizeIntent(intent)];
}

function primaryReason(intent) {
  return PRIMARY_REASON_TEXT[normalizeIntent(intent)] || 'keeps the plan on track';
}

function formatNormalSentences(moment, intent) {
  const side = moment?.side === 'B' || moment?.side === 'Black' ? 'Black' : 'White';
  const reason = primaryReason(intent);
  const sentences = [`${side} played ${moment?.san || '?'} to ${reason}.`];
  if (intent === 'attack' && moment?.tacticSummary) sentences.push(moment.tacticSummary);
  if (intent === 'defense' && moment?.kingSafety) sentences.push(moment.kingSafety);
  if (intent === 'consolidation' && moment?.structureTag) sentences.push(moment.structureTag);
  if (intent === 'development' && moment?.positionSummary) sentences.push(moment.positionSummary);
  if (!sentences[1] && moment?.centerSummary) sentences.push(moment.centerSummary);
  if (intent === 'tactic' && !moment?.tacticSummary && moment?.positionSummary) sentences.push(moment.positionSummary);
  const plan = PLAN_TEXT[intent];
  if (plan) sentences.push(plan);
  return sentences;
}

function formatHeuristicNote(moment) {
  if (isBookOpening(moment)) {
    const book = formatBookOpeningNote(moment);
    if (book) return book;
  }
  const intent = classifyMoveIntent(moment);
  const sentences = formatNormalSentences(moment, intent);
  const capped = enforceSentenceLimit(sentences, sentenceCap(intent, moment));
  return { text: capped, whyLine: buildWhyLine(intent) };
}

function buildLegacyMoveNotes(momentsInput) {
  const list = safeMoments(momentsInput);
  return list.map((m, idx) => {
    const moveIndex = Number.isInteger(m?.index) ? m.index : idx;
    const moveNo = Math.floor(moveIndex / 2) + 1;
    const side = m?.side === 'B' || m?.side === 'Black' ? 'B' : 'W';
    const before = Number.isFinite(m?.cpBefore) ? Number(m.cpBefore) : null;
    const after = Number.isFinite(m?.cpAfter) ? Number(m.cpAfter) : null;
    const delta = before != null && after != null ? after - before : null;
    const phase = m?.phase || 'middlegame';
    const formatted = formatHeuristicNote({
      ...m,
      moveNo,
      index: moveIndex,
      side,
      cpBefore: before,
      cpAfter: after,
      deltaCp: delta,
      phase,
    });
    return {
      moveIndex,
      moveNo,
      side,
      san: m?.san || '(?)',
      text: formatted.text.trim(),
      tag: m?.tag,
      deltaCp: delta,
      whyLine: formatted.whyLine || null,
    };
  });
}


const MOMENT_TAGS = new Set(['Best', 'Good', 'Inaccuracy', 'Mistake', 'Blunder', 'Book']);

function normalizeMomentLabel(tagRaw) {
  const tag = String(tagRaw || '').toLowerCase();
  if (tag.includes('blunder')) return 'Blunder';
  if (tag.includes('mistake')) return 'Mistake';
  if (tag.includes('inacc')) return 'Inaccuracy';
  if (tag.includes('book')) return 'Book';
  if (tag.includes('best') || tag.includes('genius')) return 'Best';
  return 'Good';
}

function describeEvalShift(moment) {
  const before = moment?.evalBeforeLabel || null;
  const after = moment?.evalAfterLabel || null;
  const tag = String(moment?.tag || '').toLowerCase();
  const quiet = (tag.includes('best') || tag.includes('good') || tag.includes('book')) && Math.abs(Number(moment?.deltaCp || 0)) < 80;
  if (quiet) return '';
  if (!before && !after) return '';
  if ((before || '') === (after || '')) return `Evaluation stayed ${before || after}.`;
  if (before && after) return `This shifts the game from ${before} to ${after}.`;
  if (!before && after) return `This leaves the position ${after}.`;
  return `This keeps the game ${before}.`;
}

function selectKeyMoments(momentsInput = []) {
  const list = safeMoments(momentsInput).map((m, idx) => ({ ...m, index: Number.isFinite(m?.index) ? m.index : idx }));
  const picked = new Map();
  const add = (moment) => {
    if (!moment) return;
    const idx = Number(moment.index);
    if (!Number.isFinite(idx)) return;
    picked.set(idx, moment);
  };

  const severity = list
    .filter((m) => ['blunder', 'mistake', 'inacc'].some((needle) => String(m?.tag || '').toLowerCase().includes(needle)))
    .sort((a, b) => (Math.abs(Number(b?.deltaCp || 0)) - Math.abs(Number(a?.deltaCp || 0))) || (a.index - b.index));
  severity.slice(0, 8).forEach(add);

  const addTopSwingForSide = (side) => {
    const swings = list
      .filter((m) => (side === 'W' ? (m?.side === 'W' || m?.side === 'White') : (m?.side === 'B' || m?.side === 'Black')))
      .sort((a, b) => (Math.abs(Number(b?.deltaCp || 0)) - Math.abs(Number(a?.deltaCp || 0))) || (a.index - b.index));
    swings.slice(0, 2).forEach(add);
  };
  addTopSwingForSide('W');
  addTopSwingForSide('B');

  const turningPoint = list
    .filter((m) => Number.isFinite(m?.deltaCp))
    .sort((a, b) => (Math.abs(Number(b?.deltaCp || 0)) - Math.abs(Number(a?.deltaCp || 0))));
  turningPoint.slice(0, 2).forEach(add);

  const ordered = Array.from(picked.values()).sort((a, b) => a.index - b.index);
  return ordered.slice(0, Math.min(MAX_COACH_NOTES, ordered.length));
}

function buildMomentPromptBlock(moment) {
  const base = {
    moveIndex: moment.index,
    moveNo: moment.moveNo,
    side: moment.side === 'B' || moment.side === 'Black' ? 'Black' : 'White',
    san: moment.san,
    tagHint: normalizeMomentLabel(moment.tag),
    evalBeforeLabel: moment.evalBeforeLabel || '',
    evalAfterLabel: moment.evalAfterLabel || '',
    deltaCp: Number.isFinite(moment.deltaCp) ? Number(moment.deltaCp) : null,
    phase: moment.phase || 'middlegame',
    tacticSummary: moment.tacticSummary || '',
    positionSummary: moment.positionSummary || '',
    kingSafety: moment.kingSafety || '',
    centerSummary: moment.centerSummary || '',
    structureTag: moment.structureTag || '',
    motifs: Array.isArray(moment.motifs) ? moment.motifs : [],
    bestSan: moment.best || moment.bestSan || '',
    fenBefore: moment.fenBefore || '',
    fenAfter: moment.fenAfter || '',
  };
  return JSON.stringify(base, null, 2);
}

const MOMENT_NOTE_SYSTEM_PROMPT = [
  'You are a titled chess coach producing concise explanations for key moves.',
  'Respond ONLY with JSON.',
  'Use labels: Best (creates a threat or maintains initiative), Good (solid play), Inaccuracy (soft move), Mistake (serious error), Blunder (decisive error), Book (theory).',
  'Explain why using concrete positional facts (king safety, center tension, open files, hanging pieces, tactics).',
  'Mention evaluation labels provided (equal, slight edge, clear edge, winning, decisive) rather than numeric scores.',
  'When data is missing (e.g., no engine line), say "engine line unavailable" instead of inventing specifics.',
  'The "principle" field must be a short habit (≤12 words).',
].join('\n');

function buildMomentNotesPrompt(targets) {
  const lines = targets.map((moment, idx) => `Moment ${idx + 1}:\n${buildMomentPromptBlock(moment)}`);
  return [
    'For each moment below, produce an object with keys:',
    '{ "moveIndex","moveNo","side","san","label","why","opponentIdea","refutation","betterPlan","principle","pv" }',
    '- "why": 2–4 sentences describing the intention, what changed, and consequences.',
    '- "opponentIdea": describe how the opponent can punish or respond (if known).',
    '- "refutation": reference the best line or say "engine line unavailable".',
    '- "betterPlan": suggest one plan-level alternative.',
    '- "principle": short habit reminder (≤12 words).',
    '- "pv": short SAN line if provided, else empty string.',
    'Return ONLY a JSON array of these objects.',
    '',
    lines.join('\n\n'),
  ].join('\n');
}

function clampField(value, max = 240) {
  if (!value) return '';
  const trimmed = String(value).trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trim()}…`;
}

function normalizeMomentNote(raw, moment) {
  if (!raw || typeof raw !== 'object') return null;
  const moveIndex = Number.isFinite(raw.moveIndex) ? Number(raw.moveIndex) : moment?.index;
  if (!Number.isFinite(moveIndex)) return null;
  const label = normalizeMomentLabel(raw.label || moment?.tag);
  if (!MOMENT_TAGS.has(label)) return null;
  const why = clampField(raw.why || '', 600);
  if (!why) return null;
  const opponentIdea = clampField(raw.opponentIdea || '', 240) || undefined;
  const refutation = clampField(raw.refutation || '', 240) || undefined;
  const betterPlan = clampField(raw.betterPlan || '', 240) || undefined;
  const principle = clampField(raw.principle || '', 80) || undefined;
  const pv = clampField(raw.pv || '', 200) || undefined;
  return {
    moveIndex,
    moveNo: Number.isFinite(raw.moveNo) ? Number(raw.moveNo) : moment?.moveNo ?? Math.floor(moveIndex / 2) + 1,
    side: (raw.side === 'Black' || moment?.side === 'B' || moment?.side === 'Black') ? 'B' : 'W',
    san: String(raw.san || moment?.san || '(?)'),
    label,
    why,
    opponentIdea,
    refutation,
    betterPlan,
    principle: quietLabel(label) ? undefined : principle,
    pv,
    evalBeforeLabel: moment?.evalBeforeLabel || null,
    evalAfterLabel: moment?.evalAfterLabel || null,
  };
}

function quietLabel(label) {
  return label === 'Best' || label === 'Good' || label === 'Book';
}

async function generateMomentNotes(inputs, model) {
  const targets = selectKeyMoments(inputs?.moments);
  if (!targets.length) return [];
  try {
    const prompt = buildMomentNotesPrompt(targets);
    const raw = await callModelJson({
      model,
      systemPrompt: MOMENT_NOTE_SYSTEM_PROMPT,
      prompt,
      numPredict: 900,
    });
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.momentNotes) ? raw.momentNotes : [];
    const notes = [];
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        const normalized = normalizeMomentNote(list[i], targets[i] || targets[0]);
        if (normalized) notes.push(normalized);
      }
    }
    return notes.length ? notes : targets.map((moment) => {
      const label = normalizeMomentLabel(moment.tag);
      return {
        moveIndex: moment.index,
        moveNo: moment.moveNo,
        side: moment.side === 'B' || moment.side === 'Black' ? 'B' : 'W',
        san: moment.san || '(?)',
        label,
        why: describeEvalShift(moment) || 'Coach note unavailable.',
        opponentIdea: moment.tacticSummary || undefined,
        refutation: 'engine line unavailable',
        betterPlan: moment.best ? `Consider ${moment.best} instead.` : undefined,
        principle: quietLabel(label) ? undefined : 'Stay alert for forcing moves',
        pv: '',
        evalBeforeLabel: moment.evalBeforeLabel || null,
        evalAfterLabel: moment.evalAfterLabel || null,
      };
    });
  } catch (err) {
    console.error('[coach] moment note gen failed', err);
    return [];
  }
}

function fallbackMomentNotes(moments) {
  return selectKeyMoments(moments).map((moment) => ({
    moveIndex: moment.index,
    moveNo: moment.moveNo,
    side: moment.side === 'B' || moment.side === 'Black' ? 'B' : 'W',
    san: moment.san || '(?)',
    label: normalizeMomentLabel(moment.tag),
    why: describeEvalShift(moment) || 'Coach offline.',
    opponentIdea: moment.tacticSummary || undefined,
    refutation: 'engine line unavailable',
    betterPlan: moment.best ? `Consider ${moment.best}.` : undefined,
    principle: quietLabel(normalizeMomentLabel(moment.tag)) ? undefined : 'Stay alert for forcing moves',
    pv: '',
    evalBeforeLabel: moment.evalBeforeLabel || null,
    evalAfterLabel: moment.evalAfterLabel || null,
  }));
}

function normalizeSections(sections, inputs) {
  const validation = validateSectionsPayload(sections, inputs);
  if (validation.ok) {
    return { sections: validation.sections, fallback: false };
  }
  if (validation.reason) {
    console.warn('[coach] section validation failed:', validation.reason);
  }
  return { sections: buildFallbackSections(inputs), fallback: true };
}

function buildSectionsPrompt(inputs = {}) {
  const summary = inputs?.summary || {};
  const openingName = summary?.opening || 'Unknown opening';
  const accLine = `Accuracy W ${fmtPercent(summary?.whiteAcc)} / B ${fmtPercent(summary?.blackAcc)} (avg CPL W ${fmt(summary?.avgCplW)} / B ${fmt(summary?.avgCplB)})`;
  const turningPointLines = buildTurningPointHints(inputs?.moments).join('\n') || 'No big swings detected.';
  const patternLines = buildPatternHintStrings(inputs?.moments).join('\n') || 'No recurring patterns detected.';
  const evalSummary = Array.isArray(inputs?.evalSummary) && inputs.evalSummary.length
    ? inputs.evalSummary.join('\n')
    : 'Eval data unavailable.';
  return [
    `Game info: opening ${openingName}, result ${summary?.result || '*'}. ${accLine}`,
    `Top turning points:\n${turningPointLines}`,
    `Pattern summary:\n${patternLines}`,
    `Eval notes:\n${evalSummary}`,
  ].join('\n\n');
}

function buildTurningPointHints(moments) {
  const picks = selectKeyMoments(moments).slice(0, 3);
  return picks.map((moment) => {
    const mover = moment.side === 'W' ? 'White' : 'Black';
    const label = normalizeMomentLabel(moment.tag);
    const reason = summarizeMoment(moment, mover);
    return `Move ${moment.moveNo} (${mover} ${moment.san}, ${label}) — ${reason}`;
  });
}

function summarizeMoment(moment, moverLabel) {
  if (moment?.tacticSummary) return moment.tacticSummary;
  if (moment?.positionSummary) return moment.positionSummary;
  if (moment?.centerSummary) return moment.centerSummary;
  return describeTagReason(moment?.tag, moment?.deltaCp, moment?.phase, moverLabel);
}

function buildPatternHintStrings(moments) {
  return derivePatternInsights(moments).map((entry) => `Pattern: ${entry.pattern} → Fix: ${entry.fix}`);
}

function derivePatternInsights(moments) {
  const list = safeMoments(moments);
  const castleMove = { W: null, B: null };
  const kingsidePushes = { W: 0, B: 0 };
  const mistakes = { W: 0, B: 0 };
  const tacticMotifs = { W: 0, B: 0 };
  for (const moment of list) {
    if (!moment) continue;
    const side = moment.side === 'B' ? 'B' : 'W';
    const san = String(moment.san || '');
    if ((san === 'O-O' || san === 'O-O-O') && castleMove[side] == null) {
      castleMove[side] = moment.moveNo;
    }
    if (!castleMove[side] && isKingWingPawnPush(san, side)) {
      kingsidePushes[side]++;
    }
    const tag = String(moment.tag || '').toLowerCase();
    if (tag.includes('blunder') || tag.includes('mistake')) mistakes[side] = (mistakes[side] || 0) + 1;
    if (Array.isArray(moment.motifs) && moment.motifs.some((motif) => /capture|check|tactic/i.test(motif))) {
      tacticMotifs[side] = (tacticMotifs[side] || 0) + 1;
    }
  }
  const patterns = [];
  if (!castleMove.W || castleMove.W > 12) {
    patterns.push({
      pattern: `White castled on move ${castleMove.W || 'never'}`,
      fix: 'castle before the center explodes.',
    });
  }
  if (!castleMove.B || castleMove.B > 12) {
    patterns.push({
      pattern: `Black castled on move ${castleMove.B || 'never'}`,
      fix: 'finish king safety earlier.',
    });
  }
  if (kingsidePushes.W >= 2) {
    patterns.push({
      pattern: `White pushed ${kingsidePushes.W} pawn(s) in front of the king before castling`,
      fix: 'delay pawn storms until the king is tucked away.',
    });
  }
  if (kingsidePushes.B >= 2) {
    patterns.push({
      pattern: `Black advanced ${kingsidePushes.B} king-side pawn(s) before castling`,
      fix: 'keep the monarch sheltered before launching pawns.',
    });
  }
  if (mistakes.W >= 2) {
    patterns.push({
      pattern: `White left ${mistakes.W} tactics on the board`,
      fix: 'slow down and check forcing moves.',
    });
  }
  if (mistakes.B >= 2) {
    patterns.push({
      pattern: `Black missed ${mistakes.B} tactics`,
      fix: 'count captures before pushing pawns.',
    });
  }
  if (!patterns.length) {
    patterns.push({
      pattern: 'Both players stayed solid',
      fix: 'keep building on these fundamentals.',
    });
  }
  return patterns.slice(0, 6);
}

function isKingWingPawnPush(san, side) {
  const files = side === 'W' ? ['f', 'g', 'h'] : ['f', 'g', 'h'];
  const match = san.match(/^([a-h])(x?[a-h][1-8]|[1-8])/i);
  if (!match) return false;
  const file = match[1].toLowerCase();
  return files.includes(file);
}

function sentenceArray(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function clampSentences(text, max = 2) {
  const sentences = sentenceArray(text);
  return sentences.slice(0, max).join(' ').trim();
}

function countSentences(text) {
  return sentenceArray(text).length;
}

function textHasReference(text, openingName) {
  if (!text) return false;
  if (/move\s+\d+/i.test(text)) return true;
  if (openingName) {
    const token = openingName.split(/\s+/)[0];
    if (token && text.toLowerCase().includes(token.toLowerCase())) return true;
  }
  return false;
}

function validateSectionsPayload(payload, inputs) {
  const summary = inputs?.summary || {};
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'sections-not-object' };
  const result = {
    executive: { text: '' },
    opening: { text: '' },
    middlegame: { text: '' },
    endgame: { text: '' },
    keyMoments: { bullets: [] },
    lessons: { bullets: [] },
  };
  const textFields = [
    ['executive', payload?.executive?.text],
    ['opening', payload?.opening?.text],
    ['middlegame', payload?.middlegame?.text],
    ['endgame', payload?.endgame?.text],
  ];
  for (const [key, raw] of textFields) {
    const clamped = clampSentences(String(raw || ''), 2);
    if (!clamped) return { ok: false, reason: `missing-${key}` };
    if (countSentences(clamped) > 2) return { ok: false, reason: `${key}-sentence-limit` };
    if (!textHasReference(clamped, summary?.opening)) return { ok: false, reason: `${key}-no-reference` };
    result[key] = { text: clamped };
  }
  const keyBullets = Array.isArray(payload?.keyMoments?.bullets) ? payload.keyMoments.bullets.filter((b) => typeof b === 'string' && b.trim()) : [];
  if (keyBullets.length !== 3) return { ok: false, reason: 'keymoments-length' };
  if (keyBullets.some((b) => !/^Move\s+\d+/i.test(b) || !/Habit:/i.test(b))) {
    return { ok: false, reason: 'keymoments-format' };
  }
  result.keyMoments = { bullets: keyBullets.map((b) => clampSentences(b, 2)) };
  const lessonBullets = Array.isArray(payload?.lessons?.bullets) ? payload.lessons.bullets.filter((b) => typeof b === 'string' && b.trim()) : [];
  if (lessonBullets.length !== 3) return { ok: false, reason: 'lessons-length' };
  if (lessonBullets.some((b) => !/Pattern:/i.test(b) || !/Fix:/i.test(b))) {
    return { ok: false, reason: 'lessons-format' };
  }
  result.lessons = { bullets: lessonBullets.map((b) => clampSentences(b, 2)) };
  return { ok: true, sections: result };
}

function buildFallbackSections(inputs) {
  const summary = inputs?.summary || {};
  const openingName = summary?.opening || 'the opening phase';
  const moments = safeMoments(inputs?.moments);
  const turning = selectKeyMoments(moments).slice(0, 3);
  const heuristic = heuristicSections(inputs);
  const patterns = derivePatternInsights(moments);
  const totalMoves = Math.max(1, Math.round((inputs?.totalPlies || moments.length) / 2));
  return {
    executive: { text: fallbackExecutiveText(turning[0], openingName) },
    opening: { text: fallbackOpeningText(openingName, turning[0], heuristic.openingReview) },
    middlegame: { text: fallbackPhaseText(turning[1] || turning[0], heuristic.middlegameReview, 'middlegame') },
    endgame: { text: fallbackEndgameText(turning[2], heuristic.endgameReview, totalMoves) },
    keyMoments: { bullets: buildFallbackKeyBullets(turning, heuristic.keyMoments) },
    lessons: { bullets: buildFallbackLessons(patterns, heuristic.lessons) },
  };
}

function fallbackExecutiveText(turn, openingName) {
  if (turn) {
    const mover = turn.side === 'W' ? 'White' : 'Black';
    const desc = sanitizeDescription(summarizeMoment(turn, mover));
    const habit = habitForTag(turn.tag);
    return clampSentences(`Move ${turn.moveNo} (${mover} ${turn.san}) shaped the result by ${desc}. Next time, ${habit}`, 2);
  }
  return clampSentences(`Opening ${openingName} stayed balanced through move 10. Next time, focus on controlling the center and castling on time.`, 2);
}

function fallbackOpeningText(openingName, turn, fallbackLine) {
  if (turn && turn.moveNo <= 12) {
    const mover = turn.side === 'W' ? 'White' : 'Black';
    const desc = sanitizeDescription(summarizeMoment(turn, mover));
    return clampSentences(`Opening ${openingName} flipped at move ${turn.moveNo} when ${mover} played ${turn.san} and ${desc}. Review that idea for next time.`, 2);
  }
  return clampSentences(`${openingName} followed classical development. Next time, ${fallbackLine || 'aim for quick king safety and central control.'}`, 2);
}

function fallbackPhaseText(turn, fallbackLine, phaseLabel) {
  if (turn) {
    const mover = turn.side === 'W' ? 'White' : 'Black';
    const desc = sanitizeDescription(summarizeMoment(turn, mover));
    const habit = habitForTag(turn.tag);
    return clampSentences(`Move ${turn.moveNo} in the ${phaseLabel} let ${mover.toLowerCase()} ${desc}. Next time, ${habit}`, 2);
  }
  return clampSentences(`${fallbackLine || `No decisive ${phaseLabel} battle appeared.`} Next time, keep pressure on the critical squares.`, 2);
}

function fallbackEndgameText(turn, fallbackLine, totalMoves) {
  if (turn && turn.moveNo > Math.max(20, Math.round(totalMoves * 0.6))) {
    const mover = turn.side === 'W' ? 'White' : 'Black';
    const desc = sanitizeDescription(summarizeMoment(turn, mover));
    const habit = habitForTag(turn.tag);
    return clampSentences(`Move ${turn.moveNo} decided the late phase as ${mover.toLowerCase()} ${desc}. Finish development earlier so the endgame is smoother.`, 2);
  }
  return clampSentences(`No real endgame emerged before move ${totalMoves}. Next time, aim to simplify only after improving king activity.`, 2);
}

function buildFallbackKeyBullets(turning, heuristicList = []) {
  const bullets = [];
  for (const moment of turning) {
    bullets.push(formatKeyMomentBullet(moment));
    if (bullets.length >= 3) break;
  }
  if (bullets.length < 3) {
    for (const line of heuristicList) {
      if (!line) continue;
      const match = line.match(/move\s+(\d+)/i);
      const moveNo = match ? match[1] : String(10 + bullets.length);
      bullets.push(`Move ${moveNo}: ${sanitizeDescription(line)} → Habit: stay alert for forcing replies.`);
      if (bullets.length >= 3) break;
    }
  }
  while (bullets.length < 3) {
    const moveNo = 12 + bullets.length * 2;
    bullets.push(`Move ${moveNo}: keep pieces coordinated → Habit: double-check tactics before pushing pawns.`);
  }
  return bullets.slice(0, 3).map((line) => clampSentences(line, 2));
}

function formatKeyMomentBullet(moment) {
  const mover = moment.side === 'W' ? 'White' : 'Black';
  const desc = sanitizeDescription(summarizeMoment(moment, mover));
  const habit = habitForTag(moment.tag);
  return `Move ${moment.moveNo}: ${desc} → Habit: ${habit}`;
}

function buildFallbackLessons(patterns, heuristicLessons = []) {
  const bullets = patterns.slice(0, 3).map((p) => `Pattern: ${p.pattern} → Fix: ${p.fix}`);
  if (bullets.length < 3 && Array.isArray(heuristicLessons)) {
    for (const lesson of heuristicLessons) {
      if (!lesson) continue;
      bullets.push(`Pattern: ${lesson} → Fix: apply that plan earlier.`);
      if (bullets.length >= 3) break;
    }
  }
  while (bullets.length < 3) {
    bullets.push('Pattern: Missed chances in quiet positions → Fix: improve piece coordination before pawn storms.');
  }
  return bullets.slice(0, 3).map((line) => clampSentences(line, 2));
}

function sanitizeDescription(text) {
  return String(text || '').replace(/\d+\s*cp/gi, 'the balance').replace(/\s+/g, ' ').trim();
}

function habitForTag(tag) {
  const low = String(tag || '').toLowerCase();
  if (low.includes('blunder')) return 'double-check hanging pieces before committing.';
  if (low.includes('mistake')) return 'slow down and count forcing moves.';
  if (low.includes('inacc')) return 'improve the worst piece before pawn pushes.';
  if (low.includes('book')) return 'follow the plan and be ready for pawn breaks.';
  if (low.includes('best') || low.includes('excellent')) return 'keep trusting the plan when the pieces coordinate.';
  return 'stay mindful of both threats and your own plans.';
}

function buildMomentHints(moments) {
  const lines = safeMoments(moments)
    .filter(Boolean)
    .slice(0, 12)
    .map((m) => {
      const mover = m.side === 'W' ? 'White' : 'Black';
      const tag = m.tag ? `[${m.tag}]` : '';
      const phase = m.phase ? `(${m.phase})` : '';
      const ideaParts = [];
      if (m.tacticSummary) ideaParts.push(m.tacticSummary);
      else if (m.positionSummary) ideaParts.push(m.positionSummary);
      else if (m.centerSummary) ideaParts.push(m.centerSummary);
      if (m.motifs?.length) ideaParts.push(`Motifs: ${m.motifs.join(', ')}`);
      const idea = ideaParts.join(' ');
      return `Move ${m.moveNo}: ${mover} ${m.san || '?'} ${tag} ${phase} — ${idea}`.trim();
    });
  return lines.length ? lines.join('\n') : 'No moment hints available.';
}

async function fetchText(body) {
  // Prefer fetch if available; otherwise fall back to our httpRequest helper.
  if (_fetch) {
    const res = await _fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error(`ollama status ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }
  // Fallback: non-streaming HTTP helper
  const res = await httpRequest(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  return res.text || '';
}

function parseJsonResponse(raw) {
  const sanitize = (input) => (input == null ? '' : String(input).trim());
  const tryParse = (input) => {
    const text = sanitize(input);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const text = sanitize(raw);
  if (!text) return null;
  let parsed = tryParse(text);
  if (!parsed && text.includes('\n')) {
    const lines = text.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && !parsed; i--) {
      parsed = tryParse(lines[i]);
    }
  }
  if (parsed && typeof parsed === 'object' && typeof parsed.response === 'string') {
    const inner = tryParse(parsed.response);
    if (inner) return inner;
  }
  return parsed;
}

async function callModelJson({ model, systemPrompt, prompt, numPredict = 512 }) {
  const body = {
    model,
    stream: false,
    system: systemPrompt,
    prompt,
    format: 'json',
    options: {
      temperature: 0.2,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.05,
      num_ctx: NUM_CTX,
      num_predict: numPredict,
      keep_alive: COACH_KEEP_ALIVE,
    },
  };
  const raw = await fetchText(body);
  const parsed = parseJsonResponse(raw);
  if (!parsed) throw new Error('empty-json');
  return parsed;
}

async function callModelSections({ model, prompt }) {
  try {
    return await callModelJson({
      model,
      prompt,
      systemPrompt: SECTION_SYSTEM_PROMPT,
      numPredict: Math.max(800, TOKENS_PER_ITEM * 4),
    });
  } catch (err) {
    console.error('[coach] failed to parse sections JSON', err);
    return null;
  }
}

// NDJSON streaming helper to avoid buffering large responses.
async function fetchNdjsonLines(body, expected) {
  if (!_fetch) return null;
  const res = await _fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`ollama status ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const txt = await res.text();
    const lines = (txt || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const parsed = lines.map((ln) => { try { return JSON.parse(ln); } catch { return null; } }).filter(Boolean);
    return parsed.length ? parsed.slice(0, expected || parsed.length) : null;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const out = [];
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch {}
      if (expected && out.length >= expected) {
        try { reader.cancel(); } catch {}
        return out;
      }
    }
  }
  const tail = buffer.trim();
  if (tail) { try { out.push(JSON.parse(tail)); } catch {} }
  return out.length ? out : null;
}

/* ------------------------------ HTTP helper ------------------------------- */

function httpRequest(url, { method = 'POST', headers = {}, body = null, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      { protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.pathname + (u.search || ''), method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

async function listModels() {
  try {
    const res = await httpRequest(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    if (!res.ok) return null;
    const data = JSON.parse(res.text || '{}');
    return Array.isArray(data?.models) ? data.models : [];
  } catch { return null; }
}

async function ensureModelAvailable(model) {
  const models = await listModels();
  const found = !!models?.some((m) => m?.name === model);
  if (found) return true;
  if (!AUTO_PULL) return false;
  try {
    const res = await httpRequest(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      timeout: Math.max(TIMEOUT_MS, 10 * 60 * 1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* -------------------------------- Prompt ---------------------------------- */


function normalizeItems(items, batch) {
  const byOrderIdx = batch.map((m) => (Number.isFinite(m.idx) ? m.idx : m.ply));
  return items
    .filter((it) => it && typeof it === 'object')
    .map((raw, i) => {
      const moveIndex = Number.isFinite(Number(raw.moveIndex))
        ? Number(raw.moveIndex)
        : Number.isFinite(Number(raw.idx))
        ? Number(raw.idx)
        : byOrderIdx[i];
      const title = String(raw.title || '').trim();
      const text = String(raw.text || '').trim();
      if (!Number.isFinite(moveIndex)) return null;
      if (!text) return null;
      return {
        moveIndex,
        title: title ? title.slice(0, 60) : undefined,
        text: text.slice(0, 280),
        type: 'move',
      };
    })
    .filter(Boolean);
}

function keySwingMoment(moments) {
  const list = safeMoments(moments);
  let best = null;
  for (const m of list) {
    const before = Number(m?.cpBefore);
    const after = Number(m?.cpAfter);
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    const delta = after - before;
    const absDelta = Math.abs(delta);
    if (!best || absDelta > best.absDelta) {
      best = {
        ...m,
        delta,
        absDelta,
      };
    }
  }
  return best;
}

function describeTagReason(tagRaw, delta, phase, moverLabel) {
  const tag = String(tagRaw || '').toLowerCase();
  const absDelta = Math.abs(Math.round(delta || 0));
  const swingTxt = absDelta ? `${absDelta} cp swing` : 'momentum shift';
  const opponent = moverLabel === 'White' ? 'Black' : 'White';
  const phaseWord = phase || 'middlegame';
  if (tag.includes('blunder')) {
    return `overlooked a tactic, exposing king safety and handing ${opponent} a ${swingTxt} in the ${phaseWord}`;
  }
  if (tag.includes('mistake')) {
    return `lost central control so ${opponent} seized the initiative (${swingTxt})`;
  }
  if (tag.includes('inacc')) {
    return `played slowly, letting ${opponent} improve pawn structure (${swingTxt})`;
  }
  if (tag.includes('best')) {
    return `kept the initiative and coordination (${swingTxt})`;
  }
  if (tag.includes('book')) {
    return 'stayed in theory and kept development smooth';
  }
  return `shifted the evaluation (${swingTxt}) during the ${phaseWord}`;
}

function inferResult(summary, moments) {
  if (summary?.result && summary.result !== '*') return summary.result;
  const list = safeMoments(moments);
  const last = list[list.length - 1];
  const evalAfter = Number.isFinite(last?.cpAfter) ? Number(last.cpAfter) : Number.isFinite(last?.cpBefore) ? Number(last.cpBefore) : null;
  if (!Number.isFinite(evalAfter)) return null;
  if (evalAfter > 120) return '1-0 (White pressing)';
  if (evalAfter < -120) return '0-1 (Black pressing)';
  return '½-½ (balanced)';
}

function buildIntroNote(summary = {}, moments) {
  const opening = summary?.opening || 'an unknown opening';
  const total = safeMoments(moments).length;
  const lines = [
    `This game began as ${opening}.`,
    `Accuracy: White ${fmtPercent(summary?.whiteAcc)} vs Black ${fmtPercent(summary?.blackAcc)}.`,
    `Expect a ${describePhaseFocus(total)} emphasising king safety, center control, and initiative.`,
  ];
  return { type: 'intro', text: lines.join(' ') };
}

function buildSummaryNote(summary = {}, moments) {
  const list = safeMoments(moments);
  const swing = keySwingMoment(list);
  const parts = [];
  if (swing && swing.absDelta >= 60) {
    const mover = swing.side === 'W' ? 'White' : 'Black';
    const phase = swing.phase || phaseForPly(swing.index, list.length);
    const reason = describeTagReason(swing.tag, swing.delta, phase, mover);
    parts.push(`Turning point: move ${swing.moveNo} (${mover} ${swing.san}) ${reason}.`);
  } else {
    parts.push('No single move decided things; the evaluation ebbed back and forth.');
  }
  const res = inferResult(summary, list);
  if (res) parts.push(`Result: ${res}.`);
  parts.push(`Avg CPL W ${fmt(summary?.avgCplW)} / B ${fmt(summary?.avgCplB)}.`);
  return { type: 'summary', text: parts.join(' ') };
}

function attachStoryNotes(moveNotes, summary, moments) {
  const base = Array.isArray(moveNotes) ? moveNotes : [];
  const intro = buildIntroNote(summary, moments);
  const outro = buildSummaryNote(summary, moments);
  return [intro, ...base, outro].filter(Boolean);
}


/* --------------------------------- Coach ---------------------------------- */

async function generateNotes(inputs) {
  const model = inputs?.model || DEFAULT_MODEL;
  const prompt = buildSectionsPrompt(inputs);
  if (COACH_DEBUG) {
    console.log('[coach] generating coach sections with model', model);
  }
  const rawSections = prompt ? await callModelSections({ model, prompt }) : null;
  const normalized = normalizeSections(rawSections, inputs);
  const moves = buildLegacyMoveNotes(inputs?.moments);
  const generatedMomentNotes = await generateMomentNotes(inputs, model);
  const momentNotes = generatedMomentNotes.length ? generatedMomentNotes : fallbackMomentNotes(inputs?.moments);
  return {
    sections: normalized.sections,
    moves,
    momentNotes,
    offline: false,
    fallback: normalized.fallback,
  };
}

/* ---------------------------------- IPC ----------------------------------- */

let __coachIpcReady = false;
function registerCoachIpc() {
  // Dev/HMR safe: clear any existing handlers first
  try { ipcMain.removeHandler('coach:generate'); } catch {}
  try { ipcMain.removeHandler('coach:ping'); } catch {}
  ipcMain.handle('coach:generate', async (_e, payload) => {
    try {
      const inputs = payload?.inputs || {};
      let model = String(inputs?.model || DEFAULT_MODEL);
      let available = await ensureModelAvailable(model);
      if (!available && FALLBACK_MODEL) {
        log(`model ${model} missing; trying fallback ${FALLBACK_MODEL}`);
        const ok = await ensureModelAvailable(FALLBACK_MODEL);
        if (ok) { model = FALLBACK_MODEL; available = true; }
      }
      if (!available) {
        console.error(`[coach] model not available: ${model}. Install with: ollama pull ${model}`);
        return {
          sections: buildFallbackSections(inputs),
          moves: buildLegacyMoveNotes(inputs?.moments),
          momentNotes: fallbackMomentNotes(inputs?.moments),
          offline: false,
          reason: 'model-missing',
          model,
          fallback: true,
        };
      }
      const res = await generateNotes({ ...inputs, model });
      if (res?.sections) return res;
      return {
        sections: buildFallbackSections(inputs),
        moves: buildLegacyMoveNotes(inputs?.moments),
        momentNotes: fallbackMomentNotes(inputs?.moments),
        offline: false,
        reason: 'empty-response',
        model,
        fallback: true,
      };
    } catch (e) {
      console.error('[coach] error:', e && (e.stack || e.message || e));
      return {
        sections: buildFallbackSections(payload?.inputs),
        moves: buildLegacyMoveNotes(payload?.inputs?.moments),
        momentNotes: fallbackMomentNotes(payload?.inputs?.moments),
        offline: false,
        reason: 'exception',
        fallback: true,
      };
    }
  });
  ipcMain.handle('coach:ping', async () => ({ ok: true, ping: 'coach' }));
  __coachIpcReady = true;
}

module.exports = {
  registerCoachIpc,
  generateNotes,
};
