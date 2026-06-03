# Chess Analysis

Offline chess analysis desktop app built with Electron, React, Vite, and native Stockfish.

## Development

Install dependencies and start the full app:

```bash
npm install
npm --prefix webui install
npm run dev
```

`npm run dev` starts the Vite UI on port 5173 and then launches Electron with the IPC bridge enabled. Running only `npm run dev:ui` is useful for UI work, but engine and coach calls require Electron.

On Windows, do not run Windows `npm` from a `\\wsl.localhost\...` UNC working directory. `cmd.exe` does not support UNC paths as the current directory, and Electron/npm lifecycle scripts can fail. Use a normal Windows path, map the UNC path to a drive first, or run Linux `npm` inside WSL from `/home/...`.

## Build

```bash
npm run dist
```

The packaged app is written to `dist-electron/`. Platform targets are configured in `electron-builder.yml`.

## Stockfish

The app uses a native Stockfish binary through Electron IPC. At runtime it checks packaged binaries first, common system install locations second, and finally falls back to `stockfish` on `PATH`.

For packaged builds, place the engine under `electron/bin/` before running `npm run dist`:

| Platform | Preferred path |
| --- | --- |
| Windows | `electron/bin/win/stockfish.exe` or `electron/bin/stockfish.exe` |
| macOS | `electron/bin/mac/stockfish-arm64` or `electron/bin/mac/stockfish-x64` |
| Linux | `electron/bin/linux/stockfish` or `electron/bin/stockfish` |

You can override detection with `STOCKFISH_PATH`.

## Project Layout

- `electron/` contains the main process, preload bridge, settings store, coach bridge, and UCI Stockfish wrapper.
- `webui/src/` contains the React app, hooks, engine adapter, opening detection, review logic, and tests.
- `webui/src/data/beginneropenings.json` drives bot opening choices.
- `webui/src/data/openings/eco.json` drives bundled ECO opening labels.
- `webui/public/opening-book.json` drives book masks and suggested book continuations.

## Checks

```bash
npm --prefix webui run test
npm run build:ui
```
