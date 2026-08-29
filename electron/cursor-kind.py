#!/usr/bin/env python3
"""
Reports which SYSTEM CURSOR is showing, so the editor can swap its synthetic
pointer between an arrow, a text I-beam and a pointing hand the way the real
one did — the thing that makes a demo read as "clicking a link" or "selecting
text" rather than "an arrow moved".

The cursor's SHAPE is not recoverable from the video (we deliberately record
with the pointer hidden), and it isn't in the position samples either, so it
has to be captured live alongside them.

X11 route: XFixesGetCursorImage() hands back the current cursor's image, its
hotspot, and — for cursors loaded from the Xcursor theme by name — an Atom
naming it ("xterm", "hand2", "text", "pointer", ...). Toolkits (GTK, Qt,
Chromium, Electron) all load by name, so in practice the name is there for the
cursors that matter. When it isn't, the hotspot disambiguates the common case:
an arrow is the only standard cursor whose hotspot sits at its very corner.

Wayland has no equivalent — a client cannot read another client's cursor — so
this simply reports nothing there and the editor falls back to a fixed style.

Usage:  cursor-kind.py [--interval-ms N]
Stdout: "<epoch_ms> <kind>" on every CHANGE (plus one line at startup).
        kind is one of: default | text | pointer | grab | crosshair | wait
"""
import ctypes
import ctypes.util
import os
import sys
import time


class XFixesCursorImage(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_short), ("y", ctypes.c_short),
        ("width", ctypes.c_ushort), ("height", ctypes.c_ushort),
        ("xhot", ctypes.c_ushort), ("yhot", ctypes.c_ushort),
        ("cursor_serial", ctypes.c_ulong),
        ("pixels", ctypes.POINTER(ctypes.c_ulong)),
        # XFixes >= 2. Present in every shipping libXfixes; `atom` is 0 when the
        # cursor wasn't created from a named theme cursor.
        ("atom", ctypes.c_ulong), ("name", ctypes.c_char_p),
    ]


# Xcursor theme names -> the kinds the editor knows how to draw. Both the
# freedesktop names ("text", "pointer") and the legacy X11 ones ("xterm",
# "hand2") are in use depending on the toolkit and theme, so map both.
NAME_KINDS = {
    "xterm": "text", "text": "text", "ibeam": "text", "vertical-text": "text",
    "hand": "pointer", "hand1": "pointer", "hand2": "pointer",
    "pointer": "pointer", "pointing_hand": "pointer",
    "grab": "grab", "grabbing": "grab", "openhand": "grab", "closedhand": "grab",
    "fleur": "grab", "move": "grab", "all-scroll": "grab",
    "crosshair": "crosshair", "cross": "crosshair", "tcross": "crosshair",
    "watch": "wait", "wait": "wait", "progress": "wait",
    "left_ptr_watch": "wait", "half-busy": "wait",
    "left_ptr": "default", "default": "default", "arrow": "default",
    "top_left_arrow": "default",
}

INTERVAL_MS = 50
# A shape must HOLD this long before we report it. Crossing a window edge or a
# toolbar can flick through two or three cursors in a couple of frames, and
# emitting those would make the editor's synthetic pointer strobe. Nothing a
# viewer can register lasts under ~100ms.
DEBOUNCE_MS = 110
if "--interval-ms" in sys.argv:
    try:
        INTERVAL_MS = max(16, int(sys.argv[sys.argv.index("--interval-ms") + 1]))
    except (IndexError, ValueError):
        pass


