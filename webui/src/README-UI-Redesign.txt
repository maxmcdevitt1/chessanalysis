# UI Redesign — SVG badges + Arrow keys + Stable sizing

Files:
- `src/TagBadges.tsx` — SVG badges
- `src/EvalSparkline.tsx` — small, downsampled sparkline
- `src/BoardPane.tsx` — stable layout using SVG badges; sparkline in right column
- `src/hooks/useGlobalArrowNav.ts` — global arrow-key hook
- `src/KeyboardNav.tsx` — zero-UI component to enable arrow keys

## App.tsx wiring

1) Enable arrow keys globally (like before):
```tsx
import KeyboardNav from './KeyboardNav';
<KeyboardNav ply={ply} movesUciLength={movesUci.length} onRebuildTo={onRebuildTo} />
```

2) Feed UI data into BoardPane:
```tsx
<BoardPane
  // ...existing props
  currentMoveEval={ply > 0 ? (moveEvals[ply - 1] ?? null) : null}
  evalSeries={moveEvals.map(m => (m?.cpAfter ?? null))}
  engineStrength={engineStrength}
  onEngineStrengthChange={setEngineStrength}
/>
```
