import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, desktopCapturer, screen, shell, protocol, dialog, globalShortcut, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Custom scheme so the renderer (running on http://localhost:5173 in dev) can
// load on-disk recordings without tripping webSecurity. Must be declared
// before app `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Force a single canonical name so `app.getPath('userData')` resolves to the
// same folder in dev and prod (otherwise dev uses package.json `name` =
// "reframe" and prod uses electron-builder `productName` = "Reframe", and a
// dev build can't see prod-saved data).
app.setName('Reframe');

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');
const PRELOAD = path.join(__dirname, 'preload.js');
const APP_ICON = path.join(__dirname, '..', 'assets', 'logo-transparent.png');

let hudWindow: BrowserWindow | null = null;
let pickerWindow: BrowserWindow | null = null;
let editorWindow: BrowserWindow | null = null;
let regionSelectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Source associated with the display the user is currently selecting a region
// from. Captured when the overlay opens so the resulting region IPC payload
// can carry the matching desktopCapturer source id back to the HUD.
let regionSelectorSource: import('../src/shared/ipc.js').DesktopSource | null = null;

// Transparent windows on Linux/X11 require a running compositor; without one
// they render as fully invisible. Default ON everywhere — modern desktop envs
// (GNOME/Mutter, KDE/KWin) all run a compositor. Set OS_TRANSPARENT=0 to
// force opaque mode if the HUD pill is invisible on your setup.
const useTransparent = process.env.OS_TRANSPARENT !== '0';
const isDev = !!VITE_DEV_SERVER_URL;

let lastRecording: import('../src/shared/ipc.js').RecordingMeta | null = null;

// Three directories, three jobs:
//
//   recordingsTempDir — internal scratch for raw screen captures (.mp4 from the
//                       Linux ffmpeg path, .webm from the Chromium path). Lives
//                       in OS app-data (~/.config/Reframe/recordings on Linux,
//                       ~/Library/Application Support/Reframe/recordings on
//                       macOS, %APPDATA%\Reframe\recordings on Windows). The
//                       user never sees this folder in their file manager;
//                       cleanup happens via the startup orphan sweep.
//
//   projectsDir       — user-facing folder where auto-saved .reframe.json
//                       projects live. One file per recording session,
//                       auto-named like "Untitled-2026-05-18-203021.reframe.json".
//                       The user browses/deletes here.
//
//   exportsDir        — user-facing folder where exported MP4 / GIF / WebM
//                       files land by default (still overridable via the Save
//                       dialog).
//
// All three are assigned inside app.whenReady() because `app.getPath()`
// requires the app to be initialized first.
let recordingsTempDir = '';
let projectsDir = '';
let exportsDir = '';

function loadHtml(win: BrowserWindow, htmlName: string) {
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}${htmlName}`);
  } else {
    win.loadFile(path.join(RENDERER_DIST, htmlName));
  }
}

function createHud() {
  // Park the pill at the bottom-center of the primary display's work area
  // (so it sits just above the taskbar/dock, not on top of it). Same approach
  // openscreen uses — much more discoverable than the default OS-centered
  // placement where the HUD lands in the middle of the screen.
  const { workArea } = screen.getPrimaryDisplay();
  const windowWidth = 620;
  const windowHeight = 56;
  const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
  const y = Math.floor(workArea.y + workArea.height - windowHeight - 28);

  hudWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    transparent: useTransparent,
    backgroundColor: useTransparent ? '#00000000' : '#14161a',
    resizable: false,
    alwaysOnTop: true,
    hasShadow: useTransparent ? false : true,
    skipTaskbar: false,
    movable: true,
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  hudWindow.setAlwaysOnTop(true, 'floating');
  // setContentProtection works on macOS/Windows — excludes the window from
  // any screen capture done via desktopCapturer or OS-level recording APIs.
  // It's a no-op on Linux/X11; that's why we also hide the HUD during
  // recording on Linux (see hud:setRecording handler below).
  hudWindow.setContentProtection(true);
  loadHtml(hudWindow, 'hud.html');
  if (isDev) hudWindow.webContents.openDevTools({ mode: 'detach' });
  hudWindow.on('closed', () => {
    hudWindow = null;
    if (!editorWindow) app.quit();
  });
}

function createPicker() {
  if (pickerWindow) {
    pickerWindow.focus();
    return;
  }
  pickerWindow = new BrowserWindow({
    width: 760,
    height: 540,
    parent: hudWindow ?? undefined,
    modal: false,
    frame: false,
    resizable: false,
    transparent: useTransparent,
    backgroundColor: useTransparent ? '#00000000' : '#0e0f12',
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  pickerWindow.setContentProtection(true);
  loadHtml(pickerWindow, 'picker.html');
  if (isDev) pickerWindow.webContents.openDevTools({ mode: 'detach' });
  pickerWindow.on('closed', () => {
    pickerWindow = null;
  });
}

function createEditor(recording: import('../src/shared/ipc.js').RecordingMeta) {
  lastRecording = recording;
  if (editorWindow) {
    editorWindow.focus();
    editorWindow.webContents.send('recording:opened', recording);
    return;
  }
  editorWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0e0f12',
    show: false,
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });
  // Open maximized so the user lands in a full editor view straight after
  // recording instead of a cramped 1280×820 window. `show: false` + maximize
  // on ready-to-show avoids the visible resize jump from default size to
  // maximized that you get with `.maximize()` right after construction.
  editorWindow.once('ready-to-show', () => {
    editorWindow?.maximize();
    editorWindow?.show();
  });
  loadHtml(editorWindow, 'editor.html');
  editorWindow.on('closed', () => {
    editorWindow = null;
    // No cleanup needed on close — the editor auto-saves a project file the
    // moment a recording is loaded, so every recording is already "kept" via
    // its .reframe.json. Orphan temp recordings (e.g. from a crash or from a
    // project the user manually deleted) are swept on next app launch.
  });
}

function showHud() {
  if (!hudWindow || hudWindow.isDestroyed()) {
    createHud();
    return;
  }
  if (hudWindow.isMinimized()) hudWindow.restore();
  hudWindow.show();
  hudWindow.focus();
}

function createTray() {
  if (tray) return;
  // Tray icons want a small bitmap; the app icon is 512×512. Resize once on
  // construction so the menubar/status area gets a crisp 22px (Linux/Win) or
  // 16px (macOS) glyph instead of a downscaled-at-paint-time blur.
  const isMac = process.platform === 'darwin';
  const trayIconSize = isMac ? 16 : 22;
  const image = nativeImage
    .createFromPath(APP_ICON)
    .resize({ width: trayIconSize, height: trayIconSize, quality: 'best' });
  // On macOS, marking the icon as a template lets the OS recolor it for
  // light/dark menubars. Our plum logo isn't a single-color glyph, so we keep
  // it as a regular (colored) icon — same as openscreen.
  tray = new Tray(image);
  tray.on('click', showHud);
  tray.on('double-click', showHud);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const tooltip = isRecording ? 'Reframe — recording' : 'Reframe';
  const template: Electron.MenuItemConstructorOptions[] = isRecording
    ? [
        {
          label: 'Stop recording',
          click: () => hudWindow?.webContents.send('hud:stop-shortcut')
        },
        { type: 'separator' },
        { label: 'Open', click: showHud },
        { label: 'Quit', click: () => app.quit() }
      ]
    : [
        { label: 'Open', click: showHud },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ];
  tray.setToolTip(tooltip);
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('sources:get', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: s.thumbnail.toDataURL()
  }));
});

ipcMain.handle('displays:get', async () => {
  const allDisplays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 200 }
  });
  return allDisplays.map((d, idx) => {
    // Electron sets `display_id` on screen sources to the matching
    // screen.Display.id, but the field is poorly typed; cast through unknown.
    const source =
      sources.find((s) => String((s as unknown as { display_id: string }).display_id) === String(d.id)) ??
      sources[idx] ??
      null;
    return {
      id: String(d.id),
      name: `Display ${idx + 1}${d.id === primaryId ? ' (primary)' : ''}`,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === primaryId,
      sourceId: source?.id ?? '',
      thumbnailDataUrl: source?.thumbnail.toDataURL() ?? ''
    };
  });
});

async function createRegionSelector(displayId: string) {
  if (regionSelectorWindow) {
    regionSelectorWindow.focus();
    return;
  }
  const display = screen.getAllDisplays().find((d) => String(d.id) === displayId);
  if (!display) return;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 }
  });
  const source =
    sources.find((s) => String((s as unknown as { display_id: string }).display_id) === displayId) ??
    sources[0];
  if (!source) return;
  regionSelectorSource = {
    id: source.id,
    name: source.name,
    type: 'screen',
    thumbnailDataUrl: ''
  };

  regionSelectorWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: useTransparent,
    backgroundColor: useTransparent ? '#00000000' : '#000000',
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // 'screen-saver' level keeps the overlay above panels/docks across DEs.
  regionSelectorWindow.setAlwaysOnTop(true, 'screen-saver');
  regionSelectorWindow.setContentProtection(true);
  loadHtml(regionSelectorWindow, 'region.html');
  if (isDev) regionSelectorWindow.webContents.openDevTools({ mode: 'detach' });
  regionSelectorWindow.on('closed', () => {
    regionSelectorWindow = null;
    regionSelectorSource = null;
  });
}

ipcMain.handle('region:open', (_evt, displayId: string) => {
  // Close the picker (the user picked Area → display, the overlay takes over).
  pickerWindow?.close();
  void createRegionSelector(displayId);
});

ipcMain.handle('region:select', (_evt, region: import('../src/shared/ipc.js').Region) => {
  if (!regionSelectorSource) return;
  hudWindow?.webContents.send('region:selected', {
    source: regionSelectorSource,
    region
  });
  regionSelectorWindow?.close();
});

ipcMain.handle('region:cancel', () => {
  regionSelectorWindow?.close();
});

ipcMain.handle('picker:open', () => {
  createPicker();
});

ipcMain.handle('picker:select', (_evt, source) => {
  hudWindow?.webContents.send('source:selected', source);
  pickerWindow?.close();
});

ipcMain.handle('picker:cancel', () => {
  pickerWindow?.close();
});

// Shared tail of the save flow: given a finalized on-disk screen webm (whether
// written from a renderer MediaRecorder blob or produced by ffmpeg), attach the
// optional webcam clip + cursor/click sidecar and return the RecordingMeta.
function writeRecordingSidecars(
  filePath: string,
  meta: import('../src/shared/ipc.js').SaveRecordingMeta
): import('../src/shared/ipc.js').RecordingMeta {
  const ts = new Date(meta.startedAt).toISOString().replace(/[:.]/g, '-');
  let webcamFilePath: string | undefined;
  if (meta.webcamData) {
    webcamFilePath = path.join(recordingsTempDir, `${ts}-webcam.webm`);
    fs.writeFileSync(webcamFilePath, Buffer.from(meta.webcamData));
  }
  // Persist cursor samples + clicks captured during this recording as a sidecar
  // JSON ({ samples, clicks }; the editor also still accepts the legacy bare
  // array). Written whenever either was captured.
  let cursorFilePath: string | undefined;
  if (cursorSamples.length > 0 || clickSamples.length > 0) {
    cursorFilePath = path.join(recordingsTempDir, `${ts}.cursor.json`);
    try {
      const disp = recordedDisplay ?? screen.getPrimaryDisplay();
      // Normalize the raw pointer coords to 0..1 of the recorded frame. uiohook
      // reports PHYSICAL global pixels; the video is the recorded display at
      // physical resolution, so the true scale is (video px / display logical
      // px) — derived from the ACTUAL captured video size, not Electron's
      // scaleFactor (which is wrong on Wayland fractional scaling). The
      // getCursorScreenPoint fallback is LOGICAL, so it's normalized by the
      // display's logical bounds instead.
      const vw = meta.width || Math.round(disp.bounds.width * (disp.scaleFactor || 1));
      const vh = meta.height || Math.round(disp.bounds.height * (disp.scaleFactor || 1));
      const norm = (arr: CursorPt[]) => {
        if (cursorFromUio) {
          const scaleX = vw / Math.max(1, disp.bounds.width);
          const scaleY = vh / Math.max(1, disp.bounds.height);
          const oX = disp.bounds.x * scaleX;
          const oY = disp.bounds.y * scaleY;
          return arr
            .map((p) => ({ t: p.t, x: (p.x - oX) / vw, y: (p.y - oY) / vh }))
            .filter((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
        }
        return arr
          .map((p) => ({
            t: p.t,
            x: (p.x - disp.bounds.x) / Math.max(1, disp.bounds.width),
            y: (p.y - disp.bounds.y) / Math.max(1, disp.bounds.height)
          }))
          .filter((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
      };
      fs.writeFileSync(cursorFilePath, JSON.stringify({ samples: norm(cursorSamples), clicks: norm(clickSamples) }));
    } catch (err) {
      console.warn('[main] failed to write cursor sidecar', err);
      cursorFilePath = undefined;
    }
  }
  cursorSamples = [];
  clickSamples = [];
  const { webcamData, ...rest } = meta;
  void webcamData;
  const result: import('../src/shared/ipc.js').RecordingMeta = { ...rest, filePath, webcamFilePath, cursorFilePath };
  lastRecording = result;
  return result;
}

ipcMain.handle('recording:save', async (_evt, data: ArrayBuffer, meta: import('../src/shared/ipc.js').SaveRecordingMeta) => {
  const ts = new Date(meta.startedAt).toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(recordingsTempDir, `${ts}.webm`);
  fs.writeFileSync(filePath, Buffer.from(data));
  return writeRecordingSidecars(filePath, meta);
});

// Save path for the ffmpeg cursor-hidden capture: the screen webm already exists
// on disk (ffmpeg wrote it), so we skip the blob write and just attach sidecars.
ipcMain.handle('recording:saveFromFile', async (_evt, screenFilePath: string, meta: import('../src/shared/ipc.js').SaveRecordingMeta) => {
  return writeRecordingSidecars(screenFilePath, meta);
});

ipcMain.handle('editor:open', (_evt, recording) => {
  createEditor(recording);
});

ipcMain.handle('recording:meta', () => lastRecording);

// A project loaded via the HUD's "Open Project" button is parked here so the
// editor can pick it up on mount. Single-use — read once, then cleared.
let lastLoadedProject: { state: unknown; path: string; recording: import('../src/shared/ipc.js').RecordingMeta } | null = null;
ipcMain.handle('project:lastLoaded', () => {
  const p = lastLoadedProject;
  lastLoadedProject = null;
  return p;
});

ipcMain.handle('recording:fileUrl', (_evt, filePath: string) => {
  // Serve via the custom `media://` scheme so the editor (http origin in dev)
  // can load it. pathname keeps the absolute path; host stays empty.
  return `media://local${pathToFileURL(filePath).pathname}`;
});

