import { app, BrowserWindow, Menu, ipcMain, desktopCapturer, shell, protocol, dialog, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
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

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');
const PRELOAD = path.join(__dirname, 'preload.js');

let hudWindow: BrowserWindow | null = null;
let pickerWindow: BrowserWindow | null = null;
let editorWindow: BrowserWindow | null = null;

// Transparent windows on Linux/X11 require a running compositor; without one
// they render as fully invisible. Default ON everywhere — modern desktop envs
// (GNOME/Mutter, KDE/KWin) all run a compositor. Set OS_TRANSPARENT=0 to
// force opaque mode if the HUD pill is invisible on your setup.
const useTransparent = process.env.OS_TRANSPARENT !== '0';
const isDev = !!VITE_DEV_SERVER_URL;

let lastRecording: import('../src/shared/ipc.js').RecordingMeta | null = null;

const recordingsDir = path.join(os.homedir(), 'Videos', 'reframe');
fs.mkdirSync(recordingsDir, { recursive: true });

function loadHtml(win: BrowserWindow, htmlName: string) {
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}${htmlName}`);
  } else {
    win.loadFile(path.join(RENDERER_DIST, htmlName));
  }
}

function createHud() {
  hudWindow = new BrowserWindow({
    width: 620,
    height: 56,
    frame: false,
    transparent: useTransparent,
    backgroundColor: useTransparent ? '#00000000' : '#14161a',
    resizable: false,
    alwaysOnTop: true,
    hasShadow: useTransparent ? false : true,
    skipTaskbar: false,
    movable: true,
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
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });
  loadHtml(editorWindow, 'editor.html');
  editorWindow.on('closed', () => {
    editorWindow = null;
  });
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

ipcMain.handle('recording:save', async (_evt, data: ArrayBuffer, meta: { durationMs: number; width: number; height: number; startedAt: number; webcamData?: ArrayBuffer }) => {
  const ts = new Date(meta.startedAt).toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(recordingsDir, `${ts}.webm`);
  fs.writeFileSync(filePath, Buffer.from(data));
  let webcamFilePath: string | undefined;
  if (meta.webcamData) {
    webcamFilePath = path.join(recordingsDir, `${ts}-webcam.webm`);
    fs.writeFileSync(webcamFilePath, Buffer.from(meta.webcamData));
  }
  const { webcamData, ...rest } = meta;
  void webcamData;
  return { ...rest, filePath, webcamFilePath };
});

ipcMain.handle('editor:open', (_evt, recording) => {
  createEditor(recording);
});

ipcMain.handle('recording:meta', () => lastRecording);

ipcMain.handle('recording:fileUrl', (_evt, filePath: string) => {
  // Serve via the custom `media://` scheme so the editor (http origin in dev)
  // can load it. pathname keeps the absolute path; host stays empty.
  return `media://local${pathToFileURL(filePath).pathname}`;
});

ipcMain.handle('hud:minimize', () => hudWindow?.minimize());
ipcMain.handle('hud:close', () => hudWindow?.close());
ipcMain.handle('recordings:openFolder', () => shell.openPath(recordingsDir));

let isRecording = false;

ipcMain.handle('hud:setRecording', (_evt, recording: boolean) => {
  isRecording = !!recording;
  if (!hudWindow) return;
  // Keep setContentProtection on — excludes the HUD from screen capture on
  // macOS/Windows. On Linux it's a no-op (the HUD will be visible in the
  // recording); the user accepts that trade-off so they can still see/stop
  // recording from the HUD pill.
  hudWindow.setContentProtection(true);
});

ipcMain.handle('project:save', async (evt, project) => {
  const win = BrowserWindow.fromWebContents(evt.sender) ?? editorWindow ?? undefined;
  const res = await dialog.showSaveDialog(win!, {
    title: 'Save Project',
    defaultPath: path.join(recordingsDir, 'project.reframe.json'),
    filters: [{ name: 'Reframe Project', extensions: ['reframe.json', 'json'] }]
  });
  if (res.canceled || !res.filePath) return { saved: false };
  fs.writeFileSync(res.filePath, JSON.stringify(project, null, 2));
  return { saved: true, path: res.filePath };
});

ipcMain.handle('project:load', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender) ?? editorWindow ?? undefined;
  const res = await dialog.showOpenDialog(win!, {
    title: 'Load Project',
    defaultPath: recordingsDir,
    filters: [{ name: 'Reframe Project', extensions: ['reframe.json', 'json'] }],
    properties: ['openFile']
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const raw = fs.readFileSync(res.filePaths[0], 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

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
    defaultPath: path.join(recordingsDir, safeName),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  if (res.canceled || !res.filePath) return { saved: false };
  fs.writeFileSync(res.filePath, Buffer.from(req.data));
  return { saved: true, path: res.filePath };
});

app.whenReady().then(() => {
  console.log('[main] electron ready, creating HUD');

  // Drop the default OS menubar (File/Edit/View/Window/Help). The editor's
  // top toolbar already exposes File/Edit/View — keeping both produced a
  // duplicate-looking header.
  Menu.setApplicationMenu(null);

  protocol.handle('media', async (req) => {
    const url = new URL(req.url);
    const filePath = decodeURIComponent(url.pathname);
    // Only allow paths under the recordings dir.
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(recordingsDir + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const stat = await fs.promises.stat(resolved);
      const stream = fs.createReadStream(resolved);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          'Content-Type': 'video/webm',
          'Content-Length': String(stat.size)
        }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  // Convenience global stop shortcut — works from any focused window.
  globalShortcut.register('CommandOrControl+Shift+0', () => {
    if (!isRecording) return;
    hudWindow?.webContents.send('hud:stop-shortcut');
  });

  createHud();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createHud();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
