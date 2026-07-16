#!/usr/bin/env python3
"""
Linux hide-cursor screen capture via GNOME Mutter ScreenCast (PipeWire) + GStreamer.

Why this exists: ffmpeg's x11grab reads a stale root-window pixmap while a GPU
compositor (Chromium/Electron) is running, so rapid window switches are missed
when the cursor is hidden (-draw_mouse 0). Mutter's ScreenCast delivers the
COMPOSITED frames (always fresh) and can hide the cursor at the source, which is
what OBS / browsers' getDisplayMedia use.

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

Usage: linux-capture.py X Y W H FPS OUT.(mkv|mp4) [MONITOR_DEVICE]
Prints "READY" to stdout once recording has actually started; "FAIL <reason>"
on any setup error (so the parent can fall back to x11grab).
"""
import sys
import signal
import gi
gi.require_version("Gio", "2.0")
gi.require_version("Gst", "1.0")
from gi.repository import Gio, GLib, Gst  # noqa: E402


def fail(reason):
    sys.stdout.write("FAIL %s\n" % reason)
    sys.stdout.flush()
    sys.exit(1)


if len(sys.argv) < 7:
    fail("usage")

X, Y, W, H = (int(a) for a in sys.argv[1:5])
FPS = int(sys.argv[5])
OUT = sys.argv[6]
AUDIO_DEV = sys.argv[7] if len(sys.argv) > 7 and sys.argv[7] else None

Gst.init(None)

SC = "org.gnome.Mutter.ScreenCast"
try:
    conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
except Exception as e:  # noqa: BLE001
    fail("no-session-bus:%s" % e)


def dbus_call(path, iface, method, args_variant, reply_type):
    return conn.call_sync(
        SC, path, iface, method, args_variant,
        GLib.VariantType(reply_type) if reply_type else None,
        Gio.DBusCallFlags.NONE, -1, None,
    )


try:
    sess = dbus_call(
        "/org/gnome/Mutter/ScreenCast", SC, "CreateSession",
        GLib.Variant("(a{sv})", ({},)), "(o)",
    ).unpack()[0]
except Exception as e:  # noqa: BLE001
    fail("no-screencast:%s" % e)

loop = GLib.MainLoop()
pipeline = None
_started = {"node": None}


def build_and_start(node):
    global pipeline
    # Matroska is far more resilient than MP4 to abrupt termination and needs no
    # h264parse to frame the x264enc output; the parent remuxes it to a faststart
    # MP4 (H.264 copy, MP3 -> AAC) afterwards. .mp4 output is still supported.
    if OUT.lower().endswith((".mkv", ".webm")):
        muxer = "matroskamux name=mux"
    else:
        muxer = "mp4mux name=mux faststart=false"
    vq = "queue max-size-buffers=0 max-size-time=0 max-size-bytes=0"
    video = (
        "pipewiresrc name=vsrc path=%d do-timestamp=true ! "
        "videoconvert ! videorate ! video/x-raw,framerate=%d/1 ! "
        "%s ! "
        "x264enc speed-preset=ultrafast tune=zerolatency bitrate=12000 "
        "key-int-max=%d ! queue ! mux." % (node, FPS, vq, FPS)
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
        t = msg.type
        if t == Gst.MessageType.EOS:
            sys.stderr.write("EOS-RECEIVED\n")
            sys.stderr.flush()
            pipeline.set_state(Gst.State.NULL)
            loop.quit()
        elif t == Gst.MessageType.ERROR:
            err, dbg = msg.parse_error()
            sys.stderr.write("GST ERROR: %s | %s\n" % (err, dbg))
            sys.stderr.flush()
            pipeline.set_state(Gst.State.NULL)
            loop.quit()

    bus.connect("message", on_msg)
    if pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
        fail("pipeline-start")
    sys.stdout.write("READY\n")
    sys.stdout.flush()


def on_pw_signal(_c, _s, _p, _i, sig, params):
    if sig == "PipeWireStreamAdded" and _started["node"] is None:
        _started["node"] = params.unpack()[0]
        build_and_start(_started["node"])


try:
    props = {"cursor-mode": GLib.Variant("u", 0)}  # 0 = HIDDEN
    stream = dbus_call(
        sess, SC + ".Session", "RecordArea",
        GLib.Variant("(iiiia{sv})", (X, Y, W, H, props)), "(o)",
    ).unpack()[0]
    conn.signal_subscribe(
        None, SC + ".Stream", "PipeWireStreamAdded", stream,
        None, Gio.DBusSignalFlags.NONE, on_pw_signal,
    )
    dbus_call(sess, SC + ".Session", "Start", None, None)
except Exception as e:  # noqa: BLE001
    fail("record-area:%s" % e)


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
        # Safety net: if EOS somehow never reaches the sink, don't hang forever.
        GLib.timeout_add_seconds(5, _force_quit)
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

# Safety net: if the stream never arrives, don't hang forever.
def _no_stream_timeout():
    if _started["node"] is None:
        fail("no-stream-timeout")
    return False


GLib.timeout_add_seconds(8, _no_stream_timeout)

loop.run()

try:
    dbus_call(sess, SC + ".Session", "Stop", None, None)
except Exception:  # noqa: BLE001
    pass