ipcMain.handle('hud:minimize', () => hudWindow?.minimize());
ipcMain.handle('hud:close', () => hudWindow?.close());

// Resize the HUD window taller (or back to its compact size) so popover
// device menus opening above the pill have room without the window having to
// permanently sit there blocking desktop clicks. The pill is rendered at the
// bottom of its window via CSS, so we grow upward by shifting the window's Y
// up by the height delta — that way the pill's screen position never moves.
const HUD_COMPACT_HEIGHT = 56;
const HUD_EXPANDED_HEIGHT = 340;
ipcMain.handle('hud:setExpanded', (_evt, expanded: boolean) => {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  const target = expanded ? HUD_EXPANDED_HEIGHT : HUD_COMPACT_HEIGHT;
  const b = hudWindow.getBounds();
  if (b.height === target) return;
  const delta = target - b.height;
  hudWindow.setBounds({ x: b.x, y: b.y - delta, width: b.width, height: target });
});

let isRecording = false;

// ── Cursor tracking ─────────────────────────────────────────────────────────
// While recording we poll the global cursor position (~25Hz) and normalize it
// against the primary display's bounds. The samples are saved as a sidecar
// `.cursor.json` next to the recording so the editor's "Suggest Zooms" can
// auto-place zoom regions where the user was actually pointing. v1 assumes a
// full-screen recording of the primary display.
type CursorPt = { t: number; x: number; y: number };
let cursorSamples: CursorPt[] = [];
let cursorTimer: ReturnType<typeof setInterval> | null = null;
let cursorStart = 0;

