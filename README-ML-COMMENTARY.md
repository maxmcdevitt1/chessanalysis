# Local ML Commentary (Ollama) – Drop-in

This adds a **local-only** commentary module powered by **Ollama**. It generates:
- one concise sentence per move (you choose which moves), and
- a short intro/closing summarizing the game.

## Files
- `webui/src/CommentaryService.ts` – provider interface & types
- `webui/src/CommentaryServiceOllama.ts` – local implementation for Ollama
- `webui/src/useCoach.ts` – hook to trigger/run commentary
- `webui/src/CoachPanel.tsx` – small panel to render notes

## Install Ollama
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3:8b-instruct
# Optional (env for Vite):
# export VITE_OLLAMA_URL=http://localhost:11434
# export VITE_OLLAMA_MODEL=llama3:8b-instruct
```

## Integrate in your App
Example (pseudo-code – adapt to your current App.tsx state names):

```tsx
// App.tsx (snippet)
import CoachPanel from './CoachPanel';
import { useCoachRunner } from './useCoach';
import type { Moment } from './CommentaryService';

// build moments from your moveEvals
function buildMoments(moveEvals): Moment[] {
  return moveEvals.map((m:any) => ({
    index: m.index, moveNo: m.moveNo, side: m.side, san: m.san,
    tag: m.tag || 'Good',
    cpBefore: m.cpBefore ?? null, cpAfter: m.cpAfter ?? null,
    dWin: m.dWin ?? null, best: m.best ?? null, pv: null
  }));
}

const { coach, coachBusy, coachErr, runCoach } = useCoachRunner({
  getMoments: () => buildMoments(moveEvals /* or filter non-book */),
  getSummary: () => ({
    opening: openingText || null,
    whiteAcc: review?.whiteAcc ?? null,
    blackAcc: review?.blackAcc ?? null,
    avgCplW: review?.avgW ?? null,
    avgCplB: review?.avgB ?? null,
  }),
  getPgn: () => undefined // optional raw PGN
});

// Add a button near Analyze PGN:
<button onClick={runCoach} disabled={coachBusy}>Generate Coach Notes</button>

// Render the panel somewhere in Sidebar:
<CoachPanel coach={coach} coachBusy={coachBusy} coachErr={coachErr} />
```

That’s it. The service is **local-only** and will be disabled if Ollama isn’t running.
