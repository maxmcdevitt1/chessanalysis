# Chess Analysis (Optimized Project)

This is a clean Electron + React (Vite) desktop app using **native Stockfish** (no WASM).
It is designed to produce a `.deb` you can install and click from your launcher.

## Dev
1) Ensure you have a Stockfish binary. EITHER:
   - `sudo apt install stockfish` (system-wide), OR
   - Place a binary at `electron/bin/linux/stockfish` and `chmod +x` it.
2) Run dev:
   ```bash
   npm install
   npm run dev
   ```
   - Vite on :5173, Electron will open automatically.

## Build & Install (Linux)
```bash
npm run dist
sudo apt install ./dist-electron/*.deb
```
The `.desktop` entry and icon are generated; app is clickable in your menu.

## macOS – Run & Install
### Dev mode
```bash
npm install
npm run dev
```
Electron opens once Vite is live. Ensure you have a `stockfish-mac` (or `stockfish`) binary under `electron/bin/mac/` (see below) and `chmod +x` it.

### Build (dmg/default target)
```bash
npm run dist -- --mac
```
Artifacts land in `dist-electron/` (a `.dmg` by default). Gatekeeper may require you to allow the unsigned binary the first time unless you sign it yourself.

## Windows – Run & Install
### Dev mode
```bash
npm install
npm run dev
```
Electron will open once the Vite dev server is reachable.

### Portable build
```bash
npm run dist -- --win nsis portable
```
The portable bundle (in `dist-electron\`) includes `run-safe.cmd`, which launches the app with conservative env vars:

```
ENGINE_THREADS=1
ENGINE_HASH_MB=64
ELECTRON_DISABLE_GPU_MULTIPROCESS=1
```

Double-clicking `run-safe.cmd` keeps CPU/GPU usage in check on laptops. Drop an AVX2 Stockfish build at `electron/bin/stockfish.exe` before running `npm run dist` (it will be copied into `bin\` next to the EXE). You can override the engine path at runtime via the `STOCKFISH_PATH` env var.

### Installer
The same `npm run dist -- --win nsis portable` command also produces a signed NSIS installer. It installs to `%LOCALAPPDATA%\Programs\ChessAnalysis` by default, registers the icon, and uninstalls cleanly via “Add/Remove Programs”.

### Runtime switches
- **Engine threads/hash/MultiPV/GPU**: Adjust via the new *Performance & Safety* panel in the sidebar. Threads (1–4), hash (64–256 MB), live MultiPV (1–2), and the “Disable GPU acceleration” toggle persist between runs. GPU changes take effect on the next launch.
- **Panic button**: Immediately stops Stockfish, cancels live analysis, and frees CPU. Useful if the laptop fans spike.
- **Environment overrides**: `ENGINE_THREADS`, `ENGINE_HASH_MB`, and `STOCKFISH_PATH` still work for power users and are applied before user settings.

### Stockfish binaries (all platforms)
The builder copies everything under `electron/bin/` into the packaged app (as `resources/bin`). Drop the appropriate engine before running `npm run dist`:

| Platform | Expected path | Notes |
| --- | --- | --- |
| Linux | `electron/bin/linux/stockfish` (or `electron/bin/stockfish`) | Must be executable (`chmod +x`). |
| Windows | `electron/bin/stockfish.exe` or `electron/bin/win/stockfish.exe` | AVX2 build recommended; `run-safe.cmd` references this location. |
| macOS | `electron/bin/mac/stockfish-mac` (or `stockfish`) | Universal/Apple Silicon builds work; ensure execute bit. |

At runtime we probe `resources/bin/<platform>/` plus common system locations (`/usr/games/stockfish`, `/opt/homebrew/bin/stockfish`, `%PROGRAMFILES%/Stockfish/stockfish.exe`, etc.). You can always point the app at a specific engine via the `STOCKFISH_PATH` environment variable when launching Electron or the packaged app.

## Notes
- Electron main is **CommonJS** for simplicity.
- UI talks to engine via IPC (see `webui/src/bridge.ts`).
- No HTTP server is required.
- Windows packaging uses NSIS + portable targets (see `electron-builder.yml`). Artifacts land in `dist-electron/`.

### Coach in Dev Mode
The coach pipeline relies on Electron IPC (`window.electron.invoke`). When running only `npm run dev:ui` (Vite in the browser) the IPC bridge is absent, so the coach will show “offline”. To exercise the full coach flow locally, launch the Electron shell as well:

```bash
npm run dev      # spawns Vite + Electron so window.electron is available
```

Alternatively run `npm run dev:ui` in one terminal and `npm run dev:app` in another; both must be active for the coach to connect to Ollama.

## Architecture & Engine Behavior
- **Playing strength lives in `webui/src/botPicker.ts`**. The picker is now created via `createBotPicker({ engine })` so multiple boards/bots can coexist without sharing global mutable state. Each picker call returns `{ uci, reason, meta }` with deterministic RNG seeds (pass a seeded RNG for reproducible results). The exponential weighting (`weight = exp(-k * deltaCp)`) and band tuning knobs live in `src/config/picker.ts`.
- **Openings come from `webui/src/data/beginneropenings.json`**. Lines are weighted by opening.weight × line.weight and sampled up to 12 plies; moves are validated against the current FEN. Polyglot (`data/book.bin`) is used only for ECO/name identification.
- **Engine worker**: `webui/src/engine/engine-worker.ts` runs all `analyse`, `reviewFast`, and `identifyOpening` calls off the UI thread. Use `createEngineAdapter()` to talk to the worker; each request accepts an `AbortSignal`, and the adapter drops late responses to avoid clobbering newer state.
- **Engine config**: The UI slider persists the target Elo via `setStrength`; per-move play settings are applied inside the picker (MultiPV, threads/hash, movetime) and passed through the adapter on every request. Stockfish searches are always used for move selection (no book moves from the engine side).
- **Opening labels**: The renderer prefers Polyglot ECO/name via the `identifyOpening` IPC. If none is found, it falls back to trie/JSON labels; opening masks/depth still come from the trie/fallback helpers.
- **Coach notes**: The Ollama-backed coach now produces premium-style summaries (Executive Summary, phase reviews, turning points, and lessons) plus a derived move-by-move breakdown. The renderer requests these via `coach:generate`.
- **Human move commentary**: The short per-move bubbles no longer come from the IPC payload. Instead `webui/src/coach/coachBubble.ts` deterministically rebuilds the text from each moment’s FEN, SAN, and tag. Templates stay Chess.com-like (book/best/good/mistake/blunder tone) and are protected by an anti-repetition buffer. Tweak phrasing or anchors in that module—no server changes required.
- For more detail, see `electron/engine/uci.js` (engine lifecycle + IPC), `electron/main.js` (IPC wiring), and `webui/src/App.tsx` (game state + coach/review flows).

## Performance guardrails
- Live analysis automatically pauses whenever a batch review starts, and both stop if you make a move or hit the Panic button.
- Conservative defaults (Threads=1–2, Hash=64 MB, live MultiPV=1) keep laptops responsive. You can raise them in the sidebar when plugged in.
- Picker movetime is capped globally (≈1.5s) and progressively widens drop tolerance → MultiPV → time. It never exceeds the cap before falling back to a legal move.
- Structured picker logs (band, movetime, widening steps) are emitted via the optional logger for diagnostics.
