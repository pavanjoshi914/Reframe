#!/usr/bin/env python3
"""
Linux hide-cursor screen capture: PipeWire ScreenCast -> H.264, via GStreamer.

Why this exists: ffmpeg's x11grab reads the X11 root pixmap, which a GPU
compositor (Chromium/Electron) leaves STALE, so rapid window switches never make
it into the file. A ScreenCast delivers the COMPOSITED frames (always fresh) and
hides the cursor at the source — the same approach OBS and getDisplayMedia take.

Two ways to obtain that stream; we try them in order:

  1. org.gnome.Mutter.ScreenCast — GNOME only, but needs NO user interaction and
     can record an exact region. The fast path for GNOME sessions.
  2. org.freedesktop.portal.ScreenCast — the desktop-agnostic XDG portal (GNOME,
     KDE, wlroots...). Shows a source picker, so we ask for persist_mode and
     store the returned restore_token: the dialog appears ONCE, and later
     recordings reuse the token silently. The portal hands back a whole
     monitor rather than an arbitrary region, so the negotiated size is
     reported to the parent via a SIZE= line.

Pipeline: pipewiresrc (composited, cursor hidden) -> CFR videorate -> H.264
(x264enc), plus an OPTIONAL PulseAudio source (the system-output monitor) ->
MP3, muxed into Matroska (resilient to abrupt termination; the parent remuxes it
to a faststart MP4). The monitor shares PipeWire's clock domain, so it stays in
perfect sync with the video without the PulseAudio drift the old ffmpeg path
suffered from.

NB: only the system-output monitor may be captured here. A microphone is a
SEPARATE hardware capture clock and deadlocks against pipewiresrc in one
pipeline, so the parent records the mic with a separate process and muxes it in.

A real EOS is injected into every source on SIGTERM/SIGINT so the file
finalizes cleanly.

Capturing ONE WINDOW (--window-xid) takes a different route: GStreamer's
ximagesrc reads that window's own redirected drawable, so occluding windows and
app switching cannot leak in, and show-pointer=false omits the cursor. Neither
Mutter's ScreenCast (RecordWindow needs a window id from Shell.Introspect, which
GNOME refuses to non-allowlisted callers) nor the portal can do this without a
dialog on X11. Wayland has no X drawable to read, so it falls through to the
portal's own window chooser (types=WINDOW), which restore_token then makes
dialog-free from the second recording on.

Usage:
  linux-capture.py [--restore-token-file PATH] [--window-xid XID] \
                   X Y W H FPS OUT.(mkv|mp4) [MONITOR_DEVICE]

Stdout protocol:
  BACKEND mutter|portal|ximage  which route was negotiated
  SIZE <w>x<h>            actual stream size (may differ from the requested WxH)
  ORIGIN <ms> <x>,<y>     window route only: the window's top-left on screen at
                          wall-clock <ms>. Emitted at start and again on every
                          move, so the parent can normalize each cursor sample
                          against where the window actually was at that moment
  READY                   recording has started
  FAIL <reason>           setup failed; nothing was recorded
"""
import os
import sys
import signal
import socket
import subprocess
import time
import gi
gi.require_version("Gio", "2.0")
gi.require_version("Gst", "1.0")
from gi.repository import Gio, GLib, Gst  # noqa: E402


def say(line):
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _forced_backend():
    # REFRAME_SCREENCAST_BACKEND=mutter|portal pins the route. Without it we try
    # mutter then portal. Mainly exists so the portal path can be exercised on a
    # GNOME box, where mutter would otherwise always win.
    b = os.environ.get("REFRAME_SCREENCAST_BACKEND")
    return b if b in ("mutter", "portal") else None


def fail(reason):
    say("FAIL %s" % reason)
    sys.exit(1)


