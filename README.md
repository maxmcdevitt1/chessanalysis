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

## Build & Install
```bash
npm run dist
sudo apt install ./dist-electron/*.deb
```
The `.desktop` entry and icon are generated; app is clickable in your menu.

## Notes
- Electron main is **CommonJS** for simplicity.
- UI talks to engine via IPC (see `webui/src/bridge.ts`).
- No HTTP server is required.
