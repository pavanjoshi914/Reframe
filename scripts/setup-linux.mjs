#!/usr/bin/env node
// Install (or just check) what the Linux cursor-hidden recorder needs at runtime.
//
// Production installs get these from the .deb's `depends`, so this script is for
// DEVELOPMENT — where you run from source and nothing declares them for you.
// Without the H.264 encoder the app silently falls back to ffmpeg x11grab, which
// reads a stale root pixmap under a compositor and drops rapid window switches.
// That fallback is easy to not notice, hence this check.
//
//   node scripts/setup-linux.mjs            install whatever is missing (uses sudo)
//   node scripts/setup-linux.mjs --check    report only, never sudo, never fails
//
// --check runs from postinstall: it must stay silent when healthy and must never
// break `npm install` (CI, other platforms, no apt, etc.).

import { execFileSync, spawnSync } from 'node:child_process';

const checkOnly = process.argv.includes('--check');

// Each probe maps a runtime capability to the Debian package that provides it.
const REQUIREMENTS = [
  { pkg: 'gstreamer1.0-pipewire', what: 'pipewiresrc (PipeWire capture)', probe: () => gstHas('pipewiresrc') },
  { pkg: 'gstreamer1.0-plugins-base', what: 'videoconvert/videorate (CFR)', probe: () => gstHas('videoconvert') && gstHas('videorate') },
  { pkg: 'gstreamer1.0-plugins-good', what: 'matroskamux/pulsesrc (mux + audio)', probe: () => gstHas('matroskamux') && gstHas('pulsesrc') },
  { pkg: 'gstreamer1.0-plugins-ugly', what: 'x264enc (H.264 encoder)', probe: () => gstHas('x264enc') },
  { pkg: 'python3-gi', what: 'PyGObject (helper bindings)', probe: () => pyOk('import gi') },
  { pkg: 'gir1.2-glib-2.0', what: 'GLib/Gio typelibs', probe: () => pyOk("import gi; gi.require_version('Gio','2.0')") },
  { pkg: 'gir1.2-gstreamer-1.0', what: 'GStreamer typelib', probe: () => pyOk("import gi; gi.require_version('Gst','1.0')") },
  { pkg: 'ffmpeg', what: 'ffmpeg (finalize/remux)', probe: () => bin('ffmpeg', ['-version']) },
];

function quiet(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const gstHas = (el) => quiet('gst-inspect-1.0', [el]);
const pyOk = (src) => quiet('python3', ['-c', src]);
const bin = (cmd, args) => quiet(cmd, args);

if (process.platform !== 'linux') {
  if (!checkOnly) console.log('setup-linux: not Linux — nothing to do.');
  process.exit(0);
}

const missing = REQUIREMENTS.filter((r) => !r.probe());

if (missing.length === 0) {
  if (!checkOnly) console.log('✓ All Linux recorder dependencies present — PipeWire capture will be used.');
  process.exit(0);
}

const pkgs = [...new Set(missing.map((m) => m.pkg))];

if (checkOnly) {
  // Advisory only: never fail `npm install` over this.
  console.warn('\n⚠  Reframe: the cursor-hidden recorder will fall back to x11grab (laggy) — missing:');
  for (const m of missing) console.warn(`     • ${m.pkg}  — ${m.what}`);
  console.warn('   Fix with:  npm run setup:linux\n');
  process.exit(0);
}

console.log('Missing Linux recorder dependencies:');
for (const m of missing) console.log(`  • ${m.pkg}  — ${m.what}`);

if (!bin('apt-get', ['--version'])) {
  console.error('\nThis installer only knows apt. Install the equivalents for your distro:');
  console.error(`  ${pkgs.join(' ')}`);
  process.exit(1);
}

console.log(`\nInstalling: ${pkgs.join(' ')}`);
console.log('(sudo may prompt for your password)\n');

// Inherit stdio so the sudo password prompt actually works.
const r = spawnSync('sudo', ['apt-get', 'install', '-y', ...pkgs], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\n✗ Install failed. Try manually:');
  console.error(`  sudo apt-get install -y ${pkgs.join(' ')}`);
  process.exit(1);
}

const stillMissing = REQUIREMENTS.filter((r2) => !r2.probe());
if (stillMissing.length > 0) {
  console.error('\n✗ Still missing after install:');
  for (const m of stillMissing) console.error(`  • ${m.pkg} — ${m.what}`);
  process.exit(1);
}
console.log('\n✓ Done — PipeWire capture is now available.');