# ── args ────────────────────────────────────────────────────────────────────
argv = sys.argv[1:]
RESTORE_FILE = None
if "--restore-token-file" in argv:
    i = argv.index("--restore-token-file")
    try:
        RESTORE_FILE = argv[i + 1]
    except IndexError:
        fail("usage")
    del argv[i:i + 2]

# --window-xid <decimal>: capture ONE window instead of a screen region. The
# value is the X11 window id, which is exactly what Electron puts in its
# "window:<id>:<n>" desktopCapturer source id on Linux (verified: Electron's
# window:71303172:0 == xwininfo's 0x4400004).
WINDOW_XID = None
if "--window-xid" in argv:
    i = argv.index("--window-xid")
    try:
        WINDOW_XID = int(argv[i + 1])
    except (IndexError, ValueError):
        fail("usage")
    del argv[i:i + 2]

if len(argv) < 6:
    fail("usage")

X, Y, W, H = (int(a) for a in argv[0:4])
FPS = int(argv[4])
OUT = argv[5]
AUDIO_DEV = argv[6] if len(argv) > 6 and argv[6] else None

Gst.init(None)

try:
    conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
except Exception as e:  # noqa: BLE001
    fail("no-session-bus:%s" % e)

loop = GLib.MainLoop()
pipeline = None
session_closer = None  # callable that tears the ScreenCast session down


# ── route 0: X11 single window (no dialog, no PipeWire) ─────────────────────
_X = {"lib": None, "dpy": None, "handler": None, "errors": 0, "reported": 0}


def _x11():
    """Lazily open a private Xlib connection. -> (lib, dpy) or (None, None)."""
    if _X["dpy"] is None:
        try:
            import ctypes
            import ctypes.util
            name = ctypes.util.find_library("X11")
            if not name:
                return None, None
            lib = ctypes.CDLL(name)
            lib.XOpenDisplay.restype = ctypes.c_void_p
            dpy = lib.XOpenDisplay(None)
            if not dpy:
                return None, None
            _X["lib"], _X["dpy"] = lib, dpy
        except Exception:  # noqa: BLE001
            return None, None
    return _X["lib"], _X["dpy"]


def install_x_error_guard():
    """Stop Xlib from killing the process on a window that changed under us.

    ximagesrc grabs the window with XShmGetImage. If the window is resized (or
    closed) mid-recording the next grab is a BadMatch, and Xlib's DEFAULT error
    handler calls exit() -- taking the process down before the muxer can write
    its index. Measured: a resize 3s into a capture left a file with 20 frames
    in it, the rest still buffered in matroskamux and lost with the process.

    Xlib's error handler is a process-wide function pointer, so installing one
    here also covers the grabs ximagesrc makes on its own thread. Swallowing the
    error is right on its own merits too: dragging a window past a screen edge
    clips it and fails every grab until it comes back, which must not end a
    recording. watch_window() decides when to stop, from the geometry.
    """
    import ctypes
    lib, _dpy = _x11()
    if lib is None:
        return
    handler_t = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)

    def on_error(_d, _e):
        _X["errors"] += 1
        return 0

    _X["handler"] = handler_t(on_error)  # must outlive the call
    lib.XSetErrorHandler(_X["handler"])


