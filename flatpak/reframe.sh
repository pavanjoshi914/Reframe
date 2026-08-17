#!/bin/sh
# zypak-wrapper reconciles Electron's sandbox with Flatpak's. The GStreamer
# helper is spawned by the main process and inherits this environment.
exec zypak-wrapper /app/reframe/reframe "$@"