// Whether the cursor path came from uiohook (raw PHYSICAL global pixels) or the
// getCursorScreenPoint fallback (LOGICAL global points). They live in different
// coordinate spaces, so recording:save normalizes each accordingly.
let cursorFromUio = false;

// When an ffmpeg screen capture is running, the video's t=0 is the instant
// ffmpeg started — which is BEFORE the renderer finishes opening the webcam and
// calls setRecordingState(true) to begin cursor tracking. Anchoring the cursor/
// click clock to that epoch (instead of "now") keeps clicks aligned with the
// frame that was on screen when they actually happened, instead of landing on
// an earlier frame. Null for the Chromium path (its clock already starts ~with
// the recorder, so "now" is correct there).
let captureVideoEpoch: number | null = null;

function startCursorTracking() {
  stopCursorTracking();
  cursorSamples = [];
  cursorStart = captureVideoEpoch ?? Date.now();
  cursorTracking = true;
  lastMoveT = 0;
  // Prefer uiohook for the cursor PATH (its coordinates match the captured
  // frame — the click ripples, which use it, track accurately). Only fall back
  // to polling getCursorScreenPoint when the global hook isn't available. Both
  // store RAW coords; normalization happens at save time.
  cursorFromUio = startUio();
  if (!cursorFromUio) {
    cursorTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      cursorSamples.push({ t: Date.now() - cursorStart, x: p.x, y: p.y });
    }, 40);
  }
}

function stopCursorTracking() {
  cursorTracking = false;
  if (cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }
}

// ── Click + cursor-path tracking via uiohook-napi ───────────────────────────
// A global mouse hook captures both the cursor PATH (mousemove, throttled) and
// CLICKS (mousedown) during recording, normalized against the recorded display
// and timestamped on the recording clock. uiohook-napi is an N-API addon so it
// loads in Electron without an ABI rebuild; if it's missing/fails, cursor
// tracking falls back to getCursorScreenPoint polling and clicks are simply
// absent — recording is never blocked.
type ClickPt = { t: number; x: number; y: number };
let clickSamples: ClickPt[] = [];
let clickTracking = false;
let cursorTracking = false;
let lastMoveT = 0;
let uioHook: { start: () => void; stop: () => void; on: (e: string, cb: (ev: { x: number; y: number }) => void) => void } | null = null;
let uioLoaded = false;
let uioRunning = false;

function ensureUio() {
  if (uioLoaded) return uioHook;
  uioLoaded = true;
  try {
    // require (not import) so the bundler leaves it external — the native .node
    // is resolved from node_modules at runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('uiohook-napi');
    uioHook = mod.uIOhook ?? mod.default?.uIOhook ?? null;
    // Store RAW pointer coordinates; they're normalized at save time against
    // the recorded video's ACTUAL pixel size (see recording:save) — which is
    // the ground truth, unlike Electron's scaleFactor (wrong on Wayland
    // fractional scaling).
    uioHook?.on('mousemove', (ev) => {
      if (!cursorTracking) return;
      const now = Date.now();
      if (now - lastMoveT < 33) return; // ~30 Hz
      lastMoveT = now;
      cursorSamples.push({ t: now - cursorStart, x: ev.x, y: ev.y });
    });
    uioHook?.on('mousedown', (ev) => {
      if (!clickTracking) return;
      clickSamples.push({ t: Date.now() - cursorStart, x: ev.x, y: ev.y });
    });
  } catch (err) {
    console.warn('[main] uiohook-napi unavailable; using cursor polling, no clicks', err);
    uioHook = null;
  }
  return uioHook;
}

// Ensure the global hook is loaded + running. Returns false if unavailable.
function startUio(): boolean {
  const h = ensureUio();
  if (h && !uioRunning) {
    try { h.start(); uioRunning = true; } catch (err) { console.warn('[main] uiohook start failed', err); uioHook = null; }
  }
  return !!uioHook;
}

function startClickTracking() {
  clickSamples = [];
  clickTracking = true;
  startUio();
}

function stopClickTracking() {
  clickTracking = false;
  // Stop the hook once neither cursor-path nor click tracking needs it.
  if (uioHook && uioRunning && !cursorTracking) {
    try { uioHook.stop(); uioRunning = false; } catch { /* ignore */ }
  }
}