def x11_window_geometry(xid):
    """(x, y, w, h) of `xid` in absolute physical X pixels, or None."""
    import ctypes
    lib, dpy = _x11()
    if lib is None:
        return None
    try:
        lib.XDefaultRootWindow.restype = ctypes.c_ulong
        lib.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
        root = lib.XDefaultRootWindow(ctypes.c_void_p(dpy))
        r = ctypes.c_ulong()
        gx, gy = ctypes.c_int(), ctypes.c_int()
        gw, gh = ctypes.c_uint(), ctypes.c_uint()
        bw, depth = ctypes.c_uint(), ctypes.c_uint()
        lib.XGetGeometry.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
            ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
            ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint),
            ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint),
        ]
        if not lib.XGetGeometry(
                ctypes.c_void_p(dpy), ctypes.c_ulong(xid), ctypes.byref(r),
                ctypes.byref(gx), ctypes.byref(gy), ctypes.byref(gw),
                ctypes.byref(gh), ctypes.byref(bw), ctypes.byref(depth)):
            return None
        if gw.value == 0 or gh.value == 0:
            return None
        dx, dy, child = ctypes.c_int(), ctypes.c_int(), ctypes.c_ulong()
        lib.XTranslateCoordinates.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong,
            ctypes.c_int, ctypes.c_int,
            ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
            ctypes.POINTER(ctypes.c_ulong),
        ]
        if not lib.XTranslateCoordinates(
                ctypes.c_void_p(dpy), ctypes.c_ulong(xid), root, 0, 0,
                ctypes.byref(dx), ctypes.byref(dy), ctypes.byref(child)):
            return None
        return dx.value, dy.value, gw.value, gh.value
    except Exception:  # noqa: BLE001
        return None


_origin = {"at": None}


def say_origin(x, y):
    # Wall-clock ms, the same clock the parent stamps cursor samples with, so
    # the two series can be lined up without any handshake.
    say("ORIGIN %d %d,%d" % (time.time() * 1000, x, y))


def watch_window(xid, size):
    """Finalize cleanly if the captured window is resized or disappears.

    ximagesrc is pinned to the size negotiated at PLAYING and cannot follow a
    resize -- and x264enc can't change resolution mid-stream either, so there is
    nothing to renegotiate to. Ending the recording at that moment with a valid
    file is the best available outcome, and far better than the process dying
    with most of the video still in the muxer.
    """
    def tick():
        if pipeline is None:
            return False
        # X errors are NOT a reason to stop. Dragging a window past a screen
        # edge clips it, and XShmGetImage on the clipped window fails for as
        # long as it stays there -- a completely normal thing for a user to do.
        # The guard keeps those from killing the process; ximagesrc simply
        # repeats its last frame until the window is fully on screen again.
        # Only a real size change or the window disappearing ends the recording,
        # and both are detected from the geometry below.
        if _X["errors"] != _X.get("reported", 0):
            _X["reported"] = _X["errors"]
            sys.stderr.write("X-ERROR-IGNORED n=%d (window clipped?)\n" % _X["errors"])
            sys.stderr.flush()
        geo = x11_window_geometry(xid)
        if geo is None:
            sys.stderr.write("WINDOW-GONE -> finalizing\n")
            sys.stderr.flush()
            request_stop()
            return False
        if (geo[2] - geo[2] % 2, geo[3] - geo[3] % 2) != size:
            sys.stderr.write("WINDOW-RESIZED %dx%d -> finalizing\n" % (geo[2], geo[3]))
            sys.stderr.flush()
            request_stop()
            return False
        # A MOVE is harmless to the capture (ximagesrc reads the window's own
        # drawable, not a screen region) but it does move the frame of reference
        # the parent normalizes cursor samples into. Report it, timestamped, so
        # the sidecar can use the origin that was in effect at each sample.
        if (geo[0], geo[1]) != _origin["at"]:
            _origin["at"] = (geo[0], geo[1])
            say_origin(geo[0], geo[1])
        return True

    # 100ms: fast enough that a resize is normally caught before ximagesrc's
    # next grab fails, and the error guard covers the times it isn't.
    GLib.timeout_add(100, tick)


def x11_window_origin(xid):
    """Absolute top-left of `xid` on screen, in physical X pixels, or None."""
    geo = x11_window_geometry(xid)
    return (geo[0], geo[1]) if geo else None


