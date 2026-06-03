# Project Workflow Trace

Last updated: 2026-06-02 Hawaii time / 2026-06-03 UTC

This file records the project inspection notes, workflow trace, and current release status. It is intentionally written as shareable engineering notes, not private scratchpad.

## Current Snapshot

- Branch: `main`
- Local status at inspection start: clean and tracking `origin/main`
- App version: `0.2.2`
- Latest pushed commits:
  - `d4b55ca` - aggressive cleanup of unused code/data/tooling
  - `44decea` - remove native optional install path and bump to `0.2.2`
- Release tags created during this pass:
  - `v0.2.1`: GitHub Actions failed on Windows install
  - `v0.2.2`: GitHub Actions also failed on Windows install

Remote workflow status from GitHub API:

- Run `26861897220`, tag `v0.2.2`, workflow `Build & Release`
- Overall status: `completed`
- Overall conclusion: `failure`
- Windows job: `failure` at `Install dependencies`
- macOS job: `success`
- Ubuntu job: `success`
- Release/upload job: `skipped` because the matrix build did not fully pass
- Run URL: `https://github.com/maxmcdevitt1/chessanalysis/actions/runs/26861897220`

Public GitHub page shows the Windows failure annotation but not the detailed npm log without authenticated repository access.

## Local Development Workflow

Root scripts:

- `npm run dev`
  - Runs `dev:ui` and `dev:app` in parallel through `npm-run-all`.
  - `dev:ui` runs `npm --prefix webui run dev`, which starts Vite on port `5173`.
  - `dev:app` waits for port `5173`, then launches Electron with `ELECTRON_START_URL=http://localhost:5173`.
- `npm run build:ui`
  - Runs `npm --prefix webui run build`.
  - Builds the React/Vite renderer into `webui/dist`.
- `npm run dist`
  - Runs `build:ui`.
  - Runs `electron-builder -c electron-builder.yml`.
- `npm run start`
  - Launches Electron directly against the packaged/dev app entry.

Install behavior:

- Root `npm install` installs Electron/build tooling.
- `npm --prefix webui install` installs renderer dependencies explicitly.
- Root `postinstall` was removed after the UNC/npm failure screenshot so local and CI installs are easier to reason about.

## GitHub Release Workflow

File: `.github/workflows/release.yml`

Trigger:

- Runs only on pushed tags matching `v*`.

Build matrix:

- `windows-latest`
- `macos-latest`
- `ubuntu-latest`

Per-platform build steps:

- Checkout.
- Setup Node `20` with npm cache.
- Run `npm install`.
- On Windows: `npm run dist -- --win nsis portable --publish=never`.
- On macOS: `npm run dist -- --mac dmg --publish=never`.
- On Linux: `npm run dist -- --linux appimage deb --publish=never`.
- Upload each `dist-electron/**` folder as an internal artifact.

Release job:

- Waits for all matrix builds.
- Downloads all matrix artifacts.
- Uploads installers/packages through `softprops/action-gh-release@v2`.

Expected Windows release artifacts when the workflow succeeds:

- `chessanalysis_0.2.2_windows_x64_setup.exe`
- `chessanalysis_0.2.2_windows_x64_portable.exe`

Current release blocker:

- Windows job fails during `Install dependencies`.
- macOS and Ubuntu jobs complete successfully.
- Because the build matrix has one failure, the release job is skipped and no `.exe` is published.

Recommended next diagnostic:

- Use authenticated GitHub access or the GitHub UI while signed in to view the full Windows job log.
- CI has been changed to split root and `webui` installs into explicit steps. Re-tag to validate whether this resolves the Windows install failure.

## Packaging Workflow

File: `electron-builder.yml`

Shared packaging settings:

- Output directory: `dist-electron`
- Build resources: `build`
- Included app files:
  - `electron/**`
  - `webui/dist/**`
  - `package.json`
- Extra resources copied into package:
  - `electron/bin/**` to `resources/bin`
  - `assets/**` to `resources/assets`

Platform targets:

- Windows:
  - NSIS installer
  - Portable executable
  - Uses `build/icon.ico`
  - Copies `electron/run-safe.cmd` into the packaged app
- macOS:
  - DMG and ZIP
  - Config references `build/icon.icns`
- Linux:
  - AppImage and DEB
  - Uses `build/icon.png`

Asset state observed locally:

- `build/icon.ico` exists.
- `build/icon.png` exists.
- `assets/icon.png` exists.
- `build/icon.icns` was not seen in the inspected file list, yet the macOS Actions job reported success. If macOS icon quality matters, verify the artifact manually.

Engine binary state:

- Tracked binaries observed:
  - `electron/bin/mac/stockfish-arm64`
  - `electron/bin/mac/stockfish-x64`
- No tracked Windows or Linux Stockfish binary was observed.
- Runtime can still find system Stockfish or `STOCKFISH_PATH`.
- Packaged Windows builds may not include a Windows Stockfish binary unless one is added under `electron/bin/win/stockfish.exe` or `electron/bin/stockfish.exe` before packaging.