// Cursor-hidden capture: the renderer sets the chosen desktopCapturer source id
// here, then calls getDisplayMedia({ video: { cursor: 'never' } }). The display-
// media request handler (registered at startup) resolves that call to this
// source without showing the OS picker. Lets the synthetic cursor replace the
// baked-in OS cursor. Falls back to the normal getUserMedia path on any failure.
let pendingCaptureSourceId: string | null = null;
// The display actually being recorded (resolved from the picked source's
// display_id). Cursor coordinates are normalized against THIS display, not the
// primary — otherwise recording a secondary monitor offsets the whole cursor
// path (Cap normalizes per recorded display for the same reason).
let recordedDisplay: Electron.Display | null = null;
ipcMain.handle('capture:setPendingSource', async (_evt, sourceId: string) => {
  pendingCaptureSourceId = sourceId;
  recordedDisplay = null;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const src = sources.find((s) => s.id === sourceId);
    if (src && src.display_id) {
      recordedDisplay = screen.getAllDisplays().find((d) => String(d.id) === String(src.display_id)) ?? null;
    }
    // Fall back to the display under the cursor for window sources (no display_id).
    if (!recordedDisplay) {
      recordedDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ?? null;
    }
  } catch {
    recordedDisplay = null;
  }
});

// ── Cursor-hidden screen capture via ffmpeg x11grab (Linux / X11) ────────────
// Chromium's getDisplayMedia({ cursor:'never' }) is IGNORED on X11 — the
// compositor always bakes the OS cursor into the captured frames — so the only
// reliable way to record WITHOUT the cursor (letting the editor's synthetic
// smooth cursor stand in with no double-cursor) is to grab the X display
// directly with `ffmpeg -f x11grab -draw_mouse 0`. This runs ONLY on Linux and
// ONLY when "Hide cursor" is on; every other case keeps the Chromium path.
// Audio (system monitor + mic) is captured via PulseAudio in the same process
// and muxed into the webm. If ffmpeg is missing or fails to start, ffcap:start
// returns { ok:false } and the renderer falls back to the normal capture.
let ffProc: ChildProcess | null = null;
let ffOutPath: string | null = null;
let ffStartedAt = 0;
let ffDims = { width: 1920, height: 1080 };

// Which cursor-hidden capture backend is live: the PipeWire/GStreamer helper
// (preferred — grabs COMPOSITED frames, so it stays fresh under load) or the
// legacy ffmpeg x11grab fallback (reads a stale root pixmap under a compositor).
let captureMode: 'pipewire' | 'x11grab' | null = null;
let pwProc: ChildProcess | null = null;      // python video helper (linux-capture.py)
let pwAudioProc: ChildProcess | null = null; // separate ffmpeg for the mic (see below)
let pwVideoPath: string | null = null;       // the .mkv the helper writes
let pwAudioPath: string | null = null;       // separate mic/audio .m4a, or null if audio is in the mkv

// Locate the PipeWire capture helper: alongside the source in dev, or in the
// packaged app's resources. Returns null when it isn't present (→ x11grab).
function helperScriptPath(): string | null {
  const candidates = [
    path.join(__dirname, '..', 'electron', 'linux-capture.py'),
    path.join(process.resourcesPath || '', 'linux-capture.py'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

// Environment for the GStreamer helper. If REFRAME_GST_PREFIX points at a lib
// dir that carries x264enc (e.g. a no-root local install of
// gstreamer1.0-plugins-ugly during dev), prepend it so the helper can find the
// H.264 encoder; otherwise the system GStreamer is used as-is.
function gstEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const prefix = process.env.REFRAME_GST_PREFIX;
  if (prefix) {
    const plug = path.join(prefix, 'gstreamer-1.0');
    env.GST_PLUGIN_PATH = env.GST_PLUGIN_PATH ? `${plug}:${env.GST_PLUGIN_PATH}` : plug;
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH ? `${prefix}:${env.LD_LIBRARY_PATH}` : prefix;
  }
  return env;
}

// Resolve the default PulseAudio sink monitor (system audio) + source (mic).
function pulseDefaults(): { monitor: string | null; source: string | null } {
  try {
    const info = execFileSync('pactl', ['info'], { encoding: 'utf8' });
    const sink = /Default Sink:\s*(.+)/.exec(info)?.[1]?.trim() || null;
    const source = /Default Source:\s*(.+)/.exec(info)?.[1]?.trim() || null;
    return { monitor: sink ? `${sink}.monitor` : null, source: source || null };
  } catch {
    return { monitor: null, source: null };
  }
}

// Prefer a bundled ffmpeg-static binary when present; otherwise system ffmpeg.
function ffmpegBin(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static');
    if (p && typeof p === 'string') return p;
  } catch {
    /* not installed — use system ffmpeg */
  }
  return 'ffmpeg';
}

// ffprobe alongside the ffmpeg binary (ffmpeg-static ships ffprobe-static
// separately, so fall back to a sibling 'ffprobe', then system 'ffprobe').
function ffprobeBin(): string {
  const ff = ffmpegBin();
  if (ff !== 'ffmpeg' && ff.includes(path.sep)) {
    const sibling = path.join(path.dirname(ff), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(sibling)) return sibling;
  }
  return 'ffprobe';
}

// Record the mic ALONE in a separate ffmpeg/PulseAudio process. A microphone is
// a distinct hardware capture clock: it deadlocks pipewiresrc if muxed into the
// same GStreamer pipeline, and mixing it with the system monitor as a second
// LIVE ffmpeg input is unreliable too (the monitor can starve amix). So the mic
// is captured on its own here and combined with the video (and system audio, if
// any) OFFLINE at finalize, where mixing is deterministic. Returns the AAC file
// path, or null on failure (recording continues without the mic).
function startSeparateMicAudio(ts: string, source: string): { proc: ChildProcess; path: string } | null {
  const outPath = path.join(recordingsTempDir, `${ts}-mic.m4a`);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'pulse', '-i', source, '-map', '0:a', '-c:a', 'aac', '-b:a', '128k', outPath,
  ];
  try {
    const proc = spawn(ffmpegBin(), args, { stdio: ['pipe', 'ignore', 'ignore'] });
    return { proc, path: outPath };
  } catch (err) {
    console.warn('[main] separate mic capture failed to start', err);
    return null;
  }
}

