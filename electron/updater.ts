// Update mechanism.
//
// Two strategies, chosen by what the running build can actually do:
//
//   • Silent auto-update (electron-updater): downloads the new version in the
//     background and installs it on restart. Works for the NSIS installer
//     (Windows) and the AppImage (Linux). NOT for .deb/.rpm (the system package
//     manager owns those) and NOT for macOS unless the app is signed +
//     notarized — which we don't do yet.
//
//   • Notifier fallback: for every build the silent path can't handle (.deb,
//     unsigned macOS), just ask GitHub for the latest release and, if it's
//     newer, offer to open the download page. No silent install, but nobody is
//     left without a way to hear about updates.
//
// Releases live on GitHub (public repo), so the notifier needs no auth and
// electron-updater reads the release assets directly.
import { app, dialog, shell, BrowserWindow } from 'electron';
import https from 'node:https';

const OWNER = 'pavanjoshi914';
const REPO = 'Reframe';

type GetWindow = () => BrowserWindow | null | undefined;

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

function showBox(
  win: BrowserWindow | null | undefined,
  opts: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

function infoBox(win: BrowserWindow | null | undefined, message: string, detail: string): void {
  void showBox(win, { type: 'info', buttons: ['OK'], message, detail });
}

// Ask GitHub for the latest published (non-draft, non-prerelease) release.
function fetchLatestRelease(): Promise<{ version: string; url: string } | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/latest`,
        headers: { 'User-Agent': `${REPO}-Updater`, Accept: 'application/vnd.github+json' },
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const version = String(j.tag_name || '').replace(/^v/, '');
            if (!version) return resolve(null);
            resolve({ version, url: j.html_url || `https://github.com/${OWNER}/${REPO}/releases/latest` });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

let wired = false;
// When a user explicitly asks "Check for Updates", we owe them an answer even if
// they're already current; a background check stays silent unless there's news.
let announceNoUpdate = false;

function ensureAutoUpdaterWired(getWindow: GetWindow): void {
  if (wired) return;
  wired = true;
  // require (not import) so the bundler leaves electron-updater external, loaded
  // from node_modules at runtime alongside the electron-builder app-update.yml.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    void showBox(getWindow(), {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Reframe ${info.version} is ready`,
      detail: 'The update was downloaded. Restart Reframe to apply it.',
    }).then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on('update-not-available', () => {
    if (announceNoUpdate) {
      announceNoUpdate = false;
      infoBox(getWindow(), 'You’re up to date', `Reframe ${app.getVersion()} is the latest version.`);
    }
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error', err?.message || err);
    if (announceNoUpdate) {
      announceNoUpdate = false;
      infoBox(getWindow(), 'Update check failed', 'Could not check for updates right now. Please try again later.');
    }
  });
}

async function notifierCheck(getWindow: GetWindow, interactive: boolean): Promise<void> {
  const latest = await fetchLatestRelease();
  if (!latest) {
    if (interactive) infoBox(getWindow(), 'Update check failed', 'Could not reach the update server. Please try again later.');
    return;
  }
  if (isNewer(latest.version, app.getVersion())) {
    const r = await showBox(getWindow(), {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Reframe ${latest.version} is available`,
      detail: `You have ${app.getVersion()}. Open the download page to get the latest version?`,
    });
    if (r.response === 0) void shell.openExternal(latest.url);
  } else if (interactive) {
    infoBox(getWindow(), 'You’re up to date', `Reframe ${app.getVersion()} is the latest version.`);
  }
}

// Check for updates. `interactive` = the user asked (tray "Check for Updates"),
// so always give feedback; a background launch check stays quiet unless there's
// an update. Safe to call from anywhere; a no-op in dev unless forced.
export function checkForUpdates(getWindow: GetWindow, interactive = false): void {
  if (!app.isPackaged && !process.env.REFRAME_FORCE_UPDATE_CHECK) {
    if (interactive) infoBox(getWindow(), 'Updates unavailable in dev', 'Run a packaged build to test the updater.');
    return;
  }
  if (canSilentUpdate()) {
    // Never let an updater failure crash the app: guard the synchronous parts
    // (require, wiring, the initial checkForUpdates call) as well as the async.
    try {
      ensureAutoUpdaterWired(getWindow);
      announceNoUpdate = interactive;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
      Promise.resolve(autoUpdater.checkForUpdates()).catch((e) => {
        console.warn('[updater] checkForUpdates failed', e?.message || e);
        if (interactive) {
          announceNoUpdate = false;
          infoBox(getWindow(), 'Update check failed', 'Could not check for updates right now. Please try again later.');
        }
      });
    } catch (e) {
      console.warn('[updater] silent update unavailable', (e as Error)?.message || e);
      if (interactive) infoBox(getWindow(), 'Update check failed', 'Could not check for updates right now. Please try again later.');
    }
  } else {
    void notifierCheck(getWindow, interactive);
  }
}
