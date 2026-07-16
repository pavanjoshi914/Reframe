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

Usage:
  linux-capture.py [--restore-token-file PATH] X Y W H FPS OUT.(mkv|mp4) [MONITOR_DEVICE]

Stdout protocol:
  BACKEND mutter|portal   which route was negotiated
  SIZE <w>x<h>            actual stream size (may differ from the requested WxH)
  READY                   recording has started
  FAIL <reason>           setup failed; nothing was recorded
"""
import os
import sys
import signal
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


# ── route 1: GNOME Mutter (no dialog, exact region) ─────────────────────────
def negotiate_mutter():
    """-> (node_id, fd|None, size|None). Raises if unavailable."""
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

    opts = {
        "types": GLib.Variant("u", 1),        # 1 = MONITOR
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


def read_token():
    if not RESTORE_FILE:
        return None
    try:
        with open(RESTORE_FILE, "r") as f:
            return f.read().strip() or None
    except OSError:
        return None


def write_token(tok):
    if not RESTORE_FILE or not tok:
        return
    try:
        with open(RESTORE_FILE, "w") as f:
            f.write(tok)
    except OSError:
        pass  # a lost token only costs one extra dialog


# ── pipeline ────────────────────────────────────────────────────────────────
def build_and_start(node, fd):
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
        "pipewiresrc name=vsrc path=%d %s do-timestamp=true ! "
        "videoconvert ! videorate ! video/x-raw,framerate=%d/1 ! "
        "%s ! "
        "x264enc speed-preset=ultrafast tune=zerolatency bitrate=12000 "
        "key-int-max=%d ! queue ! mux."
        % (node, ("fd=%d" % fd) if fd is not None else "", FPS, vq, FPS)
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
for name, fn in (("mutter", negotiate_mutter), ("portal", negotiate_portal)):
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
build_and_start(node, fd)

loop.run()

if session_closer:
    session_closer()