// Try the PipeWire/GStreamer helper for cursor-hidden capture. Spawns the helper
// (which negotiates a Mutter ScreenCast with the cursor hidden and encodes
// H.264+MP3 into Matroska), waiting for its "READY" line. On success the mic (if
// requested) is started as a separate process and { ok:true } is returned; on
// any failure everything is torn down and { ok:false } lets the caller fall back
// to x11grab.
async function tryStartPipewire(
  geom: { w: number; h: number; x: number; y: number },
  audio: { monitor: string | null; source: string | null; wantSys: boolean; wantMic: boolean },
  ts: string
): Promise<{ ok: boolean }> {
  const script = helperScriptPath();
  if (!script) return { ok: false };

  // The system monitor shares PipeWire's clock, so it always goes IN the gst
  // pipeline when requested (perfectly synced there). The mic, when on, is a
  // separate process and is mixed in offline at finalize.
  const monitorInGst = audio.wantSys ? audio.monitor : null;
  const videoPath = path.join(recordingsTempDir, `${ts}-screen.mkv`);
  const helperArgs = [
    script, String(geom.x), String(geom.y), String(geom.w), String(geom.h),
    '30', videoPath,
  ];
  if (monitorInGst) helperArgs.push(monitorInGst);

  let proc: ChildProcess;
  try {
    proc = spawn('python3', helperArgs, { env: gstEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.warn('[main] pipewire helper spawn threw', err);
    return { ok: false };
  }

  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (d) => { stdout += String(d); });
  proc.stderr?.on('data', (d) => { stderr += String(d); });

  const ready = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
    proc.stdout?.on('data', () => {
      if (/^READY/m.test(stdout)) done(true);
      else if (/^FAIL/m.test(stdout)) done(false);
    });
    proc.once('error', () => done(false));
    proc.once('exit', () => done(false)); // exited before READY = failure
    setTimeout(() => done(false), 8000);  // negotiation must finish well within this
  });

  if (!ready) {
    console.warn('[main] pipewire helper did not start:', stdout.trim(), stderr.trim());
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    try { fs.rmSync(videoPath, { force: true }); } catch { /* ignore */ }
    return { ok: false };
  }

  // Video is rolling. Anchor the cursor clock and, if requested, start the mic.
  captureMode = 'pipewire';
  pwProc = proc;
  pwVideoPath = videoPath;
  ffStartedAt = Date.now();
  captureVideoEpoch = ffStartedAt;
  ffDims = { width: geom.w, height: geom.h };
  pwAudioProc = null;
  pwAudioPath = null;
  if (audio.wantMic && audio.source) {
    const mic = startSeparateMicAudio(ts, audio.source);
    if (mic) { pwAudioProc = mic.proc; pwAudioPath = mic.path; }
  }
  // If the helper dies unexpectedly mid-recording, don't leave a dangling handle.
  proc.once('exit', (code) => {
    if (captureMode === 'pipewire' && pwProc === proc && code !== 0 && code !== null) {
      console.warn('[main] pipewire helper exited unexpectedly', code, stderr.trim());
    }
  });
  return { ok: true };
}