## Runtime Workflow

Electron main process:

- Entry: `electron/main.js`
- Loads settings through `electron/settingsStore.js`.
- Applies `disable-gpu` before app readiness if configured.
- Registers IPC handlers before loading the renderer.
- Loads Vite dev URL in development when available.
- Falls back to `webui/dist/index.html` when the dev server is unavailable.

Preload bridge:

- File: `electron/preload.js`
- Exposes:
  - `window.engine`
  - `window.coach`
  - `window.appSettings`
  - `window.electron.invoke`

Renderer app:

- Entry: `webui/src/main.tsx`
- Root component: `webui/src/App.tsx`
- App creates one engine adapter with `createEngineAdapter()`.
- App wires board state, engine replies, live analysis, opening detection, PGN import, batch review, coach notes, settings, and toast errors.

Engine adapter path:

1. React hooks call `EngineAdapter`.
2. `webui/src/engine/engineAdapter.ts` prefers a Web Worker.
3. `webui/src/engine/engine-worker.ts` receives worker requests and forwards host calls through `MessageChannel`.
4. Host calls use `webui/src/bridge.ts`.
5. `bridge.ts` calls `window.engine`.
6. `window.engine` invokes Electron IPC from `preload.js`.
7. `electron/main.js` handles IPC and lazily creates the UCI engine.
8. `electron/engine/uci.js` launches Stockfish and serializes UCI operations.

Stockfish resolution order:

- `STOCKFISH_PATH` if set and valid.
- Packaged `resources/bin`.
- Dev `electron/bin`.
- Platform subdirectories such as `mac`, `linux`, or `win`.
- Common system install locations.
- Final fallback: `stockfish` on `PATH`.

Engine lifecycle:

- Engine starts lazily on first IPC call.
- A single engine instance is reused.
- Idle timeout stops Stockfish after `ENGINE_IDLE_MS`, default `90000`.
- Panic IPC stops the engine immediately.
- Changing threads/hash settings stops the engine so it restarts with new settings.

## Bot Move Workflow

Relevant files:

- `webui/src/hooks/useEngineReply.ts`
- `webui/src/hooks/useBotReply.ts`
- `webui/src/botPicker.ts`
- `webui/src/book/bookIndex.ts`
- `webui/src/data/beginneropenings.json`
- `webui/src/engine/engineAdapter.ts`

Flow:

1. Player move updates game state.
2. `useEngineReply` decides whether auto-reply should run.
3. `useBotReply` owns a picker created by `createBotPicker({ engine, book })`.
4. `createOpeningBook()` indexes `beginneropenings.json`.
5. `botPicker` first tries a weighted book pick based on side, history, FEN, band, top lines, and early-exit probability.
6. If no book pick applies, `botPicker` calls `engine.analyse()`.
7. Engine candidates are sampled through the target-CPL weighting model.
8. If engine returns no candidates, a random legal fallback is used.

Important conclusion:

- Engine/bot opening moves are not Polyglot-based in the current app.
- They are JSON-book based through `webui/src/data/beginneropenings.json`.
- That path is intact and covered by tests.

## Opening Detection Workflow

Relevant files/data:

- `webui/src/hooks/useOpeningDetection.ts`
- `webui/src/utils/openingBook.ts`
- `webui/public/opening-book.json`
- `webui/src/openings/matcher.ts`
- `webui/src/data/openings/eco.json`
- `electron/engine/book.js`
- `electron/engine/uci.js`

Flow:

1. `useOpeningDetection` runs three paths:
   - public opening book detection from `/opening-book.json`
   - bundled ECO trie detection from `src/data/openings/eco.json`
   - Electron engine metadata detection via `engine.identifyOpening`
2. Public opening book detection provides:
   - book mask
   - book depth
   - opening label when the JSON node has labels
3. Bundled ECO detection builds an in-memory UCI prefix trie from `eco.json`.
4. Electron metadata detection calls `engine:identifyOpening`.
5. `electron/engine/uci.js` delegates that to `electron/engine/book.js`.

Polyglot state:

- `electron/engine/book.js` attempts `require('chess-polyglot')`.
- `chess-polyglot` is not currently a package dependency because adding it caused/likely contributed to Windows install failure risk.
- There is no tracked `data/book.bin` in the repo.
- Therefore Polyglot metadata detection is effectively inactive unless both an external module and `data/book.bin` are present in the runtime environment.

Opening coverage note:

- The aggressive cleanup removed `webui/public/eco1.json` and `webui/src/data/openings/eco1.json`.
- Current bundled label coverage depends on `webui/src/data/openings/eco.json` plus `webui/public/opening-book.json`.
- Common detection paths pass tests, but obscure opening label coverage may be lower than before.

## Coach Workflow

Relevant files:

- `webui/src/hooks/useReviewAndCoach.ts`
- `webui/src/hooks/useCoachActions.ts`
- `webui/src/hooks/useCoach.ts`
- `webui/src/CommentaryServiceOllama.ts`
- `electron/coachBridge.js`

Flow:

