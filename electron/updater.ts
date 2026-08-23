// Update mechanism.
//
// Two strategies, chosen by what the running build can actually do:
//
//   • Silent auto-update (electron-updater): downloads the new version in the
//     background and installs it on restart. Works for the NSIS installer
//     (Windows) and the AppImage (Linux). NOT for .deb/.rpm/Flatpak (the system
//     package manager owns those) and NOT for macOS unless the app is signed +
//     notarized — which we don't do yet.
//
//   • Download-page fallback: for every build the silent path can't handle,
//     point the user at the website's download page (it pre-selects their OS
//     and shows the install steps). No silent install, but nobody is left
//     without a way to hear about updates.
//
// Either way the user sees the SAME in-app window (update.html): Reframe-styled,
// with the release notes as bullets, and a primary button that does whichever
// of the two the build supports. Native dialog.* boxes are gone.
//
// Releases live on GitHub (public repo), so the notifier needs no auth and
// electron-updater reads the release assets directly.
import { app, shell, BrowserWindow, ipcMain, screen } from 'electron';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'pavanjoshi914';
const REPO = 'Reframe';
const DOWNLOAD_PAGE = 'https://getreframe.vercel.app/download';

// Flip to true to make the update mandatory: the window loses its "Later"
// button and can't be closed, so the old version can't be used until updated.
// Off by default — bricking someone mid-recording or offline is hostile, and a
// prominent, unmissable window gets most of the uptake without the backlash.
const UPDATE_REQUIRED = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER_DIST = path.join(__dirname, '../dist');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// electron-updater can silently download + install only for these build formats.
// The AppImage sets $APPIMAGE when it runs, which is how we tell it apart from a
// .deb install of the same Linux binary.
function canSilentUpdate(): boolean {
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return false; // macOS: needs code signing + notarization; enable with a cert
}

// True when version `a` is strictly newer than `b` (plain major.minor.patch).
function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

type Release = { version: string; url: string; notes: string[] };

// Turn the GitHub release body (Markdown) into the bullets the window shows.
// Bullet lines ("- …", "* …") become items; headings/blank lines are dropped;
// inline **bold**/`code`/[links](…) are flattened to plain text.
function notesToBullets(body: string): string[] {
  const out: string[] = [];
  for (const raw of (body || '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^[-*•]\s+(.+)$/.exec(line);
    if (!m) continue;
    let t = m[1]
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2') // *italic*
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) out.push(t);
    if (out.length >= 8) break; // keep the window readable
  }
  return out;
}

// Ask GitHub for the latest published (non-draft, non-prerelease) release.
function fetchLatestRelease(): Promise<Release | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/latest`,
        headers: { 'User-Agent': `${REPO}-Updater`, Accept: 'application/vnd.github+json' },
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const version = String(j.tag_name || '').replace(/^v/, '');
            if (!version) return resolve(null);
            resolve({
              version,
              url: j.html_url || `https://github.com/${OWNER}/${REPO}/releases/latest`,
              notes: notesToBullets(String(j.body || '')),
            });
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── The update window ──────────────────────────────────────────────────────
type Info = {
  current: string; latest: string; notes: string[]; notesUrl: string;
  mode: 'silent' | 'download'; required: boolean;
  state: 'available' | 'downloading' | 'ready' | 'error'; progress?: number; error?: string;
};
let updateWindow: BrowserWindow | null = null;
let info: Info | null = null;
let ipcWired = false;

function pushInfo(patch: Partial<Info> = {}): void {
  if (!info) return;
  info = { ...info, ...patch };
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.webContents.send('update:info', info);
}

function openUpdateWindow(): void {
  if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.focus(); pushInfo(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  const width = 560, height = 520;
  updateWindow = new BrowserWindow({
    width, height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    frame: false, resizable: false, minimizable: false, maximizable: false,
    closable: !UPDATE_REQUIRED, alwaysOnTop: true, backgroundColor: '#0e0f12',
    title: 'Reframe — Update available',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  updateWindow.setMenuBarVisibility(false);
  if (VITE_DEV_SERVER_URL) updateWindow.loadURL(`${VITE_DEV_SERVER_URL}update.html`);
  else updateWindow.loadFile(path.join(RENDERER_DIST, 'update.html'));
  updateWindow.on('closed', () => { updateWindow = null; });
}

function wireIpc(): void {
  if (ipcWired) return;
  ipcWired = true;
  ipcMain.on('update:ready', () => pushInfo());
  ipcMain.on('update:later', () => { if (!UPDATE_REQUIRED) updateWindow?.close(); });
  ipcMain.on('update:openDownloadPage', () => { void shell.openExternal(DOWNLOAD_PAGE); });
  ipcMain.on('update:openExternal', (_e, url: string) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); });
  ipcMain.on('update:download', () => {
    if (info?.mode !== 'silent') return void shell.openExternal(DOWNLOAD_PAGE);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
      pushInfo({ state: 'downloading', progress: 0 });
      void autoUpdater.downloadUpdate();
    } catch (e) {
      pushInfo({ state: 'error', error: (e as Error)?.message || 'Could not start the download.' });
    }
  });
  ipcMain.on('update:install', () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
      autoUpdater.quitAndInstall();
    } catch { /* ignore */ }
  });
}