// Finalize a PipeWire capture (Matroska) into the editor-friendly faststart mp4.
// Video is always stream-copied (H.264). Audio has three shapes:
//   • system only  — already in the mkv, perfectly synced on the shared clock;
//                    just transcode MP3→AAC.
//   • mic only     — separate file, muxed in delayed by its later start.
//   • system + mic — the mkv's system track + the (delayed) mic file, mixed
//                    OFFLINE (deterministic, unlike live mixing).
// The mic starts slightly AFTER the video, so it's delayed by the shortfall
// (video length − mic length) to line up. Best-effort: returns a usable path.
function finalizePipewire(videoMkv: string, micFile: string | null): string {
  const outMp4 = videoMkv.replace(/\.mkv$/, '.mp4');
  try {
    const probe = (file: string, args: string[]): string =>
      execFileSync(ffprobeBin(), ['-v', 'error', ...args, file], { encoding: 'utf8' });
    const mkvHasAudio = /audio/.test(
      probe(videoMkv, ['-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'default=nw=1'])
    );
    const haveMic = !!micFile && fs.existsSync(micFile);

    // Mic's late-start delay = how much shorter it is than the video.
    let micDelayMs = 0;
    if (haveMic) {
      const vdur = parseFloat(probe(videoMkv, ['-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1']).trim());
      const aInfo = probe(micFile as string, ['-select_streams', 'a:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,sample_rate', '-of', 'default=nw=1']);
      const aFrames = parseFloat((/nb_read_frames=(\d+)/.exec(aInfo) || [])[1]);
      const aRate = parseFloat((/sample_rate=(\d+)/.exec(aInfo) || [])[1]);
      const adur = (aFrames * 1024) / aRate;
      micDelayMs = isFinite(vdur) && isFinite(adur) ? Math.max(0, Math.round((vdur - adur) * 1000)) : 0;
    }

    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoMkv];
    if (haveMic) args.push('-i', micFile as string);

    if (haveMic && mkvHasAudio) {
      // system (mkv 0:a) + mic (1:a, delayed) → single mixed track, offline.
      const delay = micDelayMs >= 250 ? `adelay=${micDelayMs}:all=1,` : '';
      args.push(
        '-filter_complex', `[1:a]${delay}aresample=async=1[m];[0:a][m]amix=inputs=2:duration=first[a]`,
        '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac'
      );
      console.log(`[main] finalize(pipewire): system+mic offline mix, mic delay ${micDelayMs}ms`);
    } else if (haveMic) {
      // mic only: mux it in, delayed to line up.
      if (micDelayMs >= 250) args.push('-af', `adelay=${micDelayMs}:all=1`);
      args.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac');
      console.log(`[main] finalize(pipewire): muxed mic, delay ${micDelayMs}ms`);
    } else {
      // system audio (if any) is already in sync; just remux.
      args.push('-c:v', 'copy');
      if (mkvHasAudio) args.push('-c:a', 'aac');
      console.log('[main] finalize(pipewire): faststart remux');
    }
    args.push('-movflags', '+faststart', outMp4);
    execFileSync(ffmpegBin(), args, { stdio: 'ignore' });

    fs.rmSync(videoMkv, { force: true });
    if (micFile) fs.rmSync(micFile, { force: true });
    return outMp4;
  } catch (err) {
    console.warn('[main] finalize(pipewire) failed; keeping raw mkv', err);
    return fs.existsSync(outMp4) ? outMp4 : videoMkv;
  }
}

// Finalize the raw capture into a clean, editor-friendly file. Two jobs:
//
//  1) SEEKABILITY. The capture is a FRAGMENTED mp4 (kill-safe during recording)
//     with dense keyframes. Re-muxing to a normal mp4 with '+faststart' writes a
//     complete moov index (keyframe table) at the FRONT, so the editor can jump
//     to any keyframe instantly — pro-editor-fast scrubbing. Video is stream-
//     COPIED (no re-encode), so this is quick.
//
//  2) AUDIO SYNC. PulseAudio starts capturing a couple seconds AFTER x11grab, so
//     ffmpeg labels the first (late) audio packet as PTS 0 — leaving the audio
//     shorter than the video and shifted EARLY. Delay the audio by exactly the
//     shortfall so it lines up (silence fills the lead-in).
//
// Best-effort: any failure (no ffprobe/ffmpeg, etc.) keeps the original file.
function finalizeRecording(filePath: string): string {
  try {
    // Step 1 — remux the FRAGMENTED capture to a normal, faststart mp4. This
    // gives a complete front-loaded seek index AND reliable per-stream durations
    // (ffprobe on a fragmented mp4 reports audio duration unreliably). Video is
    // stream-copied, so it's quick.
    const remuxed = filePath.replace(/\.mp4$/, '.f1.mp4');
    execFileSync(
      ffmpegBin(),
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-c', 'copy', '-movflags', '+faststart', remuxed],
      { stdio: 'ignore' }
    );

    // Step 2 — measure the PulseAudio late-start drift by DECODING, not by trusting
    // container metadata: a just-remuxed mp4 sometimes reports the audio stream's
    // `duration` as the container (video) length, which would hide the drift and
    // skip the fix (the bug that made this flaky). Video length = the container
    // duration (video is the longer track); audio length = actual decoded sample
    // count / rate — exact and immune to metadata quirks.
    const runProbe = (args: string[]): string =>
      execFileSync(ffprobeBin(), ['-v', 'error', ...args, remuxed], { encoding: 'utf8' });
    // Video length = container duration (video is the longer track). Audio length
    // = decoded AAC frame count × 1024 samples/frame ÷ rate — the stream `duration`
    // field over-reports (observed 5.11s vs a true 4.01s), which is what made the
    // fix flaky. `-count_frames` (not `-count_samples`, absent on ffprobe 4.x).
    const vdur = parseFloat(runProbe(['-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1']).trim());
    const aInfo = runProbe(['-select_streams', 'a:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,sample_rate', '-of', 'default=nw=1']);
    const aFrames = parseFloat((/nb_read_frames=(\d+)/.exec(aInfo) || [])[1]);
    const aRate = parseFloat((/sample_rate=(\d+)/.exec(aInfo) || [])[1]);
    const adur = (aFrames * 1024) / aRate; // AAC-LC = 1024 samples per frame
    const delayMs = isFinite(vdur) && isFinite(adur) ? Math.round((vdur - adur) * 1000) : 0;

    if (delayMs >= 250) {
      const synced = filePath.replace(/\.mp4$/, '.f2.mp4');
      execFileSync(
        ffmpegBin(),
        ['-y', '-hide_banner', '-loglevel', 'error', '-i', remuxed,
          '-af', `adelay=${delayMs}:all=1`, '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', synced],
        { stdio: 'ignore' }
      );
      fs.rmSync(remuxed, { force: true });
      fs.rmSync(filePath, { force: true });
      fs.renameSync(synced, filePath);
      console.log(`[main] finalize: faststart index + delayed audio ${delayMs}ms`);
    } else {
      fs.rmSync(filePath, { force: true });
      fs.renameSync(remuxed, filePath);
      console.log('[main] finalize: faststart index');
    }
    return filePath;
  } catch (err) {
    console.warn('[main] finalize (faststart/audio-sync) skipped', err);
    return filePath;
  }
}

ipcMain.handle('ffcap:start', async (_evt, opts: { withSystemAudio: boolean; withMic: boolean }) => {
  if (process.platform !== 'linux') return { ok: false, width: 0, height: 0 };
  try { ffProc?.kill('SIGKILL'); } catch { /* ignore */ }
  try { pwProc?.kill('SIGKILL'); } catch { /* ignore */ }
  try { pwAudioProc?.kill('SIGKILL'); } catch { /* ignore */ }
  ffProc = null;
  pwProc = null;
  pwAudioProc = null;
  captureMode = null;
  captureVideoEpoch = null;

  const disp = recordedDisplay ?? screen.getPrimaryDisplay();
  const scale = disp.scaleFactor || 1;
  const w = Math.round(disp.bounds.width * scale);
  const h = Math.round(disp.bounds.height * scale);
  const x = Math.round(disp.bounds.x * scale);
  const y = Math.round(disp.bounds.y * scale);
  ffDims = { width: w, height: h };
  const display = process.env.DISPLAY || ':0';

  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  const { monitor, source } = pulseDefaults();
  const wantSys = !!opts.withSystemAudio && !!monitor;
  const wantMic = !!opts.withMic && !!source;

  // Preferred path: PipeWire/GStreamer (composited frames → fresh under load,
  // cursor hidden at the source). Falls through to x11grab if unavailable.
  const pw = await tryStartPipewire(
    { w, h, x, y },
    { monitor, source, wantSys, wantMic },
    ts
  );
  if (pw.ok) return { ok: true, width: w, height: h };

  // Fallback path: ffmpeg x11grab.
  captureMode = 'x11grab';
  ffOutPath = path.join(recordingsTempDir, `${ts}-screen.mp4`);

  const args: string[] = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30',
    '-video_size', `${w}x${h}`, '-i', `${display}+${x},${y}`
  ];
  if (wantSys) args.push('-f', 'pulse', '-i', monitor as string);
  if (wantMic) args.push('-f', 'pulse', '-i', source as string);
  // Audio inputs follow the video (input 0) in push order.
  if (wantSys && wantMic) {
    args.push('-filter_complex', '[1:a][2:a]amix=inputs=2:duration=longest[a]', '-map', '0:v', '-map', '[a]');
  } else if (wantSys || wantMic) {
    args.push('-map', '0:v', '-map', '1:a');
  } else {
    args.push('-map', '0:v');
  }
  // Encode with libx264 (software H.264) at 'ultrafast'. This is the crux of the
  // capture-quality fix: libvpx/VP8 realtime tops out at ~15fps at 1080p and
  // COLLAPSES to ~1fps under real load (busy page + webcam + app), dropping the
  // vast majority of frames — the "recorder feels slow/laggy, misses fast UI
  // (typed text, popups)" bug. x264 ultrafast holds a rock-solid 30fps on the
  // same content. H.264/MP4 decodes fine in the editor's <video> + mediabunny
  // (Electron ships proprietary codecs; the media:// handler sets video/mp4),
  // and a FRAGMENTED mp4 stays playable even if ffmpeg is force-killed on stop
  // (no trailing moov atom needed). No HW encoder here (no CUDA/VAAPI profile).
  args.push(
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
    // Keyframe every ~0.5s (15 frames @30fps). Dense keyframes = near-instant
    // editor scrubbing/seeking (a seek only decodes up to half a second of
    // frames), the way pro editors feel. keyint_min=1 lets a keyframe land
    // exactly on the interval. Small file-size cost, re-encoded away on export.
    '-g', '15', '-keyint_min', '15',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof'
  );
  if (wantSys || wantMic) args.push('-c:a', 'aac', '-b:a', '128k');
  args.push(ffOutPath);

  try {
    const proc = spawn(ffmpegBin(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
    ffProc = proc;
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += String(d); });
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      proc.once('spawn', () => { settled = true; ffStartedAt = Date.now(); captureVideoEpoch = ffStartedAt; resolve(true); });
      proc.once('error', (err) => {
        if (!settled) { settled = true; console.warn('[main] ffmpeg spawn error', err); resolve(false); }
      });
      // An exit within the first moment means capture failed (bad device/args).
      proc.once('exit', (code) => {
        if (!settled) { settled = true; console.warn('[main] ffmpeg exited early', code, stderr); resolve(false); }
      });
      setTimeout(() => { if (!settled) { settled = true; resolve(true); } }, 700);
    });
    if (!ok) { ffProc = null; ffOutPath = null; captureMode = null; captureVideoEpoch = null; return { ok: false, width: 0, height: 0 }; }
    return { ok: true, width: w, height: h };
  } catch (err) {
    console.warn('[main] ffmpeg capture failed to start', err);
    ffProc = null;
    ffOutPath = null;
    captureMode = null;
    return { ok: false, width: 0, height: 0 };
  }
});