1. UI derives review summary and coach moments from moves/evals/book mask.
2. `useCoachActions` builds a coach payload.
3. `useCoach` calls `generateCoachNotes`.
4. `CommentaryServiceOllama.ts` calls `window.electron.invoke('coach:generate', payload)`.
5. `electron/coachBridge.js` talks to Ollama at `OLLAMA_URL`, default `http://localhost:11434`.
6. If Ollama/model calls fail or produce invalid JSON, heuristic fallback sections/notes are used.

Observed cleanup fix:

- `coachBridge.js` previously had a duplicate `keySwingMoment` declaration.
- That was fixed because Electron-side syntax checks would fail.

## Settings Workflow

Relevant files:

- `webui/src/hooks/useSettings.ts`
- `webui/src/persist.ts`
- `electron/settingsStore.js`
- `electron/main.js`
- `electron/preload.js`

Flow:

1. Renderer settings initialize from local persisted values and Electron settings when available.
2. Updates are persisted locally and forwarded to `window.appSettings.update`.
3. Electron settings are stored through `settingsStore`.
4. If engine thread/hash settings change, main process stops the current engine so the next request starts with updated options.
5. `disableGpu` is applied on next launch before Chromium initializes.

## Verification Already Run Locally

After cleanup and `0.2.2` version bump:

- `npm --prefix webui run test -- --run`
  - 11 test files passed
  - 29 tests passed
- `npm run build:ui`
  - Vite production build passed
- Electron syntax check:
  - `node --check` over `electron/**/*.js` passed
- `npm audit`
  - 0 vulnerabilities
- `depcheck`
  - root and `webui` were clean during the previous pass
- Local `npm ci --ignore-scripts`
  - succeeded on Windows local environment

These local checks do not prove the GitHub Windows install because the failing Actions step requires the full Windows runner log.

## Active Findings

1. Windows GitHub release is blocked before `.exe` creation.
   - Failing step: `Install dependencies`.
   - Failing runs: `v0.2.1` and `v0.2.2`.
   - macOS and Ubuntu jobs succeeded, so the issue is Windows-specific or install-script-specific.

2. Workflow logs need authenticated access for the full npm error.
   - Public page shows only the failing step and exit code.
   - GitHub API job-log download returned `403` without repository admin rights.

3. Root `postinstall` was removed after this finding.
   - The workflow now installs root and `webui` dependencies in separate steps.
   - This should make future CI install failures easier to locate.
   - A fresh release tag is still needed to confirm the Windows runner behavior.

4. Windows packaged engine binary is not tracked.
   - Windows package can be built, but runtime Stockfish availability depends on a bundled Windows binary, system install, or `STOCKFISH_PATH`.

5. Polyglot metadata support is present as a best-effort hook, but inactive by default.
   - Missing `data/book.bin`.
   - Missing installed `chess-polyglot` dependency by design after Windows install issues.
   - Bot opening moves are unaffected because they do not use Polyglot.

6. Opening label coverage was reduced by removing `eco1`.
   - Current detection still works from `opening-book.json` and bundled `eco.json`.
   - If broad ECO coverage matters, restore one canonical full ECO source instead of keeping duplicates.

## Recommended Next Steps

1. Inspect the authenticated Windows Actions log for run `26861897220`.
2. Re-tag after the workflow install fix, for example `v0.2.3`, because `v0.2.1` and `v0.2.2` already point to failed release attempts.
3. Add or document a Windows Stockfish binary source before expecting packaged `.exe` runtime engine behavior.
4. Decide whether full ECO coverage should be restored through one canonical file.

## Prompt Log

### 2026-06-02 HST - UNC npm install failure screenshot

User instruction:

- Keep logging prompt-by-prompt project notes into this file.
- Screenshot shows `npm install` being run from `\\wsl.localhost\Ubuntu\home\max\programming\chessanalysis-0.2.2\...` using Windows `cmd.exe`.

Recorded engineering notes:

- I will keep a running project log here after user prompts, focused on audit notes, decisions, commands, and findings. I will not record private chain-of-thought verbatim.
- The screenshot failure is consistent with Windows `cmd.exe` not supporting UNC paths as the current directory: `CMD.EXE was started with the above path as the current directory. UNC paths are not supported. Defaulting to Windows directory.`
- Once `cmd.exe` falls back to `C:\Windows`, npm lifecycle scripts can fail to find project-local commands and dependency install scripts can run from the wrong place.
- The visible `'run-p' is not recognized` symptom is consistent with scripts being evaluated without the expected project-local `node_modules/.bin` context.
- The visible Electron install failure also uses `cmd.exe /d /s /c node ...`, so this is not only an app script issue; dependency lifecycle scripts are affected too.
- Repo-side mitigation chosen: remove root `postinstall` and make root/webui installs explicit in docs and GitHub Actions. This reduces nested install ambiguity but does not change `cmd.exe` UNC behavior.
- User-side workaround: run from a normal Windows path, map the UNC path to a drive before running Windows npm, or run Linux npm inside WSL from the native `/home/...` path.
