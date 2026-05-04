# Reframe

A cross-platform desktop screen recorder + post-recording editor. Record your screen (with optional system audio, mic, and webcam), then re-frame it: backgrounds, layouts, zoom, trim, speed, annotations — and export to MP4. Targets Linux, Windows, macOS.

## Stack

Electron + React + TypeScript + Vite + Tailwind + Zustand. Recording via `desktopCapturer` + `MediaRecorder`. Real-time canvas-driven export via `MediaRecorder` (MP4 when Chromium advertises an H.264 encoder; otherwise WebM with a one-shot `ffmpeg` conversion hint).

## Run

### Quickest way to see it

```bash
npm install
npm run start
```

`npm run start` builds the renderer once, then launches the Electron app. A frameless pill window (the HUD) appears near the top of your primary display. **It is small (~620×60) — easy to miss.**

### Dev with hot reload

```bash
# Terminal 1 — Vite dev server + main/preload watcher
npm run dev

# Terminal 2 — launches Electron pointed at the dev server
npm run electron
```

`http://localhost:5173/` in a regular browser only shows a help page; the actual UI is in the desktop window.

### Linux gotchas (handled automatically by `scripts/electron.mjs`)

- `ELECTRON_RUN_AS_NODE=1` is unset before launch (with it set, `require('electron')` returns the binary path instead of the API and main process fails immediately).
- `--no-sandbox` is passed (`chrome-sandbox` helper usually lacks SUID-root).
- `DISPLAY=:1` set if the session doesn't have one.

## Build

```bash
npm run build              # type-check + bundle renderer + main + preload
npm run package            # packages for current platform
npm run package:linux      # AppImage + .deb
npm run package:win        # NSIS .exe
npm run package:mac        # .dmg
```

Output lands in `release/`.

## Recordings on disk

Saved to `~/Videos/reframe/` as timestamped `.webm` files. If you record with the webcam toggle on, a second `<timestamp>-webcam.webm` is saved alongside so the editor can re-position the webcam over the screen.

Project files: `.reframe.json` — saved/loaded via the editor's `File` menu.

## Layout

```
electron/             # main process + preload (Node, CommonJS bundle)
  main.ts
  preload.ts
src/
  shared/ipc.ts       # typed IPC contract used by both sides
  hud/                # tiny pill toolbar (HUD window)
  picker/             # source-picker modal
  editor/             # full editor (preview + sidebar + timeline + export)
```

## Keyboard

- `Z` / `T` / `A` / `S` — add a Zoom / Trim / Annotation / Speed item at the playhead
- `Del` / `Backspace` — delete the selected timeline item
- `Space` — play / pause
- `Ctrl+Shift+0` (global) — stop recording from any focused window
