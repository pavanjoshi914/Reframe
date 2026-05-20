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

## Releasing

Cross-platform installers are built on GitHub's runners — you can't cross-build
macOS/Windows from Linux locally. The `.github/workflows/release.yml` workflow
is **manual-trigger only**:

1. Push your commits (and bump `version` in `package.json` if needed).
2. GitHub → **Actions** tab → **Build Reframe** → **Run workflow**.
3. ~10–15 min later, download the artifacts from the finished run:
   `linux-installers` (AppImage + deb), `windows-installer` (.exe),
   `macos-installer-arm64` / `macos-installer-x64` (.dmg).
4. Create the GitHub release by hand and upload those files.

The macOS `.dmg` is **unsigned** — users right-click → Open on first launch to
get past Gatekeeper. See the comment in `release.yml` for what's needed to ship
a signed + notarized build.

## Recording lifecycle

Raw `.webm` recordings are treated as the editor's scratch files — users
never see them in their file manager. The flow:

1. **Record** → file written to the OS app-data folder
   (`~/.config/Reframe/recordings/` on Linux,
   `~/Library/Application Support/Reframe/recordings/` on macOS,
   `%APPDATA%\Reframe\recordings\` on Windows).
2. **Editor opens** with the recording loaded. State is "pending".
3. From here, one of three things happens:
   - **Save Project** (`File → Save Project…`) → writes a `.reframe.json` to
     the user's Documents folder. The recording is now "kept" — referenced by
     that project file and never auto-deleted.
   - **Export Video** → an MP4 / GIF / WebM lands at the user-chosen path.
     The raw `.webm` is still pending; if no project was saved, it gets
     cleaned up at editor close.
   - **Close the editor** → if no project was saved this session, the pending
     `.webm` (and webcam companion, if any) are deleted from the app-data
     folder. Starting a new recording while the editor is open also discards
     the previous pending file.

Net result: the app-data recordings folder only contains files referenced by
saved projects. Closing the editor without saving leaves no scratch behind.

Project files (`.reframe.json`) live wherever the user saves them — by default
inside `~/Documents/`. Reopen one via `File → Open Project…`.

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