def negotiate_ximage():
    """Cursor-hidden capture of ONE X11 window. -> ('ximage', xid).

    ximagesrc's `xid` property reads that window's own drawable. Under a
    compositing WM (GNOME Shell always composites) the window is redirected to
    an offscreen pixmap, so this returns the window's OWN pixels: anything
    stacked on top is absent, and switching to another app does not change what
    is recorded. Verified by covering the target with a second window mid-capture
    -- the recorded frames never showed the window on top.

    `show-pointer=false` drops the pointer. This is the whole reason the route
    exists: neither Mutter's ScreenCast nor the portal can hand back a single
    window on X11 without a dialog, and Chromium's window capture always bakes
    the pointer in. Measured on a solid-colour probe window with the pointer
    parked over it: show-pointer=false gave 0 foreign pixels, true gave 204.

    Works for XWayland windows too when DISPLAY is set, which is why the check
    is "is there an X display and does the id resolve", not "is the session X11".
    """
    if WINDOW_XID is None:
        raise RuntimeError("no-window-requested")
    if not os.environ.get("DISPLAY"):
        raise RuntimeError("no-x-display")
    if Gst.ElementFactory.find("ximagesrc") is None:
        raise RuntimeError("no-ximagesrc")
    # Before ANY grab happens, including the probe below.
    install_x_error_guard()

    # Probe the window before committing: bring a throwaway ximagesrc to PAUSED
    # and read the negotiated caps. This both proves the XID still resolves (a
    # window closed between the picker and Record fails HERE, cheaply, instead
    # of after the user thinks recording started) and gives us the size, which
    # nothing else on the window path knows -- Electron reports no bounds for
    # window sources, which is why the old code fell back to a whole display.
    probe = Gst.parse_launch("ximagesrc xid=%d ! fakesink name=fs" % WINDOW_XID)
    try:
        if probe.set_state(Gst.State.PAUSED) == Gst.StateChangeReturn.FAILURE:
            raise RuntimeError("window-%d-unavailable" % WINDOW_XID)
        probe.get_state(3 * Gst.SECOND)
        caps = probe.get_by_name("fs").get_static_pad("sink").get_current_caps()
        if caps is None or caps.get_size() == 0:
            raise RuntimeError("window-%d-no-caps" % WINDOW_XID)
        st = caps.get_structure(0)
        ok_w, w = st.get_int("width")
        ok_h, h = st.get_int("height")
        if not (ok_w and ok_h and w > 0 and h > 0):
            raise RuntimeError("window-%d-no-size" % WINDOW_XID)
    finally:
        probe.set_state(Gst.State.NULL)
    return "ximage", WINDOW_XID, (w - w % 2, h - h % 2)


# ── route 1: GNOME Mutter (no dialog, exact region) ─────────────────────────
# ── PipeWire liveness ───────────────────────────────────────────────────────
# Both ScreenCast routes below (Mutter and the portal) only negotiate the
# session over D-Bus; the FRAMES come over PipeWire, so neither works without
# pipewire.service. When it is missing, Mutter fails with
# "Failed to start screen cast: Couldn't connect pipewire context", the portal
# fails the same way a moment later, and the recorder falls back to a capture
# with the pointer baked in.
#
# Which happened on a stock Ubuntu GNOME box: pipewire.service lost a race at
# login, systemd's restart limiter latched after 5 rapid attempts ("Start
# request repeated too quickly", exit 234) and it stayed dead for the entire
# session. Audio was unaffected because PulseAudio was serving it, so there was
# no symptom anywhere a user would look — only screen recordings quietly losing
# cursor hiding, hours later.
#
# Nothing about that is the user's to diagnose, and the recovery is two
# commands. So try them, once, rather than degrading silently.


def _pipewire_ready():
    """True when a client could actually connect.

    Testing for the socket FILE is not enough: it outlives the service. Stopping
    pipewire.service leaves /run/user/<uid>/pipewire-0 sitting on disk with
    nothing listening, so its presence proves nothing — checking for it made
    this function claim everything was fine on a box where PipeWire was dead.
    Connect instead, which is what a real client does; if the socket unit is
    alive it will even socket-activate the service for us.
    """
    rt = os.environ.get("XDG_RUNTIME_DIR")
    if not rt:
        return False
    path = os.path.join(rt, "pipewire-0")
    if not os.path.exists(path):
        return False
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(0.5)
    try:
        sock.connect(path)
        return True
    except OSError:
        return False
    finally:
        sock.close()


