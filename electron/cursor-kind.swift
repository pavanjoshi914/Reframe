// cursor-kind — reports which SYSTEM CURSOR is showing, on macOS.
//
// Companion to electron/cursor-kind.py (X11) and cursor-kind.ps1 (Windows);
// all three speak the same one-line protocol so electron/main.ts drives them
// identically:
//
//   stdout: "<epoch_ms> <kind>" on every CHANGE (and once at startup)
//           kind ∈ default | text | pointer | grab | crosshair | wait
//
// Why this is awkward on macOS: AppKit will tell you WHAT the current
// system-wide cursor looks like, but not WHICH cursor it is. NSCursor carries
// no identity — there is no `.kind`, and reference equality against
// NSCursor.iBeam always fails because the accessor hands back a fresh object
// every call. The only thing you get is the image and the hotspot.
//
// So we fingerprint: build an index of the known cursors' TIFF representations
// once at startup, then match the live cursor against it. Keying on
// (byte count, hotspot) rather than hashing the full TIFF keeps the poll cheap
// — the arrow's TIFF alone is ~200KB, and hashing that at 20Hz for no reason
// would be silly. Collisions between cursors we don't distinguish anyway
// (openHand/closedHand share a size) are harmless because they map to the same
// kind.
//
//
// Usage: cursor-kind [--interval-ms N]

import AppKit
import Foundation

let args = CommandLine.arguments
var intervalMs = 50
if let i = args.firstIndex(of: "--interval-ms"), i + 1 < args.count,
   let v = Int(args[i + 1]) {
    intervalMs = max(16, v)
}
// A shape must hold this long before it's reported: crossing a window edge can
// flick through several cursors in a couple of frames, and emitting those would
// make the editor's synthetic pointer strobe.
let debounceMs = 110.0

// Cursors we can name, most specific first. Several map to one kind on purpose.
func knownCursors() -> [(String, NSCursor)] {
    var list: [(String, NSCursor)] = [
        ("text", .iBeam),
        ("text", .iBeamCursorForVerticalLayout),
        ("pointer", .pointingHand),
        ("grab", .openHand),
        ("grab", .closedHand),
        ("grab", .resizeLeftRight),
        ("grab", .resizeUpDown),
        ("crosshair", .crosshair),
        ("default", .arrow),
    ]
    if #available(macOS 10.13, *) { list.append(("default", .operationNotAllowed)) }
    return list
}

// (tiff byte count, hotspot x, hotspot y) -> kind.
func buildIndex() -> [String: String] {
    var index: [String: String] = [:]
    for (kind, cursor) in knownCursors() {
        guard let tiff = cursor.image.tiffRepresentation else { continue }
        let key = "\(tiff.count)|\(Int(cursor.hotSpot.x.rounded()))|\(Int(cursor.hotSpot.y.rounded()))"
        // First writer wins, so the ordering above decides ties.
        if index[key] == nil { index[key] = kind }
    }
    return index
}

func currentCursor() -> NSCursor? {
    // `currentSystemCursor` is a hard rename to `currentSystem` in current SDKs
    // (the old name is an error, not a deprecation), and `currentSystem` has
    // been available since 10.6 — so there is nothing to branch on.
    return NSCursor.currentSystem
}

let index = buildIndex()
FileHandle.standardError.write("cursor-kind: indexed \(index.count) cursors\n".data(using: .utf8)!)

var last: String? = nil
var pending: String? = nil
var pendingSince = Date()
var first = true

func say(_ kind: String) {
    let ms = Int64(Date().timeIntervalSince1970 * 1000)
    FileHandle.standardOutput.write("\(ms) \(kind)\n".data(using: .utf8)!)
}

// SIGTERM/SIGINT just end the process; the parent has everything it needs.
signal(SIGPIPE, SIG_IGN)

let timer = Timer(timeInterval: Double(intervalMs) / 1000.0, repeats: true) { _ in
    var kind = "default"
    if let c = currentCursor(), let tiff = c.image.tiffRepresentation {
        let key = "\(tiff.count)|\(Int(c.hotSpot.x.rounded()))|\(Int(c.hotSpot.y.rounded()))"
        // Anything unrecognised (app-supplied custom cursors, resize handles we
        // don't model) stays "default" rather than guessing.
        if let k = index[key] { kind = k }
    }
    let now = Date()
    if kind != pending {
        pending = kind
        pendingSince = now
    }
    if kind != last && (first || now.timeIntervalSince(pendingSince) * 1000 >= debounceMs) {
        last = kind
        first = false
        say(kind)
    }
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