ipcMain.handle('ffcap:stop', async () => {
  const durationMs = Date.now() - ffStartedAt;

  // ── PipeWire path ──────────────────────────────────────────────────────────
  if (captureMode === 'pipewire' && pwProc && pwVideoPath) {
    const vproc = pwProc;
    const aproc = pwAudioProc;
    const videoPath = pwVideoPath;
    const audioPath = pwAudioPath;
    pwProc = null;
    pwAudioProc = null;
    pwVideoPath = null;
    pwAudioPath = null;
    captureMode = null;
    captureVideoEpoch = null;

    // Stop the separate mic ffmpeg (graceful 'q' → SIGINT) and the video helper
    // (SIGTERM → it injects EOS into every source and finalizes the Matroska).
    await Promise.all([
      new Promise<void>((resolve) => {
        if (!aproc) return resolve();
        let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
        aproc.once('exit', finish);
        try { aproc.stdin?.write('q'); } catch { /* ignore */ }
        setTimeout(() => { try { aproc.kill('SIGINT'); } catch { /* ignore */ } }, 300);
        setTimeout(finish, 5000);
      }),
      new Promise<void>((resolve) => {
        let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
        vproc.once('exit', finish);
        try { vproc.kill('SIGTERM'); } catch { /* ignore */ }
        setTimeout(() => { try { vproc.kill('SIGKILL'); } catch { /* ignore */ } }, 6000);
        setTimeout(finish, 6500);
      }),
    ]);

    const out = finalizePipewire(videoPath, audioPath);
    return { filePath: out, width: ffDims.width, height: ffDims.height, durationMs };
  }

  // ── x11grab fallback path ──────────────────────────────────────────────────
  const proc = ffProc;
  ffProc = null;
  if (!proc || !ffOutPath) { captureMode = null; return null; }
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    proc.once('exit', finish);
    // Ask ffmpeg to finalize gracefully (flush the index) via stdin 'q';
    // then SIGINT, then a hard timeout, so stop() can never hang the HUD.
    try { proc.stdin?.write('q'); } catch { /* ignore */ }
    setTimeout(() => { try { proc.kill('SIGINT'); } catch { /* ignore */ } }, 400);
    setTimeout(finish, 4000);
  });
  const out = ffOutPath;
  ffOutPath = null;
  captureMode = null;
  // Clear the video epoch so a following Chromium recording anchors its cursor
  // clock to "now" rather than this (now-stale) ffmpeg start.
  captureVideoEpoch = null;
  // Finalize: front-load the seek index (faststart) + correct PulseAudio drift.
  finalizeRecording(out);
  return { filePath: out, width: ffDims.width, height: ffDims.height, durationMs };
});

ipcMain.handle('hud:setRecording', (_evt, recording: boolean) => {
  isRecording = !!recording;
  if (isRecording) { startCursorTracking(); startClickTracking(); }
  else { stopCursorTracking(); stopClickTracking(); }
  if (hudWindow) {
    // Keep setContentProtection on — excludes the HUD from screen capture on
    // macOS/Windows. On Linux it's a no-op (the HUD will be visible in the
    // recording); the user accepts that trade-off so they can still see/stop
    // recording from the HUD pill.
    hudWindow.setContentProtection(true);
  }
  updateTrayMenu();
});

ipcMain.handle('cursor:load', async (_evt, filePath: string) => {
  try {
    const resolved = path.resolve(filePath);
    if (!recordingsTempDir || !resolved.startsWith(recordingsTempDir + path.sep)) return null;
    const raw = await fs.promises.readFile(resolved, 'utf-8');
    const data = JSON.parse(raw);
    // Legacy sidecars are a bare CursorSample[]; current ones are
    // { samples, clicks }. Normalize to { samples, clicks }.
    if (Array.isArray(data)) return { samples: data, clicks: [] };
    if (data && Array.isArray(data.samples)) {
      return { samples: data.samples, clicks: Array.isArray(data.clicks) ? data.clicks : [] };
    }
    return null;
  } catch {
    return null;
  }
});

// Generate a unique on-disk path for a brand-new auto-saved project. Called
// by the editor the moment a recording loads, so a project file exists from
// the very first state change. The name is based on the recording's
// startedAt timestamp so it's stable across the session.
ipcMain.handle('project:initialPath', (_evt, startedAt: number) => {
  const ts = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  return path.join(projectsDir, `Untitled-${ts}.reframe.json`);
});

// Silent auto-save (no dialog) to a previously-known path. The editor calls
// this on every state change, debounced.
ipcMain.handle('project:autoSave', async (_evt, filePath: string, project) => {
  try {
    // Safety: only write inside our projects dir.
    const resolved = path.resolve(filePath);
    if (!projectsDir || !resolved.startsWith(projectsDir + path.sep)) {
      return { saved: false };
    }
    await fs.promises.writeFile(resolved, JSON.stringify(project, null, 2));
    return { saved: true, path: resolved };
  } catch (err) {
    console.error('[main] project:autoSave failed', err);
    return { saved: false };
  }
});

ipcMain.handle('project:save', async (evt, project) => {
  const win = BrowserWindow.fromWebContents(evt.sender) ?? editorWindow ?? undefined;
  const res = await dialog.showSaveDialog(win!, {
    title: 'Save Project As',
    defaultPath: path.join(projectsDir, 'Untitled.reframe.json'),
    filters: [{ name: 'Reframe Project', extensions: ['reframe.json', 'json'] }]
  });
  if (res.canceled || !res.filePath) return { saved: false };
  fs.writeFileSync(res.filePath, JSON.stringify(project, null, 2));
  return { saved: true, path: res.filePath };
});

ipcMain.handle('project:load', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender) ?? editorWindow ?? undefined;
  const res = await dialog.showOpenDialog(win!, {
    title: 'Open Project',
    defaultPath: projectsDir,
    filters: [{ name: 'Reframe Project', extensions: ['reframe.json', 'json'] }],
    properties: ['openFile']
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const raw = fs.readFileSync(res.filePaths[0], 'utf-8');
  try {
    const project = JSON.parse(raw);
    return { ...project, _path: res.filePaths[0] };
  } catch {
    return null;
  }
});

// Triggered from the HUD's "Open Project" button — picks a .reframe.json,
// loads its content, and routes it to the editor (creating one if needed).
// The editor reads the parked payload on mount, or via the project:opened
// push event if it's already alive.
ipcMain.handle('project:openFromPicker', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender) ?? hudWindow ?? undefined;
  const res = await dialog.showOpenDialog(win!, {
    title: 'Open Project',
    defaultPath: projectsDir,
    filters: [{ name: 'Reframe Project', extensions: ['reframe.json', 'json'] }],
    properties: ['openFile']
  });
  if (res.canceled || res.filePaths.length === 0) return { opened: false };
  const filePath = res.filePaths[0];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const project = JSON.parse(raw);
    if (!project?.recording) return { opened: false };
    lastRecording = project.recording;
    lastLoadedProject = { state: project.state, path: filePath, recording: project.recording };
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.focus();
      editorWindow.webContents.send('project:opened', lastLoadedProject);
      // Consumed by the live editor — clear so a subsequent mount doesn't re-hydrate.
      lastLoadedProject = null;
    } else {
      createEditor(project.recording);
    }
    return { opened: true, path: filePath };
  } catch (err) {
    console.error('[main] project:openFromPicker failed', err);
    return { opened: false };
  }
});