_pw_attempted = False


def ensure_pipewire(timeout=5.0):
    """Best-effort revival of a dead pipewire.service. -> True if usable.

    reset-failed is the part that matters: without it systemd refuses to start a
    unit that has tripped its restart limiter, so `start` alone does nothing.
    Tried at most once per run, and every failure is ignored — this is a nicety
    on the way to recording, never a reason not to record.
    """
    global _pw_attempted
    if _pipewire_ready():
        return True
    if _pw_attempted:
        return False
    _pw_attempted = True
    for args in (["reset-failed", "pipewire.socket", "pipewire"],
                 ["start", "pipewire.socket", "pipewire"]):
        try:
            subprocess.run(["systemctl", "--user"] + args,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=5, check=False)
        except Exception:  # noqa: BLE001
            return False
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _pipewire_ready():
            # Visible in the parent's log, so this leaves a trace instead of
            # looking like it spontaneously started working.
            say("PIPEWIRE revived")
            return True
        time.sleep(0.2)
    return False


def negotiate_mutter():
    """-> (node_id, fd|None, size|None). Raises if unavailable."""
    ensure_pipewire()
    SC = "org.gnome.Mutter.ScreenCast"

    def call(path, iface, method, args, reply_type):
        return conn.call_sync(
            SC, path, iface, method, args,
            GLib.VariantType(reply_type) if reply_type else None,
            Gio.DBusCallFlags.NONE, -1, None,
        )

    sess = call("/org/gnome/Mutter/ScreenCast", SC, "CreateSession",
                GLib.Variant("(a{sv})", ({},)), "(o)").unpack()[0]
    props = {"cursor-mode": GLib.Variant("u", 0)}  # 0 = HIDDEN
    stream = call(sess, SC + ".Session", "RecordArea",
                  GLib.Variant("(iiiia{sv})", (X, Y, W, H, props)), "(o)").unpack()[0]

    # The node id arrives asynchronously; pump a temporary loop until it does.
    got = {"node": None}
    inner = GLib.MainLoop()

    def on_added(_c, _s, _p, _i, sig, params):
        if sig == "PipeWireStreamAdded" and got["node"] is None:
            got["node"] = params.unpack()[0]
            inner.quit()

    sub = conn.signal_subscribe(None, SC + ".Stream", "PipeWireStreamAdded",
                                stream, None, Gio.DBusSignalFlags.NONE, on_added)
    call(sess, SC + ".Session", "Start", None, None)
    GLib.timeout_add_seconds(6, lambda: (inner.quit(), False)[1])
    inner.run()
    conn.signal_unsubscribe(sub)

    if got["node"] is None:
        try:
            call(sess, SC + ".Session", "Stop", None, None)
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError("no-stream")

    def close():
        try:
            call(sess, SC + ".Session", "Stop", None, None)
        except Exception:  # noqa: BLE001
            pass

    global session_closer
    session_closer = close
    return got["node"], None, None


# ── route 2: XDG portal (any desktop; dialog once, then restore_token) ──────
PORTAL = "org.freedesktop.portal.Desktop"
PORTAL_PATH = "/org/freedesktop/portal/desktop"
PORTAL_SC = "org.freedesktop.portal.ScreenCast"


