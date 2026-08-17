#!/usr/bin/env bash
#
# Reframe installer for Linux.
#
#   curl -fsSL https://getreframe.vercel.app/install.sh | bash
#
# Why this exists: Reframe's cursor-hidden recording needs a PipeWire/GStreamer
# stack and ffmpeg that no single package format can carry everywhere. A .deb
# declares them but only serves Debian/Ubuntu; an AppImage runs anywhere but
# can't declare anything, so the feature silently degrades. This script does
# what neither can: install the right packages for whatever distro you're on,
# then install the app, then *verify* the capability actually works.
#
# Flags:
#   --no-deps     install the app only, skip system packages
#   --uninstall   remove the app, desktop entry and icon (never touches deps)
#
set -euo pipefail

REPO="pavanjoshi914/Reframe"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
APP_PATH="$BIN_DIR/reframe"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"

SKIP_DEPS=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-deps) SKIP_DEPS=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

# ── uninstall ───────────────────────────────────────────────────────────────
if [ "$UNINSTALL" = 1 ]; then
  rm -f "$APP_PATH" "$DESKTOP_DIR/reframe.desktop" "$ICON_DIR/reframe.png"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  bold "Reframe removed."
  echo "System packages were left alone — remove them yourself if you want."
  exit 0
fi

[ "$(uname -s)" = "Linux" ] || die "This installer is for Linux. macOS and Windows builds are at https://github.com/$REPO/releases"

bold "Installing Reframe"
echo

# ── 1. system dependencies ──────────────────────────────────────────────────
# Package names differ per distro and drift between releases, so these are
# best-known values — the verification step below is what actually decides
# whether the install worked.
install_deps() {
  local pm=""
  for candidate in apt-get dnf pacman zypper; do
    if command -v "$candidate" >/dev/null 2>&1; then pm="$candidate"; break; fi
  done

  if [ -z "$pm" ]; then
    warn "No supported package manager found (apt/dnf/pacman/zypper)."
    warn "Install these yourself: ffmpeg, GStreamer (pipewire + base/good/ugly plugins), PyGObject."
    return 0
  fi

  echo "Package manager: $pm — installing recording dependencies (needs sudo)."
  case "$pm" in
    apt-get)
      sudo apt-get update -qq || true
      sudo apt-get install -y \
        ffmpeg gstreamer1.0-pipewire gstreamer1.0-plugins-base \
        gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly \
        python3-gi gir1.2-glib-2.0 gir1.2-gstreamer-1.0 || warn "some packages failed to install"
      ;;
    dnf)
      # x264enc and full ffmpeg live in RPM Fusion, not Fedora's main repos.
      if ! dnf repolist 2>/dev/null | grep -qi rpmfusion; then
        warn "RPM Fusion not enabled — ffmpeg and x264enc may be unavailable."
        warn "See https://rpmfusion.org/Configuration to enable it, then re-run."
      fi
      sudo dnf install -y \
        ffmpeg pipewire-gstreamer gstreamer1-plugins-base \
        gstreamer1-plugins-good gstreamer1-plugins-ugly \
        python3-gobject || warn "some packages failed to install"
      ;;
    pacman)
      sudo pacman -S --needed --noconfirm \
        ffmpeg gst-plugin-pipewire gst-plugins-base gst-plugins-good \
        gst-plugins-ugly python-gobject || warn "some packages failed to install"
      ;;
    zypper)
      sudo zypper install -y \
        ffmpeg gstreamer-plugins-pipewire gstreamer-plugins-base \
        gstreamer-plugins-good gstreamer-plugins-ugly \
        python3-gobject || warn "some packages failed to install"
      ;;
  esac
}

if [ "$SKIP_DEPS" = 1 ]; then
  echo "Skipping system dependencies (--no-deps)."
else
  install_deps
fi
echo

# ── 2. download the AppImage ────────────────────────────────────────────────
bold "Fetching the latest release"
command -v curl >/dev/null 2>&1 || die "curl is required."

API="https://api.github.com/repos/$REPO/releases/latest"
ASSET_URL=$(curl -fsSL "$API" 2>/dev/null \
  | grep -o '"browser_download_url": *"[^"]*\.AppImage"' \
  | head -1 | cut -d'"' -f4 || true)

if [ -z "$ASSET_URL" ]; then
  die "No published AppImage found in the latest release of $REPO.
  Check https://github.com/$REPO/releases — if there are no releases yet, there is nothing to install."
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "  $ASSET_URL"
curl -fL# "$ASSET_URL" -o "$TMP/reframe.AppImage" || die "download failed"

mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
install -m 755 "$TMP/reframe.AppImage" "$APP_PATH"
ok "installed to $APP_PATH"

# Icon, straight from the repo so we don't have to unpack the AppImage.
curl -fsSL "https://raw.githubusercontent.com/$REPO/main/assets/logo-transparent.png" \
  -o "$ICON_DIR/reframe.png" 2>/dev/null && ok "icon installed" || warn "icon download failed (cosmetic only)"

cat > "$DESKTOP_DIR/reframe.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Reframe
Comment=Screen recorder and demo editor
Exec=$APP_PATH
Icon=reframe
Terminal=false
Categories=AudioVideo;Recorder;
EOF
ok "menu entry created"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
echo

# ── 3. verify capability, not package names ─────────────────────────────────
# Probing the actual elements is the only check that stays true as package
# names change across distros and releases.
bold "Checking recording capabilities"
MISSING=0
gst_has() { command -v gst-inspect-1.0 >/dev/null 2>&1 && gst-inspect-1.0 "$1" >/dev/null 2>&1; }

if command -v ffmpeg >/dev/null 2>&1; then ok "ffmpeg"; else bad "ffmpeg (mic capture + finalize)"; MISSING=1; fi
if python3 -c "import gi; gi.require_version('Gst','1.0'); from gi.repository import Gst" >/dev/null 2>&1; then
  ok "PyGObject + GStreamer bindings"
else
  bad "PyGObject / GStreamer typelibs"; MISSING=1
fi
if gst_has pipewiresrc; then ok "pipewiresrc (screen capture)"; else bad "pipewiresrc"; MISSING=1; fi
if gst_has x264enc; then ok "x264enc (H.264 encoder)"; else bad "x264enc"; MISSING=1; fi

echo
if [ "$MISSING" = 0 ]; then
  bold "All set — cursor-hidden recording is available."
else
  bold "Reframe will run, but cursor-hidden recording is unavailable."
  echo "Everything else works: recording, editing, and MP4/GIF/WebM export."
  echo "Install the missing pieces above and re-run this script to re-check."
fi

echo
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH — add it, or launch Reframe from your app menu." ;;
esac
echo "Launch with: reframe    (or find it in your applications menu)"
echo "Uninstall:   curl -fsSL https://getreframe.vercel.app/install.sh | bash -s -- --uninstall"