// Rename a .reframe.json on disk (used by the editor's inline-rename UI).
// Only basename — file stays in projectsDir, .reframe.json suffix is fixed.
ipcMain.handle('project:rename', async (_evt, oldPath: string, newName: string) => {
  try {
    const resolved = path.resolve(oldPath);
    if (!projectsDir || !resolved.startsWith(projectsDir + path.sep)) {
      return { ok: false, error: 'Path outside projects folder' };
    }
    // Sanitize the new name: strip our extension if the user retyped it, then
    // replace anything that isn't safe-for-filename with underscores.
    let base = newName.trim().replace(/\.reframe\.json$/i, '');
    base = base.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 100);
    if (!base) return { ok: false, error: 'Empty name' };
    const newPath = path.join(projectsDir, `${base}.reframe.json`);
    if (newPath === resolved) return { ok: true, path: resolved };
    if (fs.existsSync(newPath)) {
      return { ok: false, error: 'A project with that name already exists' };
    }
    await fs.promises.rename(resolved, newPath);
    return { ok: true, path: newPath };
  } catch (err) {
    console.error('[main] project:rename failed', err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('exports:openFolder', () => shell.openPath(exportsDir));

ipcMain.handle('image:pick', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender) ?? editorWindow ?? undefined;
  const res = await dialog.showOpenDialog(win!, {
    title: 'Choose Background Image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    properties: ['openFile']
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const filePath = res.filePaths[0];
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    ext === 'gif' ? 'image/gif' :
    ext === 'webp' ? 'image/webp' :
    'image/png';
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, name: path.basename(filePath) };
});

ipcMain.handle('external:open', (_evt, url: string) => {
  if (typeof url !== 'string') return;
  // Only allow http(s) and mailto.
  if (!/^(https?:|mailto:)/i.test(url)) return;
  return shell.openExternal(url);
});

ipcMain.handle('export:save', async (evt, req: { defaultName: string; data: ArrayBuffer; format: 'mp4' | 'gif' | 'webm' }) => {
  const win = BrowserWindow.fromWebContents(evt.sender) ?? editorWindow ?? undefined;
  const ext = req.format;
  const safeName = req.defaultName.replace(/[^a-z0-9._-]+/gi, '-') + '.' + ext;
  const res = await dialog.showSaveDialog(win!, {
    title: 'Export Video',
    defaultPath: path.join(exportsDir, safeName),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  if (res.canceled || !res.filePath) return { saved: false };
  fs.writeFileSync(res.filePath, Buffer.from(req.data));
  return { saved: true, path: res.filePath };
});

app.whenReady().then(async () => {
  console.log('[main] electron ready, creating HUD');

  // Resolve the three on-disk locations (see comments at the top of the file).
  recordingsTempDir = path.join(app.getPath('userData'), 'recordings');
  const reframeUserDir = path.join(app.getPath('videos'), 'Reframe');
  projectsDir = path.join(reframeUserDir, 'Projects');
  exportsDir = path.join(reframeUserDir, 'Recordings');
  fs.mkdirSync(recordingsTempDir, { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.mkdirSync(exportsDir, { recursive: true });
  console.log('[main] paths:', { recordingsTempDir, projectsDir, exportsDir });

  // Drop the default OS menubar (File/Edit/View/Window/Help). The editor's
  // top toolbar already exposes File/Edit/View — keeping both produced a
  // duplicate-looking header.
  Menu.setApplicationMenu(null);

  // Resolve getDisplayMedia (used only for cursor-hidden capture) to the source
  // the renderer pre-selected, bypassing the OS picker. If we can't match it,
  // deny so the renderer falls back to the normal getUserMedia path.
  try {
    session.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen', 'window'] })
          .then((sources) => {
            const src = sources.find((s) => s.id === pendingCaptureSourceId) ?? null;
            callback(src ? { video: src } : {});
          })
          .catch(() => callback({}));
      },
      { useSystemPicker: false }
    );
  } catch (err) {
    console.warn('[main] setDisplayMediaRequestHandler unavailable', err);
  }

  const mediaMime = (p: string): string => {
    const ext = path.extname(p).toLowerCase();
    if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
    if (ext === '.mov') return 'video/quicktime';
    return 'video/webm';
  };
  protocol.handle('media', async (req) => {
    const url = new URL(req.url);
    const filePath = decodeURIComponent(url.pathname);
    // Only allow paths under the temp recordings dir.
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(recordingsTempDir + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const stat = await fs.promises.stat(resolved);
      const total = stat.size;

      // HTTP Range support is mandatory for <video> playback. The media stack
      // reads the header, then range-requests the rest as it buffers/seeks.
      // Without 206 responses the element desyncs its byte offsets and bails
      // out a fraction of a second in (currentTime snaps to duration) — which
      // is exactly what broke export.
      const rangeHeader = req.headers.get('Range');
      const rangeMatch = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;

      if (rangeMatch) {
        let start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
        let end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : total - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (start > end || start >= total) {
          return new Response('range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` }
          });
        }
        const stream = fs.createReadStream(resolved, { start, end });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': mediaMime(resolved),
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes'
          }
        });
      }

      const stream = fs.createReadStream(resolved);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': mediaMime(resolved),
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes'
        }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  // Orphan recording sweep — walk every saved .reframe.json, collect the
  // recording filePaths it references, and delete anything in
  // recordingsTempDir that isn't referenced. Handles two failure modes:
  // (a) crash during a recording session (project file never got auto-saved),
  // (b) user manually deleted a project from their file manager.
  await sweepOrphanRecordings();

  // Convenience global stop shortcut — works from any focused window.
  globalShortcut.register('CommandOrControl+Shift+0', () => {
    if (!isRecording) return;
    hudWindow?.webContents.send('hud:stop-shortcut');
  });

  createHud();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createHud();
  });
});

async function sweepOrphanRecordings() {
  try {
    const projectFiles = (await fs.promises.readdir(projectsDir))
      .filter((f) => f.endsWith('.reframe.json'));
    const referenced = new Set<string>();
    for (const pf of projectFiles) {
      try {
        const raw = await fs.promises.readFile(path.join(projectsDir, pf), 'utf-8');
        const parsed = JSON.parse(raw);
        const rec = parsed?.recording as { filePath?: string; webcamFilePath?: string; cursorFilePath?: string } | undefined;
        if (rec?.filePath) referenced.add(path.resolve(rec.filePath));
        if (rec?.webcamFilePath) referenced.add(path.resolve(rec.webcamFilePath));
        if (rec?.cursorFilePath) referenced.add(path.resolve(rec.cursorFilePath));
      } catch {
        // Malformed project file — ignore, don't crash startup.
      }
    }
    const tempFiles = await fs.promises.readdir(recordingsTempDir);
    let deleted = 0;
    for (const tf of tempFiles) {
      const full = path.resolve(recordingsTempDir, tf);
      if (referenced.has(full)) continue;
      try {
        await fs.promises.rm(full, { force: true });
        deleted++;
      } catch {
        // Best-effort — leave it for next sweep.
      }
    }
    if (deleted > 0) console.log(`[main] orphan sweep: removed ${deleted} unreferenced temp recording(s)`);
  } catch (err) {
    console.warn('[main] orphan sweep failed', err);
  }
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