def negotiate_portal():
    """-> (node_id, fd, size). Raises if unavailable/denied."""
    ensure_pipewire()
    # Requests reply on a path derived from our bus name + a token we choose;
    # subscribing to the PREDICTED path before calling avoids missing a fast reply.
    sender = conn.get_unique_name()[1:].replace(".", "_")
    counter = {"n": 0}

    def request(method, args_before, options):
        counter["n"] += 1
        token = "reframe%d" % counter["n"]
        options["handle_token"] = GLib.Variant("s", token)
        req_path = "%s/request/%s/%s" % (PORTAL_PATH, sender, token)

        out = {}
        inner = GLib.MainLoop()

        def on_response(_c, _s, _p, _i, _sig, params):
            resp, results = params.unpack()
            out["response"] = resp
            out["results"] = results
            inner.quit()

        sub = conn.signal_subscribe(PORTAL, "org.freedesktop.portal.Request",
                                    "Response", req_path, None,
                                    Gio.DBusSignalFlags.NONE, on_response)
        conn.call_sync(PORTAL, PORTAL_PATH, PORTAL_SC, method,
                       GLib.Variant(args_before[0], args_before[1] + (options,)),
                       GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, -1, None)
        # Generous: the first call may be waiting on a human clicking the picker.
        GLib.timeout_add_seconds(120, lambda: (inner.quit(), False)[1])
        inner.run()
        conn.signal_unsubscribe(sub)

        if out.get("response") != 0:
            raise RuntimeError("%s-response-%s" % (method, out.get("response")))
        return out["results"]

    res = request("CreateSession", ("(a{sv})", ()),
                  {"session_handle_token": GLib.Variant("s", "reframe")})
    session = res["session_handle"]

    # The portal genuinely supports window capture -- AvailableSourceTypes is a
    # bitmask and GNOME reports 3 (MONITOR|WINDOW). Asking for WINDOW makes the
    # portal show its own window chooser, so the user picks a second time; the
    # restore_token makes every later recording of that window dialog-free.
    # This is the Wayland answer, where ximagesrc can't see native windows.
    opts = {
        "types": GLib.Variant("u", 2 if WINDOW_XID is not None else 1),  # 2=WINDOW 1=MONITOR
        "multiple": GLib.Variant("b", False),
        "cursor_mode": GLib.Variant("u", 1),  # 1 = HIDDEN
        "persist_mode": GLib.Variant("u", 2),  # 2 = persist until revoked
    }
    saved = read_token()
    if saved:
        opts["restore_token"] = GLib.Variant("s", saved)
    request("SelectSources", ("(oa{sv})", (session,)), opts)

    res = request("Start", ("(osa{sv})", (session, "")), {})

    # A fresh token is issued whenever the portal feels like it; always re-save.
    if "restore_token" in res:
        write_token(res["restore_token"])

    streams = res.get("streams") or []
    if not streams:
        raise RuntimeError("no-streams")
    node_id, props = streams[0][0], streams[0][1]
    size = tuple(props["size"]) if "size" in props else None

    # The portal streams over its own PipeWire connection, handed to us as an fd.
    reply, fdlist = conn.call_with_unix_fd_list_sync(
        PORTAL, PORTAL_PATH, PORTAL_SC, "OpenPipeWireRemote",
        GLib.Variant("(oa{sv})", (session, {})),
        GLib.VariantType("(h)"), Gio.DBusCallFlags.NONE, -1, None, None,
    )
    fd = fdlist.get(reply.unpack()[0])

    def close():
        try:
            conn.call_sync(PORTAL, session, "org.freedesktop.portal.Session",
                           "Close", None, None, Gio.DBusCallFlags.NONE, -1, None)
        except Exception:  # noqa: BLE001
            pass

    global session_closer
    session_closer = close
    return node_id, fd, size


def token_file():
    # A monitor token and a window token are not interchangeable -- restoring a
    # monitor token while asking for types=WINDOW makes the portal ignore the
    # restore and re-prompt (or hand back the wrong kind of stream). Keep them
    # in separate files, keyed by the window so each window restores its own.
    if not RESTORE_FILE:
        return None
    if WINDOW_XID is None:
        return RESTORE_FILE
    return "%s.window-%d" % (RESTORE_FILE, WINDOW_XID)


