import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, desktopCapturer, screen, shell, protocol, dialog, globalShortcut, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkForUpdates } from './updater';

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
// Best parent window for a modal dialog (e.g. the updater's prompts): whatever's
// focused, else the HUD, else the editor.
const currentWindow = (): BrowserWindow | null =>
  BrowserWindow.getFocusedWindow() ?? hudWindow ?? editorWindow;
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
//                       Linux PipeWire path and from Chromium where it encodes
//                       H.264, .webm from Chromium's VP8). Lives
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

// Is `target` inside `dir`? Used to fence the media:// handler and the cursor
// sidecar loader to the recordings dir. Windows compares paths
// case-insensitively, so fold case there — otherwise a drive letter or user
// folder that differs only in case reads as an escape attempt.
function isInsideDir(dir: string, target: string): boolean {
  if (!dir) return false;
  const prefix = path.resolve(dir) + path.sep;
  return process.platform === 'win32'
    ? target.toLowerCase().startsWith(prefix.toLowerCase())
    : target.startsWith(prefix);
}

function loadHtml(win: BrowserWindow, htmlName: string) {
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}${htmlName}`);
  } else {
    win.loadFile(path.join(RENDERER_DIST, htmlName));
  }
}

// HUD geometry. The window is only ever as big as the pill inside it — the
// renderer measures the pill and reports it via `hud:setContentSize` (see
// HudApp), because the pill's width is not fixed: it changes with the source
// label and grows when recording starts, where the stop + restart buttons and
// the timer replace the single record button. The window used to be a hard
// 620×56, so the recording layout overflowed it and Chromium drew scrollbars
// across the HUD. These are just the pre-measurement defaults.
const HUD_DEFAULT_WIDTH = 620;
const HUD_DEFAULT_HEIGHT = 56;
const HUD_MIN_WIDTH = 240;
// Extra height reserved above the pill while a device popover is open (its
// max-h-64 list plus header/padding).
const HUD_MENU_HEIGHT = 288;
let hudContentWidth = HUD_DEFAULT_WIDTH;
let hudContentHeight = HUD_DEFAULT_HEIGHT;
let hudExpanded = false;

// Resize the HUD to the measured pill (plus popover room when a device menu is
// open). The pill is rendered at the bottom-centre of its window, so we pin the
// window's BOTTOM edge and grow symmetrically around its centre — that way the
// pill never slides out from under the pointer when the layout changes.
function applyHudBounds() {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  const b = hudWindow.getBounds();
  const { workArea } = screen.getDisplayMatching(b);
  const width = Math.min(Math.max(hudContentWidth, HUD_MIN_WIDTH), workArea.width);
  const height = Math.min(hudContentHeight + (hudExpanded ? HUD_MENU_HEIGHT : 0), workArea.height);
  if (b.width === width && b.height === height) return;

  const centerX = b.x + b.width / 2;
  const bottom = b.y + b.height;
  const x = Math.round(
    Math.min(Math.max(centerX - width / 2, workArea.x), workArea.x + workArea.width - width)
  );
  const y = Math.round(
    Math.min(Math.max(bottom - height, workArea.y), workArea.y + workArea.height - height)
  );
  hudWindow.setBounds({ x, y, width, height });
}

function createHud() {
  // Park the pill at the bottom-center of the primary display's work area
  // (so it sits just above the taskbar/dock, not on top of it). Same approach
  // openscreen uses — much more discoverable than the default OS-centered
  // placement where the HUD lands in the middle of the screen.
  const { workArea } = screen.getPrimaryDisplay();
  const windowWidth = HUD_DEFAULT_WIDTH;
  const windowHeight = HUD_DEFAULT_HEIGHT;
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
    hudContentWidth = HUD_DEFAULT_WIDTH;
    hudContentHeight = HUD_DEFAULT_HEIGHT;
    hudExpanded = false;
    if (!editorWindow) app.quit();
  });
}

function createPicker() {
  if (pickerWindow) {
    pickerWindow.focus();
    return;
  }
  // Centre the picker on the work area of whichever display the HUD is on.
  // Without explicit coordinates Electron places the child relative to its
  // parent, and on Windows that puts the picker's top-left AT the HUD's
  // top-left — the HUD lives at the bottom of the screen, so most of the
  // picker hung off the bottom edge, and being frameless it had no title bar
  // to drag it back with. (The picker's header is a drag region now too.)
  const { workArea } = hudWindow && !hudWindow.isDestroyed()
    ? screen.getDisplayMatching(hudWindow.getBounds())
    : screen.getPrimaryDisplay();
  const width = Math.min(760, Math.max(320, workArea.width - 40));
  const height = Math.min(540, Math.max(320, workArea.height - 40));
  const x = Math.round(workArea.x + Math.max(0, (workArea.width - width) / 2));
  const y = Math.round(workArea.y + Math.max(0, (workArea.height - height) / 2));

  pickerWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
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
        { label: 'Check for Updates…', click: () => checkForUpdates(currentWindow, true) },
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
    // The app icon for each window (Chrome's, VS Code's, ours…). The picker
    // shows it beside the title so a window is recognisable at a glance
    // instead of by reading text. Ignored for screens, and not every window
    // manager supplies one — the picker falls back to a generic glyph.
    fetchWindowIcons: true
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: s.thumbnail.toDataURL(),
    // appIcon is a NativeImage or null; keep it small — it renders at 16px.
    appIconDataUrl: s.appIcon && !s.appIcon.isEmpty()
      ? s.appIcon.resize({ width: 32, height: 32 }).toDataURL()
      : undefined
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

// Container extension for a MediaRecorder mimeType. The renderer encodes H.264
// /MP4 where the OS has a hardware encoder and VP8/WebM otherwise, so the
// extension has to follow what was actually encoded: media:// picks the MIME it
// serves from the extension, and a mismatch makes <video> reject the file.
function extForMime(mime: string | undefined): string {
  return mime && mime.includes('mp4') ? 'mp4' : 'webm';
}

// Shared tail of the save flow: given a finalized on-disk screen recording
// (whether written from a renderer MediaRecorder blob or produced by the
// PipeWire helper), attach the optional webcam clip + cursor/click sidecar and
// return the RecordingMeta.
function writeRecordingSidecars(
  filePath: string,
  meta: import('../src/shared/ipc.js').SaveRecordingMeta
): import('../src/shared/ipc.js').RecordingMeta {
  const ts = new Date(meta.startedAt).toISOString().replace(/[:.]/g, '-');
  let webcamFilePath: string | undefined;
  if (meta.webcamData) {
    webcamFilePath = path.join(recordingsTempDir, `${ts}-webcam.${extForMime(meta.webcamMimeType)}`);
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
        // A single window was recorded: the frame IS the window, so fractions
        // must be relative to the window, not the display. Getting this wrong
        // doesn't just offset the synthetic cursor — the 0..1 filter below
        // would discard most samples and the cursor would vanish.
        if (recordedWindowSize && recordedWindowOrigins.length > 0) {
          const { w: rw, h: rh } = recordedWindowSize;
          // `k` converts a cursor sample into the space the helper reports the
          // window rect in. That space differs by platform:
          //   Linux  — the helper reports X11 PHYSICAL pixels. uiohook reports
          //            physical pixels too (k=1); getCursorScreenPoint is
          //            logical and has to be scaled up.
          //   macOS  — the helper reports POINTS (kCGWindowBounds), and BOTH
          //            cursor sources are already in points (CGEventGetLocation
          //            and getCursorScreenPoint), so nothing needs scaling.
          const k = process.platform === 'darwin'
            ? 1
            : (cursorFromUio ? 1 : (disp.scaleFactor || 1));
          // Origins arrive in order; walk both series together instead of
          // searching per sample.
          let oi = 0;
          return arr
            .map((p) => {
              // p.t is relative to cursorStart, and origins are wall-clock.
              const wall = cursorStart + p.t;
              while (oi + 1 < recordedWindowOrigins.length
                     && recordedWindowOrigins[oi + 1].t <= wall) oi++;
              const o = recordedWindowOrigins[oi];
              return { t: p.t, x: (p.x * k - o.x) / rw, y: (p.y * k - o.y) / rh };
            })
            .filter((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
        }
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
      // Cursor kinds share the sample clock: both are stamped with wall time,
      // so subtracting cursorStart puts them on the same timeline the editor
      // scrubs. Runs shorter than a frame are dropped — they can only have come
      // from a transient the viewer never saw.
      const kinds = cursorKinds
        .map((p) => ({ t: p.t - cursorStart, k: p.k }))
        .filter((p) => p.t >= -500)
        .map((p) => ({ t: Math.max(0, p.t), k: p.k }))
        .filter((p, i, a) => i === 0 || p.k !== a[i - 1].k);
      fs.writeFileSync(cursorFilePath, JSON.stringify({
        samples: norm(cursorSamples), clicks: norm(clickSamples),
        ...(kinds.length > 0 ? { kinds } : {})
      }));
    } catch (err) {
      console.warn('[main] failed to write cursor sidecar', err);
      cursorFilePath = undefined;
    }
  }
  cursorSamples = [];
  cursorKinds = [];
  clickSamples = [];
  const { webcamData, ...rest } = meta;
  void webcamData;
  const result: import('../src/shared/ipc.js').RecordingMeta = { ...rest, filePath, webcamFilePath, cursorFilePath };
  lastRecording = result;
  return result;
}

ipcMain.handle('recording:save', async (_evt, data: ArrayBuffer, meta: import('../src/shared/ipc.js').SaveRecordingMeta) => {
  const ts = new Date(meta.startedAt).toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(recordingsTempDir, `${ts}.${extForMime(meta.mimeType)}`);
  fs.writeFileSync(filePath, Buffer.from(data));
  return writeRecordingSidecars(filePath, meta);
});

// Save path for the cursor-hidden capture: the screen file already exists on
// disk (the PipeWire helper wrote it), so skip the blob write and just attach
// sidecars.
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

// The renderer's ResizeObserver reports the pill's measured size (already in
// DIPs — the HUD page runs at zoom 1, so a CSS pixel is a DIP). Everything
// about how that becomes window bounds lives in applyHudBounds.
ipcMain.handle('hud:setContentSize', (_evt, width: number, height: number) => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  hudContentWidth = Math.ceil(width);
  hudContentHeight = Math.ceil(height);
  applyHudBounds();
});

// Grow the HUD window taller (or back to its compact size) so popover device
// menus opening above the pill have room, without the window having to
// permanently sit there blocking desktop clicks.
ipcMain.handle('hud:setExpanded', (_evt, expanded: boolean) => {
  hudExpanded = !!expanded;
  applyHudBounds();
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

// ── cursor KIND (arrow / text / pointer …) ─────────────────────────────────
// Sampled by a small per-platform helper for the duration of the recording, so
// the editor can swap its synthetic pointer the way the real one changed. The
// helper prints "<epoch_ms> <kind>" on every change; we keep the timeline and
// write it into the cursor sidecar. Entirely optional: no helper, an
// unsupported session (Wayland), or a helper that fails simply means no kinds,
// and the editor keeps whatever fixed style the user picked.
type CursorKindPt = { t: number; k: string };
let cursorKinds: CursorKindPt[] = [];
let cursorKindProc: ChildProcess | null = null;
let cursorKindTail = '';

function startCursorKindTracking() {
  stopCursorKindTracking();
  cursorKinds = [];
  cursorKindTail = '';
  const helper = cursorKindHelper();
  if (!helper) return;
  try {
    cursorKindProc = spawn(helper.bin, helper.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.warn('[main] cursor-kind helper spawn failed', err);
    cursorKindProc = null;
    return;
  }
  cursorKindProc.stdout?.on('data', (d) => {
    cursorKindTail += String(d);
    const lines = cursorKindTail.split('\n');
    cursorKindTail = lines.pop() ?? '';
    for (const line of lines) {
      const m = /^(\d+)\s+([a-z-]+)$/.exec(line.trim());
      if (m) cursorKinds.push({ t: Number(m[1]), k: m[2] });
    }
  });
  cursorKindProc.once('error', () => { cursorKindProc = null; });
}

function stopCursorKindTracking() {
  const p = cursorKindProc;
  cursorKindProc = null;
  if (!p) return;
  try { p.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } }, 1500);
}

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
// The window the user picked, when they picked a window rather than a screen.
// `handle` is the OS window id parsed out of Electron's source id
// ("window:<handle>:<n>"): a CGWindowID on macOS, an HWND on Windows, an X11
// XID on Linux. Null whenever a screen was chosen.
let pendingWindow: { handle: string; name: string } | null = null;

// When a single WINDOW was captured: its size in physical pixels, plus where it
// sat on screen over time. The cursor sidecar is normalized against the window
// rather than the display — the video IS the window, so display-relative
// fractions would put the editor's synthetic cursor in the wrong place.
//
// The origin is a timeline, not a constant, because the user can drag the window
// mid-recording. That doesn't disturb the capture (ximagesrc reads the window's
// own drawable, not a screen region), but every cursor sample after the drag has
// to be measured against where the window was AT THAT MOMENT. The helper emits
// "ORIGIN <wall-ms> <x>,<y>" at start and on every move; both series are stamped
// with the same wall clock, so they line up without any handshake.
// Null / empty for screen recordings.
let recordedWindowSize: { w: number; h: number } | null = null;
let recordedWindowOrigins: { t: number; x: number; y: number }[] = [];
// Carries the tail of a partial stdout chunk so an ORIGIN line split across two
// reads still parses.
let helperStdoutTail = '';

// Consume "ORIGIN <wall-ms> <x>,<y> [<w>x<h>]" lines from a capture helper's
// stdout. Both the Linux and macOS helpers speak this, so the window-relative
// cursor mapping is written once.
//
// The trailing size is present on macOS, where the helper reports POINTS while
// the video is in PIXELS, so the two can't be derived from each other. Linux
// omits it: there the helper's space IS the video's space (X11 physical px), so
// the captured size already is the window's extent.
function consumeHelperOrigins(chunk: string) {
  helperStdoutTail += chunk;
  const lines = helperStdoutTail.split('\n');
  helperStdoutTail = lines.pop() ?? '';
  for (const line of lines) {
    const m = /^ORIGIN (\d+) (-?\d+),(-?\d+)(?: (\d+)x(\d+))?$/.exec(line.trim());
    if (!m) continue;
    recordedWindowOrigins.push({ t: Number(m[1]), x: Number(m[2]), y: Number(m[3]) });
    if (m[4]) recordedWindowSize = { w: Number(m[4]), h: Number(m[5]) };
  }
}

ipcMain.handle('capture:setPendingSource', async (_evt, sourceId: string) => {
  pendingCaptureSourceId = sourceId;
  recordedDisplay = null;
  pendingWindow = null;
  recordedWindowSize = null;
  recordedWindowOrigins = [];
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const src = sources.find((s) => s.id === sourceId);
    if (src && sourceId.startsWith('window:')) {
      const handle = sourceId.split(':')[1] ?? '';
      if (handle) pendingWindow = { handle, name: src.name };
    }
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

// ── Cursor-hidden screen capture via PipeWire ScreenCast (Linux) ─────────────
// Chromium's getDisplayMedia({ cursor:'never' }) is IGNORED on X11 — the
// compositor bakes the OS cursor into the frames — so recording WITHOUT the
// cursor (letting the editor's synthetic smooth cursor stand in, with no
// double-cursor) needs a capture API that hides it at the source. That's a
// PipeWire ScreenCast, negotiated by the linux-capture.py helper, which also
// yields COMPOSITED frames: they stay fresh under load, unlike x11grab's stale
// root pixmap.
//
// Runs ONLY on Linux and ONLY when "Hide cursor" is on. If the helper can't
// start (no PipeWire, no GStreamer H.264 encoder, user denied the portal), we
// return { ok:false } and the renderer falls back to its normal Chromium
// capture — which shows the cursor, but never blocks a recording.
let ffStartedAt = 0;
let ffDims = { width: 1920, height: 1080 };
let pwProc: ChildProcess | null = null;      // python video helper (linux-capture.py)
let pwAudioProc: ChildProcess | null = null; // separate ffmpeg for the mic (see below)
let pwVideoPath: string | null = null;       // the .mkv the helper writes
let pwAudioPath: string | null = null;       // separate mic/audio .m4a, or null if audio is in the mkv

// Where the portal's restore_token lives. The XDG portal shows a source picker;
// handing back the token it issued lets every later recording skip that dialog.
function restoreTokenPath(): string {
  return path.join(app.getPath('userData'), 'screencast-restore-token');
}

// Locate the PipeWire capture helper: alongside the source in dev, or in the
// packaged app's resources. Returns null when it isn't present.
// The cursor-KIND helper for this platform, or null if we don't ship one.
// Same lookup shape as helperScriptPath: dev tree first, then the packaged
// resources dir.
function cursorKindHelper(): { bin: string; args: string[] } | null {
  const file =
    process.platform === 'linux' ? 'cursor-kind.py' :
    process.platform === 'win32' ? 'cursor-kind.ps1' :
    process.platform === 'darwin' ? 'cursor-kind' : null;
  if (!file) return null;
  const candidates = [
    path.join(__dirname, '..', 'electron', file),
    path.join(process.resourcesPath || '', file),
  ];
  let found: string | null = null;
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) { found = c; break; } } catch { /* ignore */ }
  }
  if (!found) return null;
  if (process.platform === 'linux') return { bin: 'python3', args: [found] };
  if (process.platform === 'win32') {
    return { bin: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', found] };
  }
  return { bin: found, args: [] }; // macOS: a compiled binary
}

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
    // Inside a packaged app the module resolves to a path within app.asar,
    // which the OS cannot exec. electron-builder unpacks the binary alongside
    // it (see build.asarUnpack), so point at the unpacked copy.
    if (p && typeof p === 'string') return p.replace('app.asar', 'app.asar.unpacked');
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
// any failure everything is torn down and { ok:false } tells the caller no
// cursor-hidden capture is available.
async function tryStartPipewire(
  geom: { w: number; h: number; x: number; y: number },
  audio: { monitor: string | null; source: string | null; wantSys: boolean; wantMic: boolean },
  ts: string,
  win?: { handle: string; name: string } | null
): Promise<{ ok: boolean }> {
  const script = helperScriptPath();
  if (!script) return { ok: false };

  // The system monitor shares PipeWire's clock, so it always goes IN the gst
  // pipeline when requested (perfectly synced there). The mic, when on, is a
  // separate process and is mixed in offline at finalize.
  const monitorInGst = audio.wantSys ? audio.monitor : null;
  const videoPath = path.join(recordingsTempDir, `${ts}-screen.mkv`);
  const helperArgs = [
    script, '--restore-token-file', restoreTokenPath(),
    String(geom.x), String(geom.y), String(geom.w), String(geom.h),
    '30', videoPath,
  ];
  // Electron's Linux window source id carries the X11 window id verbatim
  // ("window:<xid>:<n>"), which is exactly what ximagesrc's xid property wants,
  // so the window the user picked in OUR picker is captured directly — no
  // second dialog. The helper falls back to the portal's window chooser when
  // there's no X display, which is how native Wayland windows are reached.
  if (win) helperArgs.splice(1, 0, '--window-xid', win.handle);
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
  recordedWindowOrigins = [];
  helperStdoutTail = '';
  proc.stdout?.on('data', (d) => {
    stdout += String(d);
    // Origins keep arriving for the whole recording, so parse them here rather
    // than scanning `stdout` once after READY.
    consumeHelperOrigins(String(d));
  });
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
  pwProc = proc;
  pwVideoPath = videoPath;
  ffStartedAt = Date.now();
  captureVideoEpoch = ffStartedAt;
  // The XDG portal hands back a whole monitor rather than the exact region we
  // asked for, so trust the size the helper negotiated over the requested one.
  const negotiated = /^SIZE (\d+)x(\d+)$/m.exec(stdout);
  ffDims = negotiated
    ? { width: Number(negotiated[1]), height: Number(negotiated[2]) }
    : { width: geom.w, height: geom.h };
  // The window route reports where the window sits (and keeps reporting as it
  // moves), so the cursor sidecar can be made relative to the window.
  recordedWindowSize = win && recordedWindowOrigins.length > 0
    ? { w: ffDims.width, h: ffDims.height }
    : null;
  helperStdoutTail = '';
  console.log(
    `[main] capture: pipewire via ${(/^BACKEND (\w+)$/m.exec(stdout) || [, '?'])[1]}` +
    ` @ ${ffDims.width}x${ffDims.height}`
  );
  pwAudioProc = null;
  pwAudioPath = null;
  if (audio.wantMic && audio.source) {
    const mic = startSeparateMicAudio(ts, audio.source);
    if (mic) { pwAudioProc = mic.proc; pwAudioPath = mic.path; }
  }
  // If the helper dies unexpectedly mid-recording, don't leave a dangling handle.
  proc.once('exit', (code) => {
    if (pwProc === proc && code !== 0 && code !== null) {
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
// Duration of `file` in ms per ffprobe, or `fallback` if it can't be read.
// Only shortens: a probe that reads long (or fails) must never inflate the
// timeline, and a normal stop should keep its wall-clock measurement.
function actualDurationMs(file: string, fallback: number): number {
  try {
    const out = execFileSync(ffprobeBin(), [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', file
    ], { encoding: 'utf8' }).trim();
    const ms = Math.round(Number(out) * 1000);
    if (Number.isFinite(ms) && ms > 0 && ms < fallback) return ms;
  } catch { /* keep the wall-clock figure */ }
  return fallback;
}

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

// ── Cursor-free capture on Windows / macOS ──────────────────────────────────
//
// Chromium bakes the OS pointer into every desktop-capture frame and gives us
// no way out. The `cursor` constraint was removed from the platform —
// getSupportedConstraints().cursor is false — so getDisplayMedia ACCEPTS
// { cursor: 'never' }, resolves, and then ignores it, reporting cursor:"always"
// in the track settings. The capture backend is irrelevant here: forcing the
// Windows.Graphics.Capture capturer changes nothing, because the constraint
// never reaches a capturer at all.
//
// So we do what Linux already does and capture outside Chromium. Windows uses
// ffmpeg's ddagrab (Desktop Duplication, GPU-side) with gdigrab as a fallback;
// macOS uses avfoundation, whose -capture_cursor defaults to off. Both Windows
// backends were measured dropping the pointer while holding 30fps at 1080p.
//
// Audio does NOT come through here. Windows exposes no loopback device to
// ffmpeg (a stock machine has no "Stereo Mix"), so system audio stays in
// Chromium and the renderer records it — see startHelperRecording. If capture
// can't start we return ok:false and the renderer falls back to its normal
// cursor-included path, exactly as it does when PipeWire is missing on Linux.
let nativeProc: ChildProcess | null = null;
let nativeVideoPath: string | null = null;

type NativeBackend = 'sckit' | 'ddagrab' | 'gdigrab' | 'avfoundation';

// The ScreenCaptureKit helper (electron/mac-capture.swift), compiled in CI on a
// real Mac and shipped as a loose resource. ffmpeg's avfoundation sits on the
// old AVCaptureScreenInput API whose capturesCursor=false is ignored on modern
// macOS, so the pointer was baked into "hide cursor" recordings and the editor
// drew its synthetic cursor on top of a real one — two cursors, read as lag.
// SCK's showsCursor=false genuinely excludes it. Returns null when the binary
// isn't present (dev on Linux, or an unbuilt tree) so we fall through.
function macCaptureBin(): string | null {
  if (process.platform !== 'darwin') return null;
  const candidates = [
    path.join(process.resourcesPath || '', 'mac-capture'),
    path.join(__dirname, '..', 'electron', 'mac-capture'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}
type CaptureBox = { w: number; h: number; x: number; y: number };

function nativeCaptureArgs(
  backend: NativeBackend,
  box: CaptureBox,
  displayIndex: number,
  out: string,
  win?: { handle: string; name: string } | null
): string[] {
  // yuv420p needs even dimensions and a display can report odd ones.
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const encode = [
    // zerolatency is load-bearing for sync, not a performance tweak: it drops
    // x264's rc-lookahead (~30 frames = a full second at 30fps) and B-frames,
    // so a frame leaves the encoder within a frame-time of being captured.
    // The progress report's out_time is ENCODER OUTPUT — with lookahead on,
    // "epoch = now - out_time" lands ~1.3s late, and the cursor/click clock
    // hangs off that epoch (measured: a right-click's context menu appeared
    // 1339ms after the sidecar said the click happened). No B-frames also
    // means every frame is scrub-friendly.
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '20',
    // A keyframe every second keeps editor scrubbing instant (the same reason
    // the PipeWire path uses dense keyframes) without bloating the file.
    '-g', '30', '-keyint_min', '30',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out
  ];
  if (backend === 'ddagrab') {
    return [
      '-f', 'lavfi',
      '-i', 'ddagrab=output_idx=' + displayIndex + ':draw_mouse=0:framerate=30',
      '-vf', 'hwdownload,format=bgra,' + even,
      ...encode
    ];
  }
  if (backend === 'gdigrab') {
    // Captures a picked window by title — gdigrab's only window handle. Kept
    // working, but NOT currently reachable: tryStartNativeCapture declines
    // window capture on Windows because it has no way to report the window's
    // position, which the cursor sidecar needs. Wire up an HWND rect lookup
    // (GetWindowRect) that streams "ORIGIN <ms> <x>,<y>" and this becomes live.
    if (win) {
      return [
        '-f', 'gdigrab', '-draw_mouse', '0', '-framerate', '30',
        '-i', 'title=' + win.name, '-vf', even, ...encode
      ];
    }
    return [
      '-f', 'gdigrab', '-draw_mouse', '0', '-framerate', '30',
      '-offset_x', String(box.x), '-offset_y', String(box.y),
      '-video_size', box.w + 'x' + box.h, '-i', 'desktop',
      '-vf', even, ...encode
    ];
  }
  // Screens must be addressed BY NAME. avfoundation numbers cameras first, so
  // on any Mac with a built-in camera video device 0 is the FaceTime camera —
  // a bare index would record the webcam instead of the display. Screen
  // devices are always named "Capture screen N" (not localized), N in display
  // order, which matches Electron's screen.getAllDisplays() ordering.
  return [
    '-f', 'avfoundation', '-capture_cursor', '0', '-framerate', '30',
    '-i', 'Capture screen ' + displayIndex + ':none', '-vf', even, ...encode
  ];
}

// Spawn one backend and resolve only once ffmpeg reports a frame actually
// landed. That instant — not spawn time — is the video's t=0, which is what
// the cursor clock and the audio delay get measured against.
function spawnNativeCapture(
  backend: NativeBackend,
  box: CaptureBox,
  displayIndex: number,
  out: string,
  win?: { handle: string; name: string } | null
): Promise<boolean> {
  return new Promise((resolve) => {
    let proc: ChildProcess;
    // The SCK helper speaks the same stdout "frame=/out_time_us=" progress and
    // stdin "q" protocol as ffmpeg, so everything below it is shared.
    const bin = backend === 'sckit' ? macCaptureBin() : ffmpegBin();
    if (!bin) return resolve(false);
    const args = backend === 'sckit'
      ? [String(displayIndex), '30', out, win?.handle ?? '0']
      : ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
        ...nativeCaptureArgs(backend, box, displayIndex, out, win)];
    try {
      proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      console.warn('[main] ' + backend + ' spawn threw', err);
      return resolve(false);
    }
    let settled = false;
    let errText = '';
    recordedWindowOrigins = [];
    recordedWindowSize = null;
    helperStdoutTail = '';
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok) {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        try { fs.rmSync(out, { force: true }); } catch { /* ignore */ }
      }
      resolve(ok);
    };
    proc.stderr?.on('data', (d) => { errText += String(d); });
    proc.stdout?.on('data', (d) => {
      // The macOS helper interleaves "ORIGIN <ms> <x>,<y> <w>x<h>" lines with
      // the progress feed for the whole recording, so parse them on every
      // chunk, not just the first. (ffmpeg's backends emit none.)
      if (win) consumeHelperOrigins(String(d));
      // -progress keeps emitting for the whole recording; only the FIRST
      // report is the video's t=0. Without this guard the epoch kept being
      // pushed forward and the audio skew came out as minus the recording
      // length, shifting the muxed audio wildly out of sync.
      if (settled) return;
      // -progress emits key=value lines; a non-zero frame= means we're rolling.
      const report = String(d);
      if (/^frame=\s*[1-9]/m.test(report)) {
        nativeProc = proc;
        nativeVideoPath = out;
        // The report arrives well after the frame it describes: ffmpeg only
        // emits progress periodically and the backend needs ~1.3s to warm up.
        // out_time_us says how much video already exists, so subtracting it
        // gives the wall time of the FIRST frame -- the video's real t=0.
        // The plain Date.now() this replaces measured 433ms late, and the
        // cursor clock hangs off this epoch, so every click ripple was drawn
        // 433ms before the video showed the click land. The offset is a
        // constant, not drift: sampled across a 20s capture the wall-to-video
        // lead stays flat at ~1255ms and the rate at 1.000, so the origin is
        // the only thing that needs correcting.
        const us = Number((/out_time_us=([0-9]+)/.exec(report) || [])[1] || 0);
        captureVideoEpoch = Date.now() - Math.round(us / 1000);
        done(true);
      }
    });
    proc.once('error', () => done(false));
    proc.once('exit', (code) => {
      if (!settled) console.warn('[main] ' + backend + ' exited before first frame (' + code + ') ' + errText.trim());
      done(false);
    });
    setTimeout(() => {
      if (!settled) console.warn('[main] ' + backend + ' produced no frame in 8s ' + errText.trim());
      done(false);
    }, 8000);
  });
}

async function tryStartNativeCapture(
  box: CaptureBox,
  displayIndex: number,
  ts: string,
  win?: { handle: string; name: string } | null
): Promise<boolean> {
  const out = path.join(recordingsTempDir, ts + '-screen.mp4');
  // ddagrab is GPU-side and cheap; gdigrab is the universal fallback and takes
  // explicit offsets, so it also copes with awkward multi-monitor layouts.
  //
  // When the user picked a WINDOW we only offer the backends that can actually
  // capture one: gdigrab (by title) on Windows, ScreenCaptureKit (by
  // CGWindowID) on macOS. ddagrab duplicates a whole output and avfoundation
  // grabs a whole screen, so including them would "succeed" by recording the
  // entire desktop — the user asked for one window and would silently get
  // everything, which is both wrong and a privacy leak. Returning false here
  // instead sends the caller to Chromium's window capture: the right window,
  // with the cursor visible.
  //
  // Windows is deliberately absent from the window case. gdigrab CAN capture a
  // window by title, but nothing on that path can tell us WHERE the window is,
  // and the cursor sidecar has to be normalized against the window's rect or
  // the editor's synthetic cursor lands somewhere else entirely. Since hiding
  // the cursor exists precisely so that synthetic cursor can stand in, a
  // cursor-free video we can't place a cursor on is worse than declining: the
  // caller falls back to Chromium's window capture, which records the right
  // window with a real cursor. (Linux gets the rect from X, macOS from
  // kCGWindowBounds; Windows would need an HWND lookup we don't have.)
  const backends: NativeBackend[] = win
    ? (process.platform === 'win32' ? [] : ['sckit'])
    : (process.platform === 'win32' ? ['ddagrab', 'gdigrab'] : ['sckit', 'avfoundation']);
  if (win && backends.length === 0) {
    console.log('[main] cursor-hidden capture declined: no window-rect source on this platform');
    return false;
  }
  for (const backend of backends) {
    if (await spawnNativeCapture(backend, box, displayIndex, out, win)) {
      console.log('[main] capture: ' + backend + ' (cursor omitted) '
        + (win ? 'window "' + win.name + '"' : '@ ' + box.w + 'x' + box.h));
      return true;
    }
  }
  return false;
}

// Mux the renderer's audio onto the cursor-free video. The two recorders start
// a beat apart, so shift the audio by the measured gap rather than assuming
// they're aligned: positive means audio began after the first video frame and
// has to be delayed, negative means it began first and gets trimmed.
function muxNativeAudio(
  videoPath: string,
  audio: { data: ArrayBuffer; startedAt: number } | undefined,
  videoEpoch: number | null
): string {
  if (!audio || !audio.data || audio.data.byteLength === 0) return videoPath;
  const audioPath = videoPath.replace(/-screen\.mp4$/, '-audio.webm');
  const outPath = videoPath.replace(/-screen\.mp4$/, '.mp4');
  try {
    fs.writeFileSync(audioPath, Buffer.from(audio.data));
    const skewMs = videoEpoch ? audio.startedAt - videoEpoch : 0;
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (skewMs < -20) args.push('-ss', (Math.abs(skewMs) / 1000).toFixed(3));
    args.push('-i', audioPath, '-i', videoPath);
    if (skewMs > 20) args.push('-af', 'adelay=' + Math.round(skewMs) + ':all=1');
    args.push('-map', '1:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', outPath);
    execFileSync(ffmpegBin(), args, { stdio: 'ignore' });
    console.log('[main] finalize(native): muxed renderer audio, skew ' + Math.round(skewMs) + 'ms');
    fs.rmSync(videoPath, { force: true });
    fs.rmSync(audioPath, { force: true });
    return outPath;
  } catch (err) {
    console.warn('[main] finalize(native) mux failed; keeping silent video', err);
    try { fs.rmSync(audioPath, { force: true }); } catch { /* ignore */ }
    return videoPath;
  }
}

ipcMain.handle('ffcap:start', async (_evt, opts: { withSystemAudio: boolean; withMic: boolean }) => {
  if (process.platform !== 'linux') {
    try { nativeProc?.kill('SIGKILL'); } catch { /* ignore */ }
    nativeProc = null;
    nativeVideoPath = null;
    captureVideoEpoch = null;

    const disp = recordedDisplay ?? screen.getPrimaryDisplay();
    const scale = disp.scaleFactor || 1;
    const box = {
      w: Math.round(disp.bounds.width * scale),
      h: Math.round(disp.bounds.height * scale),
      x: Math.round(disp.bounds.x * scale),
      y: Math.round(disp.bounds.y * scale)
    };
    ffDims = { width: box.w, height: box.h };
    const index = Math.max(0, screen.getAllDisplays().findIndex((d) => d.id === disp.id));

    ffStartedAt = Date.now();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    if (await tryStartNativeCapture(box, index, ts, pendingWindow)) {
      // ffmpeg has no route to system audio on these platforms, so the renderer
      // records it and hands it to ffcap:stop for muxing.
      return { ok: true, width: ffDims.width, height: ffDims.height, audioFromRenderer: true };
    }
    captureVideoEpoch = null;
    return { ok: false, width: 0, height: 0 };
  }
  try { pwProc?.kill('SIGKILL'); } catch { /* ignore */ }
  try { pwAudioProc?.kill('SIGKILL'); } catch { /* ignore */ }
  pwProc = null;
  pwAudioProc = null;
  captureVideoEpoch = null;

  const disp = recordedDisplay ?? screen.getPrimaryDisplay();
  const scale = disp.scaleFactor || 1;
  const w = Math.round(disp.bounds.width * scale);
  const h = Math.round(disp.bounds.height * scale);
  const x = Math.round(disp.bounds.x * scale);
  const y = Math.round(disp.bounds.y * scale);
  ffDims = { width: w, height: h };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const { monitor, source } = pulseDefaults();
  const wantSys = !!opts.withSystemAudio && !!monitor;
  const wantMic = !!opts.withMic && !!source;

  const pw = await tryStartPipewire({ w, h, x, y }, { monitor, source, wantSys, wantMic }, ts, pendingWindow);
  // tryStartPipewire trusts the size the ScreenCast actually negotiated, which
  // the portal may pick for us, so report ffDims rather than what we asked for.
  if (pw.ok) return { ok: true, width: ffDims.width, height: ffDims.height };

  // No ScreenCast: the renderer falls back to its Chromium capture (cursor
  // visible). We do NOT fall back to ffmpeg x11grab — it reads a stale root
  // pixmap under a compositor and silently drops rapid window switches, which
  // reads as "the recorder is laggy".
  captureVideoEpoch = null;
  return { ok: false, width: 0, height: 0 };
});

ipcMain.handle('ffcap:stop', async (_evt, audio?: { data: ArrayBuffer; startedAt: number }) => {
  if (nativeProc && nativeVideoPath) {
    const durationMs = Date.now() - ffStartedAt;
    const proc = nativeProc;
    const videoPath = nativeVideoPath;
    const videoEpoch = captureVideoEpoch;
    nativeProc = null;
    nativeVideoPath = null;
    captureVideoEpoch = null;

    // 'q' on stdin makes ffmpeg finalize the container. A killed ffmpeg leaves
    // an mp4 with no moov atom — an unplayable file — so ask nicely first and
    // escalate on a timer, bounded so a wedged encoder can't hang the HUD.
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      // The window routes can finish on their own: closing the captured window
      // stops the ScreenCaptureKit stream on macOS and ends gdigrab on Windows.
      // A process that has already exited never emits 'exit' again, so without
      // this the stop would sit on the 7s timeout below before the HUD returned.
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      proc.once('exit', finish);
      try { proc.stdin?.write('q'); } catch { /* ignore */ }
      setTimeout(() => { try { proc.kill('SIGINT'); } catch { /* ignore */ } }, 2000);
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 6000);
      setTimeout(finish, 7000);
    });

    const out = muxNativeAudio(videoPath, audio, videoEpoch);
    // Same reasoning as the Linux path: a capture that ended before the user
    // pressed stop must not report wall-clock, or the editor's timeline runs
    // past the end of the video and every keyframe lands at the wrong time.
    return { filePath: out, width: ffDims.width, height: ffDims.height,
      durationMs: actualDurationMs(out, durationMs) };
  }
  if (!pwProc || !pwVideoPath) return null;
  const durationMs = Date.now() - ffStartedAt;
  const vproc = pwProc;
  const aproc = pwAudioProc;
  const videoPath = pwVideoPath;
  const audioPath = pwAudioPath;
  pwProc = null;
  pwAudioProc = null;
  pwVideoPath = null;
  pwAudioPath = null;
  // Clear the video epoch so a following Chromium recording anchors its cursor
  // clock to "now" rather than this (now-stale) capture start.
  captureVideoEpoch = null;

  // Stop the separate mic ffmpeg (graceful 'q' -> SIGINT) and the video helper
  // (SIGTERM -> it injects EOS into every source and finalizes the Matroska).
  // Both are bounded so stop() can never hang the HUD.
  await Promise.all([
    new Promise<void>((resolve) => {
      if (!aproc) return resolve();
      let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
      if (aproc.exitCode !== null || aproc.signalCode !== null) return resolve();
      aproc.once('exit', finish);
      try { aproc.stdin?.write('q'); } catch { /* ignore */ }
      setTimeout(() => { try { aproc.kill('SIGINT'); } catch { /* ignore */ } }, 300);
      setTimeout(finish, 5000);
    }),
    new Promise<void>((resolve) => {
      let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
      // The window route can finish on its own -- closing or resizing the
      // captured window makes the helper finalize and exit. A dead process
      // never emits 'exit' again, so without this the stop would sit on the
      // 6.5s timeout below before the HUD came back.
      if (vproc.exitCode !== null || vproc.signalCode !== null) return resolve();
      vproc.once('exit', finish);
      try { vproc.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { vproc.kill('SIGKILL'); } catch { /* ignore */ } }, 6000);
      setTimeout(finish, 6500);
    }),
  ]);

  const out = finalizePipewire(videoPath, audioPath);
  // Wall-clock is right for a normal stop, but the window route can end early
  // (the captured window was closed or resized). Reporting 20s for a 4s file
  // would stretch the editor's timeline past the end of the video and put every
  // cursor sample and zoom keyframe at the wrong time, so prefer the duration
  // the file actually has whenever it's meaningfully shorter.
  return { filePath: out, width: ffDims.width, height: ffDims.height,
    durationMs: actualDurationMs(out, durationMs) };
});

ipcMain.handle('hud:setRecording', (_evt, recording: boolean) => {
  isRecording = !!recording;
  if (isRecording) { startCursorTracking(); startClickTracking(); startCursorKindTracking(); }
  else { stopCursorTracking(); stopClickTracking(); stopCursorKindTracking(); }
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
    if (!isInsideDir(recordingsTempDir, resolved)) return null;
    const raw = await fs.promises.readFile(resolved, 'utf-8');
    const data = JSON.parse(raw);
    // Legacy sidecars are a bare CursorSample[]; then { samples, clicks }; and
    // current ones may also carry { kinds }. Normalize to all three, with
    // `kinds` empty when the recording predates cursor-kind capture or the
    // platform couldn't provide it.
    if (Array.isArray(data)) return { samples: data, clicks: [], kinds: [] };
    if (data && Array.isArray(data.samples)) {
      return {
        samples: data.samples,
        clicks: Array.isArray(data.clicks) ? data.clicks : [],
        kinds: Array.isArray(data.kinds) ? data.kinds : []
      };
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
// The project file for a recording. ONE file per recording, forever: the
// name is derived from the recording's own filename (not from a timestamp of
// when it was opened), so reopening the same recording always resolves to the
// same project. A fresh capture like "2026-08-22T14-39-38-907Z-screen.mp4"
// becomes "2026-08-22T14-39-38-907Z-screen.reframe.json".
function projectPathForRecording(recordingPath: string): string {
  const base = path.basename(recordingPath).replace(/\.[^.]+$/, '');
  return path.join(projectsDir, `${base}.reframe.json`);
}

// Find an EXISTING project that references this recording. Checks the
// deterministic name first, then scans every project (older files were named
// "Untitled-<ts>" and there may be several for one recording — we pick the
// most recently modified, i.e. the one with the latest edits). Returns the
// path, or null if no project has ever been saved for this recording.
ipcMain.handle('project:findForRecording', async (_evt, recordingPath: string) => {
  const want = path.resolve(recordingPath);
  const direct = projectPathForRecording(recordingPath);
  if (fs.existsSync(direct)) return direct;
  let best: { p: string; mtime: number } | null = null;
  try {
    for (const f of await fs.promises.readdir(projectsDir)) {
      if (!f.endsWith('.reframe.json')) continue;
      const full = path.join(projectsDir, f);
      try {
        const parsed = JSON.parse(await fs.promises.readFile(full, 'utf-8'));
        const rp = parsed?.recording?.filePath;
        if (rp && path.resolve(rp) === want) {
          const mtime = (await fs.promises.stat(full)).mtimeMs;
          if (!best || mtime > best.mtime) best = { p: full, mtime };
        }
      } catch { /* malformed — skip */ }
    }
  } catch { /* no projects dir yet */ }
  return best?.p ?? null;
});

// The path a NEW project for this recording should be created at (used only
// when findForRecording found nothing). Kept as an IPC so the renderer never
// constructs filesystem paths itself.
ipcMain.handle('project:initialPath', (_evt, recordingPath: string) => projectPathForRecording(recordingPath));

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

// Read a project file by path, silently (no dialog). Used by the editor to
// reopen the existing project for a recording. Fenced to the projects dir.
ipcMain.handle('project:loadAt', async (_evt, filePath: string) => {
  try {
    const resolved = path.resolve(filePath);
    if (!projectsDir || !resolved.startsWith(projectsDir + path.sep)) return null;
    const project = JSON.parse(await fs.promises.readFile(resolved, 'utf-8'));
    if (!project?.recording) return null;
    return { ...project, _path: resolved };
  } catch {
    return null;
  }
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
  // Dev/automation escape hatch: write straight to a given path instead of
  // opening the native Save dialog (which can't be driven headlessly). Only
  // active when the env var is set, so real users always get the dialog.
  const forcedPath = process.env.REFRAME_EXPORT_PATH;
  if (forcedPath) {
    fs.mkdirSync(path.dirname(forcedPath), { recursive: true });
    fs.writeFileSync(forcedPath, Buffer.from(req.data));
    return { saved: true, path: forcedPath };
  }
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
    // `url.pathname` is a FILE-URL path, not an OS path. On Windows it reads
    // "/C:/Users/…", and path.resolve() turns that into "C:\C:\Users\…" — it
    // takes the leading slash as "root of the current drive". The containment
    // check below then 403'd every recording, which is why the editor came up
    // blank for the screen AND the webcam. Parse it with fileURLToPath instead:
    // the exact inverse of the pathToFileURL() in `recording:fileUrl`, and it
    // undoes the percent-escapes on the way.
    let resolved: string;
    try {
      resolved = path.resolve(fileURLToPath(`file://${url.pathname}`));
    } catch {
      return new Response('bad request', { status: 400 });
    }
    // Only allow paths under the temp recordings dir.
    if (!isInsideDir(recordingsTempDir, resolved)) {
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
  await sweepOrphanProjects();

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

  // Check for updates right away so the "update available" window appears as
  // the app opens, not several seconds in. It's a network call off the startup
  // path, so it doesn't delay the HUD. The background check stays silent
  // unless there's a new version; the tray's "Check for Updates…" runs the same
  // thing but always reports back.
  checkForUpdates(currentWindow, false);

  // Dev/automation escape hatch: open a given .reframe.json straight into the
  // editor on launch, bypassing the "Open Project" file picker (which can't be
  // driven headlessly). Reuses the exact same park-then-hydrate path the picker
  // uses, so the editor restores state, video, webcam and cursor sidecar
  // identically. Only active when the env var is set.
  const openProject = process.env.REFRAME_OPEN_PROJECT;
  if (openProject) {
    try {
      const project = JSON.parse(fs.readFileSync(openProject, 'utf-8'));
      if (project?.recording) {
        lastRecording = project.recording;
        lastLoadedProject = { state: project.state, path: openProject, recording: project.recording };
        createEditor(project.recording);
      }
    } catch (err) {
      console.warn('[main] REFRAME_OPEN_PROJECT failed', err);
    }
  }
});

// The mirror of sweepOrphanRecordings: a project whose recording no longer
// exists can never be opened (the editor needs the video), so it's dead weight
// in the Projects folder. Remove those. Never touches a project whose
// recording is present — that's user data.
async function sweepOrphanProjects() {
  try {
    let deleted = 0;
    for (const f of await fs.promises.readdir(projectsDir)) {
      if (!f.endsWith('.reframe.json')) continue;
      const full = path.join(projectsDir, f);
      try {
        const parsed = JSON.parse(await fs.promises.readFile(full, 'utf-8'));
        const rp = parsed?.recording?.filePath;
        // Only act on a well-formed project that names a recording which is gone.
        if (typeof rp === 'string' && rp && !fs.existsSync(rp)) {
          await fs.promises.rm(full, { force: true });
          deleted++;
        }
      } catch {
        // Malformed — leave it; not ours to judge on a parse error.
      }
    }
    if (deleted) console.log(`[main] sweep: removed ${deleted} project(s) whose recording is gone`);
  } catch {
    // Best-effort.
  }
}

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
