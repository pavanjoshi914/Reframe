#!/usr/bin/env node
// Ensure native macOS helpers (ScreenCaptureKit recorder + cursor-kind detector)
// are compiled for local development and packaging.
//
// Linux uses Python/GStreamer scripts; macOS needs compiled Swift binaries
// to interact with ScreenCaptureKit and AppKit.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkOnly = process.argv.includes('--check');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

if (process.platform !== 'darwin') {
  if (!checkOnly) console.log('setup-mac: not macOS — nothing to do.');
  process.exit(0);
}

const macCaptureBin = path.join(projectRoot, 'electron', 'mac-capture');
const macCaptureSrc = path.join(projectRoot, 'electron', 'mac-capture.swift');

const cursorKindBin = path.join(projectRoot, 'electron', 'cursor-kind');
const cursorKindSrc = path.join(projectRoot, 'electron', 'cursor-kind.swift');

function hasSwiftc() {
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!hasSwiftc()) {
  if (checkOnly) {
    console.warn('\n⚠  Reframe: Xcode Command Line Tools (swiftc) not found.');
    console.warn('   macOS cursor-hidden ScreenCaptureKit capture requires swiftc.');
    console.warn('   Install with: xcode-select --install\n');
    process.exit(0);
  }
  console.error('\n✗ Error: swiftc is not available.');
  console.error('  Install Xcode Command Line Tools: xcode-select --install\n');
  process.exit(1);
}

let compiledAny = false;

// 1. ScreenCaptureKit recorder (mac-capture)
if (!existsSync(macCaptureBin) && existsSync(macCaptureSrc)) {
  if (checkOnly) {
    console.warn('\n⚠  Reframe: electron/mac-capture missing. Run `npm run setup:mac` to compile.\n');
    process.exit(0);
  }
  console.log('[setup-mac] Compiling electron/mac-capture (ScreenCaptureKit)...');
  const res = spawnSync(
    'swiftc',
    [
      '-O',
      '-framework', 'ScreenCaptureKit',
      '-framework', 'AVFoundation',
      '-framework', 'CoreMedia',
      '-framework', 'AppKit',
      '-o', macCaptureBin,
      macCaptureSrc
    ],
    { stdio: 'inherit', cwd: projectRoot }
  );
  if (res.status !== 0) {
    console.error('✗ Failed to compile electron/mac-capture');
    process.exit(1);
  }
  chmodSync(macCaptureBin, 0o755);
  compiledAny = true;
}

// 2. Cursor kind detector (cursor-kind)
if (!existsSync(cursorKindBin) && existsSync(cursorKindSrc)) {
  if (checkOnly) {
    console.warn('\n⚠  Reframe: electron/cursor-kind missing. Run `npm run setup:mac` to compile.\n');
    process.exit(0);
  }
  console.log('[setup-mac] Compiling electron/cursor-kind (AppKit)...');
  const res = spawnSync(
    'swiftc',
    [
      '-O',
      '-framework', 'AppKit',
      '-o', cursorKindBin,
      cursorKindSrc
    ],
    { stdio: 'inherit', cwd: projectRoot }
  );
  if (res.status !== 0) {
    console.error('✗ Failed to compile electron/cursor-kind');
    process.exit(1);
  }
  chmodSync(cursorKindBin, 0o755);
  compiledAny = true;
}

if (!checkOnly) {
  if (compiledAny) {
    console.log('✓ Native macOS helpers successfully built.');
  } else {
    console.log('✓ Native macOS helpers are up to date.');
  }
}