def read_token():
    RESTORE_FILE = token_file()
    if not RESTORE_FILE:
        return None
    try:
        with open(RESTORE_FILE, "r") as f:
            return f.read().strip() or None
    except OSError:
        return None


def write_token(tok):
    RESTORE_FILE = token_file()
    if not RESTORE_FILE or not tok:
        return
    try:
        with open(RESTORE_FILE, "w") as f:
            f.write(tok)
    except OSError:
        pass  # a lost token only costs one extra dialog


# ── H.264 encoder selection ─────────────────────────────────────────────────
# Which encoder exists depends on how Reframe was installed, so pick at runtime
# rather than hardcoding one:
#   x264enc      gst-plugins-ugly — what the .deb pulls in, and the best quality
#   avenc_h264   gst-libav, needs the ffmpeg libs (Flatpak + ffmpeg-full)
#   openh264enc  always present in the GNOME runtime; the safety net
# Property names differ between them, hence a fragment per encoder rather than a
# bare element name.
H264_ENCODERS = (
    ("x264enc", "x264enc speed-preset=ultrafast tune=zerolatency bitrate=12000 key-int-max=%(kf)d"),
    ("avenc_h264", "avenc_h264 bitrate=12000000 gop-size=%(kf)d"),
    ("openh264enc", "openh264enc bitrate=12000000 gop-size=%(kf)d complexity=low"),
)


def pick_h264_encoder(fps):
    for name, fragment in H264_ENCODERS:
        if Gst.ElementFactory.find(name) is not None:
            say("ENCODER %s" % name)
            return fragment % {"kf": fps}
    fail("no-h264-encoder")


# ── pipeline ────────────────────────────────────────────────────────────────
def video_source(node, fd, size):
    """The source half of the pipeline, up to (not including) videoconvert.

    Named `vsrc` either way so request_stop()'s per-element EOS injection --
    which is what actually finalizes the file for a LIVE source -- works
    unchanged for both routes.
    """
    if node == "ximage":
        # use-damage=false forces a full grab every tick. With damage on, a
        # window that isn't repainting emits nothing and the encoder starves,
        # which is the same one-frame trap pipewiresrc's framerate=0/1 sets.
        #
        # endx/endy (inclusive, window-relative when xid is set) trim the odd
        # last row/column: H.264 4:2:0 needs even dimensions and a window can be
        # any size at all.
        return ("ximagesrc name=vsrc xid=%d show-pointer=false use-damage=false "
                "endx=%d endy=%d" % (fd, size[0] - 1, size[1] - 1))
    return ("pipewiresrc name=vsrc path=%d %s do-timestamp=true"
            % (node, ("fd=%d" % fd) if fd is not None else ""))


def build_and_start(node, fd, size):
    global pipeline
    # Matroska is far more resilient than MP4 to abrupt termination and needs no
    # h264parse to frame the x264enc output; the parent remuxes it to a faststart
    # MP4 (H.264 copy, MP3 -> AAC) afterwards. .mp4 output is still supported.
    if OUT.lower().endswith((".mkv", ".webm")):
        muxer = "matroskamux name=mux"
    else:
        muxer = "mp4mux name=mux faststart=false"
    vq = "queue max-size-buffers=0 max-size-time=0 max-size-bytes=0"
    # pipewiresrc advertises framerate=0/1 (variable); x264enc and the muxers
    # collapse that to a SINGLE frame, so videorate pins it to CFR.
    video = (
        "%s ! "
        "videoconvert ! videorate ! video/x-raw,framerate=%d/1 ! "
        "%s ! "
        "%s ! queue ! mux."
        % (video_source(node, fd, size), FPS, vq, pick_h264_encoder(FPS))
    )
    audio = ""
    if AUDIO_DEV:
        audio = (
            'pulsesrc name=asrc device="%s" provide-clock=false ! '
            "audioconvert ! audioresample ! queue ! "
            "lamemp3enc bitrate=192 ! queue ! mux." % AUDIO_DEV
        )
    desc = '%s ! filesink location="%s" %s %s' % (muxer, OUT, video, audio)
    try:
        pipeline = Gst.parse_launch(desc)
    except Exception as e:  # noqa: BLE001
        fail("pipeline-parse:%s" % e)

    bus = pipeline.get_bus()
    bus.add_signal_watch()

    def on_msg(_bus, msg):
        if msg.type == Gst.MessageType.EOS:
            sys.stderr.write("EOS-RECEIVED\n")
            sys.stderr.flush()
            pipeline.set_state(Gst.State.NULL)
            loop.quit()
        elif msg.type == Gst.MessageType.ERROR:
            err, dbg = msg.parse_error()
            sys.stderr.write("GST ERROR: %s | %s\n" % (err, dbg))
            sys.stderr.flush()
            pipeline.set_state(Gst.State.NULL)
            loop.quit()

    bus.connect("message", on_msg)
    if pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
        fail("pipeline-start")
    say("READY")


