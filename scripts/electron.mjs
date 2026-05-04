#!/usr/bin/env node
// Manual Electron launcher.
//
// Two ways to use it:
//
//   Dev (with hot reload):
//     Terminal 1:  npm run dev          # vite + builds main/preload
//     Terminal 2:  npm run electron     # this script — points at the dev server
//
//   Production-like (no dev server):
//     npm run start                     # builds renderer, then launches electron from dist/
//
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const mainBundle = path.join(projectRoot, 'dist-electron', 'main.js');
if (!existsSync(mainBundle)) {
  console.error('[electron] dist-electron/main.js not found.');
  console.error('  Run `npm run dev` in another terminal first (it builds main + preload),');
  console.error('  or run `npm run build` once to produce a one-shot build.');
  process.exit(1);
}

const electronBinary = require('electron');
if (typeof electronBinary !== 'string') {
  console.error('[electron] expected electron binary path, got', typeof electronBinary);
  process.exit(1);
}

const devUrl = 'http://127.0.0.1:5173/';

function probeVite() {
  return new Promise((resolve) => {
    const req = http.get(devUrl, { timeout: 800 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

const viteUp = await probeVite();
const distExists = existsSync(path.join(projectRoot, 'dist', 'hud.html'));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (viteUp) {
  env.VITE_DEV_SERVER_URL = devUrl;
  console.log('[electron] mode: dev server (hot reload)');
} else if (distExists) {
  delete env.VITE_DEV_SERVER_URL;
  console.log('[electron] mode: production build (loading from dist/)');
} else {
  console.error('[electron] No dev server at', devUrl, 'and no dist/ build found.');
  console.error('  Either start `npm run dev` first, or run `npm run build` once.');
  process.exit(1);
}

if (process.platform === 'linux' && !env.DISPLAY) env.DISPLAY = ':1';

const args = ['.', '--no-sandbox'];
console.log('[electron] binary :', electronBinary);
console.log('[electron] DISPLAY:', env.DISPLAY);
if (env.VITE_DEV_SERVER_URL) console.log('[electron] dev URL:', env.VITE_DEV_SERVER_URL);
console.log('[electron] args   :', args.join(' '));
console.log('[electron] launching…');

const child = spawn(electronBinary, args, {
  stdio: 'inherit',
  env,
  cwd: projectRoot
});

child.on('exit', (code, signal) => {
  console.log(`[electron] exited (code=${code} signal=${signal})`);
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
