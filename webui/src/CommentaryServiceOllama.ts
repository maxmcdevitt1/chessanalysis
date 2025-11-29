// webui/src/CommentaryServiceOllama.ts
import type { CommentaryService, CommentaryBlock, Moment, GameSummary } from './CommentaryService';

const MODEL = (import.meta as any).env?.VITE_OLLAMA_MODEL || 'llama3:8b-instruct';
const BASE  = (import.meta as any).env?.VITE_OLLAMA_URL   || 'http://localhost:11434';

function systemPrompt() {
  return `You are a chess coach.
- Use ONLY the engine facts provided (tags, CPL/ΔWin%, best move, PV, opening).
- Do not invent engine evaluations or moves.
- Tone: concise, actionable, matter-of-fact.
- Output exactly one sentence per move in \"perMove\".`;
}

function userPrompt(summary: GameSummary, moments: Moment[], pgn?: string) {
  const header = [
    summary.opening ? `Opening: ${summary.opening}` : null,
    (summary.whiteAcc!=null && summary.blackAcc!=null) ? `Accuracy W/B: ${summary.whiteAcc}% / ${summary.blackAcc}%` : null,
    (summary.avgCplW!=null && summary.avgCplB!=null) ? `Avg CPL W/B: ${summary.avgCplW?.toFixed(1)} / ${summary.avgCplB?.toFixed(1)}` : null
  ].filter(Boolean).join('\n');

  const key = moments.map(m => {
    const dw = m.dWin != null ? ` ΔWin=${m.dWin.toFixed(1)}%` : '';
    const cp = (m.cpAfter != null) ? ` eval=${(m.cpAfter/100).toFixed(1)}` : '';
    const best = m.best ? ` best=${m.best}` : '';
    const pv = m.pv ? ` pv=${m.pv}` : '';
    return `- ply=${m.index} #${m.moveNo} ${m.side} ${m.san} [${m.tag}]${dw}${cp}${best}${pv}`;
  }).join('\n');

  return `Facts:
${header}

Moves to comment (each line is one move with tags/metrics):
${key}

Instructions:
- Write "intro" with 2–4 sentences summarizing the game (opening ideas, typical plans, who got the edge and why).
- In "perMove", produce EXACTLY ONE sentence per move above.
- In "closing", write 1–2 sentences about what decided the result and practical lessons.

Return JSON:
{
 "intro": "...",
 "perMove": [{"ply": <number>, "text": "Exactly one sentence."}],
 "closing": "..."
}

PGN (context only; do not analyze beyond facts): ${pgn ?? ''}`;
}

export class CommentaryServiceOllama implements CommentaryService {
  constructor(private baseUrl = BASE, private model = MODEL) {}
  async commentGame(input: { pgn?: string; summary: GameSummary; moments: Moment[] }): Promise<CommentaryBlock> {
    const body = {
      model: this.model,
      options: { temperature: 0.5, top_p: 0.9 },
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: userPrompt(input.summary, input.moments, input.pgn) },
      ],
      format: 'json',
      stream: false
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Ollama error ${res.status}`);
    const data = await res.json();
    const content = data?.message?.content || '{}';
    try {
      const parsed = JSON.parse(content);
      const perMove = Array.isArray(parsed.perMove) ? parsed.perMove : [];
      return {
        intro: parsed.intro ?? '',
        perMove: perMove.map((x: any) => ({ ply: Number(x.ply), text: String(x.text || '') })),
        closing: parsed.closing ?? ''
      };
    } catch {
      return { intro: content, perMove: [], closing: '' };
    }
  }
}