# ── stop ────────────────────────────────────────────────────────────────────
def request_stop():
    # Inject EOS directly into every live source so the muxer sees EOS on all its
    # sink pads and flushes/finalizes the file. Sending EOS to the pipeline as a
    # whole does NOT reliably propagate through a live pipewiresrc.
    sys.stderr.write("STOP-REQUESTED\n")
    sys.stderr.flush()
    if pipeline is not None:
        sent = False
        it = pipeline.iterate_sources()
        while True:
            ok, el = it.next()
            if ok != Gst.IteratorResult.OK:
                break
            el.send_event(Gst.Event.new_eos())
            sent = True
        if not sent:
            pipeline.send_event(Gst.Event.new_eos())
        GLib.timeout_add_seconds(5, _force_quit)  # never hang on a stuck EOS
    else:
        loop.quit()
    return False  # one-shot


def _force_quit():
    sys.stderr.write("FORCE-QUIT (EOS timed out)\n")
    sys.stderr.flush()
    if pipeline is not None:
        pipeline.set_state(Gst.State.NULL)
    loop.quit()
    return False


GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGTERM, request_stop)
GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGINT, request_stop)


# ── main ────────────────────────────────────────────────────────────────────
errors = []
node = fd = size = None
backend = None
# A window request goes to ximagesrc first (no dialog, uses the window the user
# already picked) and falls back to the portal's own window chooser, which is the
# only route that reaches native Wayland windows. Mutter's ScreenCast is skipped:
# its RecordWindow needs a window id from org.gnome.Shell.Introspect.GetWindows(),
# and GNOME answers "GetWindows is not allowed" to anything off its allowlist.
ROUTES = (
    (("ximage", negotiate_ximage), ("portal", negotiate_portal))
    if WINDOW_XID is not None
    else (("mutter", negotiate_mutter), ("portal", negotiate_portal))
)
for name, fn in ROUTES:
    if _forced_backend() not in (None, name):
        continue
    try:
        node, fd, size = fn()
        backend = name
        break
    except Exception as e:  # noqa: BLE001
        errors.append("%s:%s" % (name, e))

if backend is None:
    fail("no-screencast (%s)" % "; ".join(errors))

say("BACKEND %s" % backend)
if size:
    say("SIZE %dx%d" % (size[0], size[1]))
if backend == "ximage":
    # Where the captured window sits on screen, so the parent can normalize the
    # cursor sidecar against the WINDOW instead of the display. Re-emitted by
    # watch_window() whenever the user moves the window.
    origin = x11_window_origin(WINDOW_XID)
    if origin:
        _origin["at"] = origin
        say_origin(*origin)
build_and_start(node, fd, size)
if backend == "ximage":
    watch_window(WINDOW_XID, size)

loop.run()

if session_closer:
    session_closer()
