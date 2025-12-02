ML Coach (Ollama) wired via Electron IPC

Added:
- electron/coachBridge.js  (talks to Ollama /api/generate)
- preload: window.coach.generate(inputs)
- webui/src/useCoach.ts    (hook to call coach)
- webui/src/CoachPanel2.tsx (panel to render notes)

Usage in React (pseudo):

import CoachPanel2 from './CoachPanel2';
import { useMemo } from 'react';

const inputs = useMemo(()=>({
  summary: { opening, whiteAcc, blackAcc, avgCplW, avgCplB },
  moments: salientMoments, // Mistake/Blunder (+ some Best)
  pgn
}), [opening, whiteAcc, blackAcc, avgCplW, avgCplB, salientMoments, pgn]);

<CoachPanel2 inputs={inputs} onJump={(i)=>rebuildTo(i)} />

Env:
  OLLAMA_URL=http://localhost:11434
  COACH_MODEL=qwen3:4b-instruct
  COACH_TIMEOUT_MS=5000

Make sure Ollama is running and the model is pulled, e.g.
  ollama pull qwen3:4b-instruct
