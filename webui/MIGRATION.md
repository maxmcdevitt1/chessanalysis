## Migration Notes

This refactor introduces a dedicated engine worker/adapter pipeline and replaces the module-level picker singleton with an instance-based API.

### Engine worker + adapter

* `src/engine/engine-worker.ts` now proxies all analysis/review/opening calls through a `MessageChannel`, ensuring that late responses can be dropped and that `AbortSignal` is honoured end-to-end.
* Use `createEngineAdapter()` (see `src/engine/engineAdapter.ts`) to obtain an `EngineAdapter` instance. Call `dispose()` when you no longer need it.

```ts
import { createEngineAdapter } from './engine/engineAdapter';

const engine = createEngineAdapter();
const analysis = await engine.analyse({ fen, multipv: 3, movetime: 800 });
engine.dispose();
```

### Bot picker factory

`botPicker.ts` now exports a factory instead of global setters:

```ts
import { createBotPicker } from './botPicker';
import { createEngineAdapter } from './engine/engineAdapter';

const engine = createEngineAdapter();
const picker = createBotPicker({ engine });

const pick = await picker.pickMove({ fen, elo, history });
picker.dispose();
engine.dispose();
```

The picker accepts optional `OpeningBook`, `RNG`, and `PickerConfig` overrides. Each `pickMove` call returns `{ uci, reason, meta }`; `meta` contains the RNG seed, temperature, drop relaxations, MultiPV bumps, and information about whether book selections or imperfection profiles were used.

### Deterministic RNG

`createBotPicker` accepts an `rng` dependency. By default it uses `Math.random`, but tests and reproducible scenarios can pass a seeded RNG such as:

```ts
import { createMulberry32 } from './utils/rng';

const picker = createBotPicker({ engine, rng: createMulberry32(42) });
```

### Config/constants

Picker thresholds, widening steps, and imperfection profiles now live in `src/config/picker.ts`. Update the central config to adjust band behaviour instead of sprinkling magic numbers through the codebase.

### Hooks scaffolding

New hooks (`useGameState`, `useEngineAnalysis`, `useBatchAnalysis`, `useOpeningDetection`, `useBotReply`, `useSettings`) have been added for future integration work. Existing UI still uses the legacy plumbing, but the hooks encapsulate memoised FEN generation, cancellation, and persistence-ready adapters for incremental adoption.

### Derived review/coach helpers

`App.tsx` now leans on dedicated hooks for read-only data:

* `useReviewSummary` (`review` + `evalSeries` + rolling ACPL persistence)
* `useCoachMoments` (now feeding the Platinum-style coach summaries)
* `useBestArrow` and `useEvalDisplayCp` for board overlays
* `useEngineReply` centralises bot move picking, fallbacks, and the auto-reply effect
* `useEngineStrength` owns band selection, persistence, and `setStrength` IPC
* `usePgnImport` handles PGN-to-UCI translation, load-from-file/text wiring, and error surfacing
* `useOpeningBookMoves` exposes deduplicated book continuations powered by the indexed book cache so both the picker and the UI use the same source of truth
* `useAnalysisController` now reads from the same indexed book when tagging moves as “Book”, so analysis, UI suggestions, and the picker stay consistent
* `usePlayerControls` centralises move application, draw/resign/new-game flows, and clock hand-offs so `App.tsx` stays declarative
* `useCoachActions` wraps coach payload construction + submission (PGN + eval summaries) so `App.tsx` no longer builds ad-hoc payloads for the commentary service
* `useReviewAndCoach` composes review summaries and the “generate notes” action so the UI doesn’t juggle those hooks directly. The coach now returns premium-style sections (executive summary, phase reviews, key moments, and lessons) along with a derived move-by-move breakdown so users can still scan each ply.
* `useOpeningDetection` now derives its book mask/label seed from the indexed bot book (still falling back to the ECO trie for long labels), eliminating the duplicate trie scan each move
* `useSettings()` now syncs with the Electron settings store so engine threads/hash, live MultiPV, and the “Disable GPU” flag survive restarts (in addition to the legacy band/auto-reply toggles).
* The sidebar exposes a **Performance & Safety** panel (threads, hash, live MultiPV, GPU) and a Panic button wired to the new `engine:panic` IPC so users can immediately stop Stockfish if the laptop spikes.

Prefer these hooks/utilities whenever you need the same derived data elsewhere so we keep a single implementation (and a focused test surface in `reviewSummary.test.ts`).

### Toast notifications

Transient errors (engine offline, coach unavailable, failed analysis) are now surfaced through a lightweight toast system:

* `useToasts()` exposes `{ toasts, push, dismiss, clear }`. Call `push({ message, variant })` inside hooks/effects when you want to surface an error or warning.
* Render `<ToastStack toasts={toasts} onDismiss={dismiss} />` once near the root layout to display the stacked banners.
* `push` accepts optional `autoDismissMs` and returns an ID so callers can cancel/dismiss if needed.

This replaces silent `console.error` paths so users understand why an action failed without opening DevTools.

### Accuracy curve parity

`accuracyFromAvgCpl` now matches the latest Lichess anchors (≈91 ACPL → 70%, ≈94 ACPL → 69%). Update any downstream expectations or dashboards that were compensating for the previous, flatter curve.

### Settings persistence

User preferences now live under `appSettings.v2`. The `useSettings()` hook still debounces writes to localStorage, but it also forwards updates to the Electron settings store so the main process can honour engine threads/hash, live MultiPV, and the GPU toggle before the renderer loads. Extend the `Settings` type and call `update({ field })` to add new knobs; the hook will coerce types, persist them locally, and forward them to the main process.

### Opening book

Opening logic lives in `src/book/bookIndex.ts` with a first-move index for quicker lookups. It preserves ECO/name metadata and supports band-specific behaviour (favouring common lines, exiting early for the developing band, etc.).

### Misc

* Logging now flows through the optional `Logger` interface supplied to the picker factory.
* `App.tsx` consumes the new engine adapter/picker path and no longer mutates hidden picker globals.
* Move severity buckets have been rebalanced (Good ≤ 80 CPL, Inaccuracy ≤ 180, Mistake ≤ 380) to better match Lichess-style accuracy displays.

> **Note**: Tests and the full React hook refactor are staged but not yet activated in the UI. When migrating existing features, prefer the new hooks/components for a cancellable-by-default flow.