def classify(ci):
    """Identify an UNNAMED cursor from its bitmap.

    The name path covers GTK/Qt apps, which load theme cursors by name — but
    Chromium and Electron ship their own bitmaps and set them with no name at
    all. Since those are exactly the apps people record, geometry has to carry
    the common case, and it separates the three that matter cleanly:

                   ink     hotspot            aspect  fill
        arrow     13x20    at the tip corner   1.54   0.58
        I-beam     8x17    centred             2.13   0.62
        hand      17x17    top-centre          1.00   0.93

    Measured off live Chromium. The hotspot is the strongest signal: only an
    arrow points from its own corner, and only an I-beam sits in the middle of a
    tall narrow glyph. Fill separates a hand (a solid blob) from a crosshair
    (thin lines) which otherwise look alike — both squarish.
    """
    w, h = ci.width, ci.height
    if w <= 0 or h <= 0:
        return "default"
    n = w * h
    xs0, xs1, ys0, ys1, opaque = w, -1, h, -1, 0
    for i in range(n):
        if ((ci.pixels[i] >> 24) & 0xFF) > 40:
            x, y = i % w, i // w
            opaque += 1
            if x < xs0: xs0 = x
            if x > xs1: xs1 = x
            if y < ys0: ys0 = y
            if y > ys1: ys1 = y
    if xs1 < 0:
        return "default"
    bw, bh = xs1 - xs0 + 1, ys1 - ys0 + 1
    aspect = bh / float(bw)
    fill = opaque / float(bw * bh)
    rx = (ci.xhot - xs0) / float(bw)
    ry = (ci.yhot - ys0) / float(bh)
    # Tall, narrow, gripped in the middle -> text caret.
    if aspect >= 1.7 and 0.2 <= rx <= 0.8 and 0.25 <= ry <= 0.75:
        return "text"
    # Points from its own corner -> arrow.
    if rx <= 0.28 and ry <= 0.28:
        return "default"
    # Squarish and SOLID, held near the top -> pointing hand.
    if 0.6 <= aspect <= 1.5 and ry <= 0.5 and fill >= 0.5:
        return "pointer"
    # Squarish and SPARSE, held dead centre -> crosshair.
    if 0.7 <= aspect <= 1.4 and fill < 0.4 and 0.3 <= rx <= 0.7 and 0.3 <= ry <= 0.7:
        return "crosshair"
    return "default"


def say(kind):
    sys.stdout.write("%d %s\n" % (time.time() * 1000, kind))
    sys.stdout.flush()


def main():
    if not os.environ.get("DISPLAY"):
        # Wayland (or no X): nothing to read. Exit quietly; the parent treats a
        # helper that produced no lines as "no cursor-kind data".
        return 0
    x11n = ctypes.util.find_library("X11")
    xfn = ctypes.util.find_library("Xfixes")
    if not x11n or not xfn:
        return 0
    X = ctypes.CDLL(x11n)
    F = ctypes.CDLL(xfn)
    X.XOpenDisplay.restype = ctypes.c_void_p
    X.XOpenDisplay.argtypes = [ctypes.c_char_p]
    dpy = X.XOpenDisplay(None)
    if not dpy:
        return 0
    ev, er = ctypes.c_int(), ctypes.c_int()
    F.XFixesQueryExtension.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int),
                                       ctypes.POINTER(ctypes.c_int)]
    if not F.XFixesQueryExtension(ctypes.c_void_p(dpy), ctypes.byref(ev), ctypes.byref(er)):
        return 0
    F.XFixesGetCursorImage.restype = ctypes.POINTER(XFixesCursorImage)
    F.XFixesGetCursorImage.argtypes = [ctypes.c_void_p]
    X.XGetAtomName.restype = ctypes.c_char_p
    X.XGetAtomName.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    X.XFree.argtypes = [ctypes.c_void_p]

    # cursor_serial identifies a cursor without re-reading its name, so the
    # expensive path (atom lookup) only runs when the cursor actually changed.
    serial_kinds = {}
    last = None            # last kind actually reported
    pending = None         # kind seen but not yet held long enough
    pending_since = 0.0
    period = INTERVAL_MS / 1000.0
    first = True
    while True:
        p = F.XFixesGetCursorImage(ctypes.c_void_p(dpy))
        if p:
            ci = p.contents
            serial = ci.cursor_serial
            kind = serial_kinds.get(serial)
            if kind is None:
                nm = None
                if ci.atom:
                    a = X.XGetAtomName(ctypes.c_void_p(dpy), ctypes.c_ulong(ci.atom))
                    if a:
                        nm = a.decode("utf-8", "replace").strip().lower()
                if not nm and ci.name:
                    nm = ci.name.decode("utf-8", "replace").strip().lower()
                if nm:
                    kind = NAME_KINDS.get(nm, NAME_KINDS.get(nm.replace("_", "-"), "default"))
                else:
                    kind = classify(ci)
                serial_kinds[serial] = kind
            now = time.time()
            if kind != pending:
                pending, pending_since = kind, now
            if kind != last and (first or (now - pending_since) * 1000 >= DEBOUNCE_MS):
                last = kind
                first = False
                say(kind)
            X.XFree(ctypes.cast(p, ctypes.c_void_p))
        time.sleep(period)


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("cursor-kind: %s\n" % e)
        sys.exit(1)