// Show the window for a newer release. `mode` decides what the primary button does.
function present(latest: Release, mode: 'silent' | 'download'): void {
  wireIpc();
  info = {
    current: app.getVersion(), latest: latest.version, notes: latest.notes, notesUrl: latest.url,
    mode, required: UPDATE_REQUIRED, state: 'available',
  };
  openUpdateWindow();
}

let wired = false;
// When a user explicitly asks "Check for Updates", we owe them an answer even if
// they're already current; a background check stays silent unless there's news.
let announceNoUpdate = false;

function ensureAutoUpdaterWired(): void {
  if (wired) return;
  wired = true;
  // require (not import) so the bundler leaves electron-updater external, loaded
  // from node_modules at runtime alongside the electron-builder app-update.yml.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  // We download only when the user clicks "Update now" in our window, so the
  // window can show what's new first and the user stays in control.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (u) => {
    // electron-updater found a newer build. Fetch the GitHub notes for the
    // bullets (its own releaseNotes field is HTML and often empty), then show.
    void fetchLatestRelease().then((rel) => {
      present(rel ?? { version: u.version, url: `https://github.com/${OWNER}/${REPO}/releases/latest`, notes: [] }, 'silent');
    });
  });
  autoUpdater.on('download-progress', (p) => pushInfo({ state: 'downloading', progress: p.percent }));
  autoUpdater.on('update-downloaded', () => pushInfo({ state: 'ready', progress: 100 }));
  autoUpdater.on('update-not-available', () => {
    if (announceNoUpdate) { announceNoUpdate = false; showUpToDate(); }
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error', err?.message || err);
    if (info) pushInfo({ state: 'error', error: err?.message || 'Update failed.' });
    else if (announceNoUpdate) { announceNoUpdate = false; showCheckFailed(); }
  });
}

// Tiny confirmations for the tray's manual "Check for Updates" when there is
// nothing to do ("you're up to date" / "check failed"). These stay as plain OS
// message boxes: they're rare, one-line, and informational. The update itself
// — the thing users actually see — is always our own window above.
function showUpToDate(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dialog } = require('electron') as typeof import('electron');
  void dialog.showMessageBox({ type: 'info', buttons: ['OK'], message: 'You’re up to date', detail: `Reframe ${app.getVersion()} is the latest version.` });
}
function showCheckFailed(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dialog } = require('electron') as typeof import('electron');
  void dialog.showMessageBox({ type: 'info', buttons: ['OK'], message: 'Update check failed', detail: 'Could not check for updates right now. Please try again later.' });
}

async function notifierCheck(interactive: boolean): Promise<void> {
  const latest = await fetchLatestRelease();
  if (!latest) { if (interactive) showCheckFailed(); return; }
  if (isNewer(latest.version, app.getVersion())) present(latest, 'download');
  else if (interactive) showUpToDate();
}

// Check for updates. `interactive` = the user asked (tray "Check for Updates"),
// so always give feedback; a background launch check stays quiet unless there's
// an update. Safe to call from anywhere; a no-op in dev unless forced.
export function checkForUpdates(_getWindow?: unknown, interactive = false): void {
  if (!app.isPackaged && !process.env.REFRAME_FORCE_UPDATE_CHECK) {
    if (interactive) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { dialog } = require('electron') as typeof import('electron');
      void dialog.showMessageBox({ type: 'info', buttons: ['OK'], message: 'Updates unavailable in dev', detail: 'Run a packaged build to test the updater.' });
    }
    return;
  }
  if (canSilentUpdate()) {
    // Never let an updater failure crash the app: guard the synchronous parts
    // (require, wiring, the initial checkForUpdates call) as well as the async.
    try {
      ensureAutoUpdaterWired();
      announceNoUpdate = interactive;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
      Promise.resolve(autoUpdater.checkForUpdates()).catch((e) => {
        console.warn('[updater] checkForUpdates failed', e?.message || e);
        if (interactive) { announceNoUpdate = false; showCheckFailed(); }
      });
    } catch (e) {
      console.warn('[updater] silent update unavailable', (e as Error)?.message || e);
      if (interactive) showCheckFailed();
    }
  } else {
    void notifierCheck(interactive);
  }
}
