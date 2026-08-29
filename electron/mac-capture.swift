// mac-capture — cursor-hidden screen recording for Reframe on macOS.
//
// Why this exists: ffmpeg's avfoundation device sits on the OLD
// AVCaptureScreenInput API, whose `capturesCursor = false` is ignored on
// modern macOS (a long-standing Apple bug; Kap hit it too). So the pointer got
// baked into "hide cursor" recordings and the editor drew its synthetic cursor
// on top of a real one — two cursors, mis-aligned, read as "lag". No ffmpeg
// flag can fix that; it is the wrong API.
//
// ScreenCaptureKit is the supported replacement and its
// SCStreamConfiguration.showsCursor = false genuinely excludes the pointer.
// This helper captures the display with SCK and writes H.264 MP4 via
// AVAssetWriter (works on macOS 12.3+, no dependency on the macOS-15-only
// SCRecordingOutput).
//
// It speaks the SAME stdout/stdin protocol as the ffmpeg native backends so
// electron/main.ts drives it unchanged:
//   stdout:  "frame=N\nout_time_us=U\n"  periodically (the first one marks the
//            video's t=0 — the cursor/click clock hangs off it)
//            "ORIGIN <wall-ms> <x>,<y> <w>x<h>"  window capture only: where the
//            window is (points), at start and on every move, so the cursor
//            sidecar can be made relative to the window instead of the display
//   stdin:   "q" (or SIGINT/SIGTERM) => finalize the MP4 cleanly and exit 0
//   stderr:  diagnostics
//
// Gotchas this deliberately handles (all documented by people who shipped on
// SCK): configure the stream ONCE and never reconfigure per frame (that is
// what throttles SCK to ~7fps); start the writer session at .zero and retime
// every buffer relative to the first (else the first frame is lost); repeat the
// last frame when the screen is static (SCK only emits on change, so a still
// screen would yield a 1-frame video); scale for Retina; cap at H.264's
// 4096x2304.
//
// Usage: mac-capture <displayIndex> <fps> <out.mp4> [windowID]
//
// windowID is a CGWindowID (the number Electron puts in its "window:<id>:<n>"
// source id). When it is present and non-zero we capture THAT WINDOW ONLY,
// via SCContentFilter(desktopIndependentWindow:) — the window is composited on
// its own, so whatever is stacked on top of it never leaks into the recording
// and switching to another app doesn't change what's captured. Without it we
// capture the whole display, as before.

import Foundation
import AppKit
import ScreenCaptureKit
import AVFoundation
import CoreMedia

@available(macOS 12.3, *)
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    let outURL: URL
    let fps: Int32
    var stream: SCStream?
    var writer: AVAssetWriter?
    var input: AVAssetWriterInput?
    var firstPTS: CMTime?
    var lastPTS: CMTime = .zero
    var lastBuffer: CMSampleBuffer?
    var frames: Int = 0
    var stopping = false
    let lock = NSLock()
    var heartbeat: DispatchSourceTimer?
    var originWatch: DispatchSourceTimer?
    var lastOrigin: CGPoint?
    var winPoints: CGSize = .zero
    let queue = DispatchQueue(label: "reframe.mac-capture", qos: .userInteractive)

    init(outURL: URL, fps: Int32) {
        self.outURL = outURL
        self.fps = fps
    }

    // MARK: - start

    func start(displayIndex: Int, windowID: CGWindowID) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        let displays = content.displays
        guard !displays.isEmpty else { throw NSError(domain: "mac-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "no displays"]) }
        let display = displays[min(max(displayIndex, 0), displays.count - 1)]

        // Window capture. If the id doesn't resolve (the window closed between
        // the picker and Record) we FAIL rather than silently recording the
        // whole desktop -- main.ts then falls back to Chromium's window
        // capture, which records the right window with the cursor visible.
        // Recording everything when the user asked for one window would be a
        // privacy bug, so "no filter" is never an acceptable outcome here.
        var windowTarget: SCWindow? = nil
        if windowID != 0 {
            guard let w = content.windows.first(where: { $0.windowID == windowID }) else {
                throw NSError(domain: "mac-capture", code: 4, userInfo: [NSLocalizedDescriptionKey: "window \(windowID) not found"])
            }
            windowTarget = w
        }

        // Retina: capture at physical pixels, like the Linux/Windows paths.
        let scale = Int(NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == display.displayID })?.backingScaleFactor ?? 2)
        var w = Int((windowTarget?.frame.width).map { Double($0) } ?? Double(display.width)) * scale
        var h = Int((windowTarget?.frame.height).map { Double($0) } ?? Double(display.height)) * scale
        guard w > 0 && h > 0 else { throw NSError(domain: "mac-capture", code: 5, userInfo: [NSLocalizedDescriptionKey: "target has no size"]) }
        // H.264 ceiling; a 5K display would otherwise crash the encoder.
        let maxW = 4096, maxH = 2304
        if w > maxW || h > maxH {
            let s = min(Double(maxW) / Double(w), Double(maxH) / Double(h))
            w = Int(Double(w) * s); h = Int(Double(h) * s)
        }
        // yuv420p needs even dimensions.
        w -= w % 2; h -= h % 2

        // Stream: configured ONCE. showsCursor=false is the whole point.
        let filter = windowTarget.map { SCContentFilter(desktopIndependentWindow: $0) }
            ?? SCContentFilter(display: display, excludingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.width = w
        cfg.height = h
        cfg.showsCursor = false
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: fps)
        cfg.queueDepth = 5
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        // (No capturesAudio here: it's macOS 13+ and defaults to false anyway;
        //  system audio is recorded by the renderer, like Windows.)

        // Writer: H.264 MP4, keyframe every second (instant editor scrubbing,
        // same reasoning as the Linux/Windows paths), no B-frames-induced lag.
        let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: w,
            AVVideoHeightKey: h,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 12_000_000,
                AVVideoMaxKeyFrameIntervalKey: Int(fps),
                AVVideoExpectedSourceFrameRateKey: Int(fps),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoAllowFrameReorderingKey: false
            ]
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw NSError(domain: "mac-capture", code: 2, userInfo: [NSLocalizedDescriptionKey: "cannot add input"]) }
        writer.add(input)
        self.writer = writer
        self.input = input

        let stream = SCStream(filter: filter, configuration: cfg, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        self.stream = stream

        guard writer.startWriting() else { throw writer.error ?? NSError(domain: "mac-capture", code: 3) }
        writer.startSession(atSourceTime: .zero)

        try await stream.startCapture()
        startHeartbeat()
        // Where the window sits on screen, so the parent can normalize the
        // cursor sidecar against the WINDOW rather than the display. Re-emitted
        // whenever it moves: the user can drag the window mid-recording, and
        // every cursor sample after that has to be measured against where the
        // window actually was at that moment.
        //
        // kCGWindowBounds is in POINTS (global, top-left origin) -- the same
        // space CGEvent reports cursor locations in -- so the parent compares
        // the two series directly without any scaling.
        // (named `wt`, not `w` — `w` is the video width in pixels, above)
        if let wt = windowTarget {
            winPoints = wt.frame.size
            reportOrigin(wt.frame.origin.x, wt.frame.origin.y)
            startOriginWatch(windowID: wt.windowID)
        }
        let target = windowTarget.map { "window=\($0.windowID) \($0.title ?? "")" } ?? "display=\(display.displayID)"
        FileHandle.standardError.write("mac-capture: started \(w)x\(h)@\(fps) \(target) cursor=hidden\n".data(using: .utf8)!)
    }

    // SCK emits frames only when content changes. A static screen would give
    // us a single frame and a near-empty movie, so tick at the target fps and
    // re-append the last frame with an advanced timestamp when nothing new
    // arrived. The writer sees a steady CFR stream either way.
    func startHeartbeat() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        let interval = 1.0 / Double(fps)
        t.schedule(deadline: .now() + interval, repeating: interval)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); defer { self.lock.unlock() }
            guard !self.stopping, let first = self.firstPTS, let last = self.lastBuffer, let input = self.input, input.isReadyForMoreMediaData else { return }
            // Only fill if a real frame hasn't arrived within ~1.5 intervals.
            let now = CMClockGetTime(CMClockGetHostTimeClock())
            let sinceLast = CMTimeGetSeconds(now - first) - CMTimeGetSeconds(self.lastPTS)
            if sinceLast < interval * 1.5 { return }
            let pts = self.lastPTS + CMTime(value: 1, timescale: self.fps)
            if let dup = self.retimed(last, to: pts), input.append(dup) {
                self.lastPTS = pts
                self.frames += 1
                // Same ~1Hz cadence as real frames; don't flood stdout on a still screen.
                if self.frames % Int(self.fps) == 0 { self.report() }
            }
        }
        t.resume()
        heartbeat = t
    }

    // "ORIGIN <wall-ms> <x>,<y>" -- same line shape and same clock as the Linux
    // helper, so electron/main.ts parses one format for both platforms.
    func reportOrigin(_ x: CGFloat, _ y: CGFloat) {
        let ms = Int64(Date().timeIntervalSince1970 * 1000)
        // The trailing size is the window in POINTS. The video is in PIXELS, so
        // the parent cannot divide one by the other -- it needs the window's
        // extent in the same space the cursor is reported in, which is points.
        let sz = "\(Int(winPoints.width.rounded()))x\(Int(winPoints.height.rounded()))"
        FileHandle.standardOutput.write(
            "ORIGIN \(ms) \(Int(x.rounded())),\(Int(y.rounded())) \(sz)\n".data(using: .utf8)!)
    }

    // CGWindowListCopyWindowInfo for one window id is cheap and synchronous, so
    // a 10Hz poll costs nothing next to the capture itself. (SCShareableContent
    // would mean an async round trip per tick.)
    func startOriginWatch(windowID: CGWindowID) {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 0.1, repeating: 0.1)
        t.setEventHandler { [weak self] in
            guard let self = self, !self.stopping else { return }
            guard let info = CGWindowListCopyWindowInfo(
                    [.optionIncludingWindow], windowID) as? [[String: Any]],
                  let bounds = info.first?[kCGWindowBounds as String] as? [String: Any],
                  // The values are NSNumbers; going through NSNumber rather than
                  // casting the dictionary straight to [String: CGFloat] keeps
                  // this working regardless of how the bridge decides to behave.
                  let nx = bounds["X"] as? NSNumber,
                  let ny = bounds["Y"] as? NSNumber else { return }
            let p = CGPoint(x: CGFloat(nx.doubleValue), y: CGFloat(ny.doubleValue))
            if self.lastOrigin != p {
                self.lastOrigin = p
                self.reportOrigin(p.x, p.y)
            }
        }
        t.resume()
        originWatch = t
    }

    func retimed(_ sb: CMSampleBuffer, to pts: CMTime) -> CMSampleBuffer? {
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: fps), presentationTimeStamp: pts, decodeTimeStamp: .invalid)
        var out: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: sb, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &out)
        return out
    }

    // Progress on stdout in the ffmpeg -progress shape main.ts already parses.
    func report() {
        let us = Int64(CMTimeGetSeconds(lastPTS) * 1_000_000)
        let line = "frame=\(frames)\nout_time_us=\(us)\nprogress=continue\n"
        FileHandle.standardOutput.write(line.data(using: .utf8)!)
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sb.isValid else { return }
        // Only complete frames carry pixels; SCK also emits idle/blank status updates.
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let statusRaw = attachments.first?[.status] as? Int,
           let status = SCFrameStatus(rawValue: statusRaw), status != .complete {
            return
        }
        lock.lock(); defer { lock.unlock() }
        guard !stopping, let input = input else { return }
        let src = sb.presentationTimeStamp
        if firstPTS == nil {
            firstPTS = src
        }
        // Retime relative to the first frame so the session starting at .zero
        // keeps frame 0 (the documented first-frame-loss pitfall).
        var pts = src - firstPTS!
        // Never go backwards / collide with a heartbeat-filled frame.
        if CMTimeCompare(pts, lastPTS) <= 0 && frames > 0 {
            pts = lastPTS + CMTime(value: 1, timescale: fps)
        }
        guard input.isReadyForMoreMediaData, let rt = retimed(sb, to: pts) else { return }
        if input.append(rt) {
            lastPTS = pts
            lastBuffer = sb
            frames += 1
            if frames == 1 || frames % Int(fps) == 0 { report() }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write("mac-capture: stream stopped: \(error.localizedDescription)\n".data(using: .utf8)!)
        finish(exitCode: 2)
    }

    // MARK: - stop

    func finish(exitCode: Int32) {
        lock.lock()
        if stopping { lock.unlock(); return }
        stopping = true
        lock.unlock()
        heartbeat?.cancel()
        originWatch?.cancel()
        // Tear down off the caller's thread: this can be invoked from the capture
        // queue (didStopWithError) or a signal/stdin source, and stopCapture +
        // finishWriting are async. Blocking here on a semaphore that the Task
        // has to signal could deadlock, so hand off and exit from the Task.
        Task.detached(priority: .userInitiated) { [self] in
            try? await stream?.stopCapture()
            if let writer = writer, let input = input, writer.status == .writing {
                input.markAsFinished()
                writer.endSession(atSourceTime: lastPTS)
                await writer.finishWriting()
                if let e = writer.error { FileHandle.standardError.write("mac-capture: writer error \(e.localizedDescription)\n".data(using: .utf8)!) }
            }
            report()
            FileHandle.standardError.write("mac-capture: finished frames=\(frames)\n".data(using: .utf8)!)
            exit(exitCode)
        }
        // Safety net: never hang forever if finalize stalls.
        DispatchQueue.global().asyncAfter(deadline: .now() + 10) { exit(exitCode) }
    }
}

// MARK: - main

let args = CommandLine.arguments
guard args.count >= 4, let displayIndex = Int(args[1]), let fps = Int32(args[2]) else {
    FileHandle.standardError.write("usage: mac-capture <displayIndex> <fps> <out.mp4> [windowID]\n".data(using: .utf8)!)
    exit(64)
}
let outURL = URL(fileURLWithPath: args[3])
let windowID = CGWindowID(args.count >= 5 ? (UInt32(args[4]) ?? 0) : 0)
try? FileManager.default.removeItem(at: outURL)

guard #available(macOS 12.3, *) else {
    FileHandle.standardError.write("mac-capture: needs macOS 12.3+ (ScreenCaptureKit)\n".data(using: .utf8)!)
    exit(65)
}
let rec = Recorder(outURL: outURL, fps: fps)

// 'q' on stdin, or SIGINT/SIGTERM => clean finalize (the protocol main.ts uses).
let stdinSource = DispatchSource.makeReadSource(fileDescriptor: FileHandle.standardInput.fileDescriptor, queue: .global())
stdinSource.setEventHandler {
    let data = FileHandle.standardInput.availableData
    if data.isEmpty || String(data: data, encoding: .utf8)?.contains("q") == true { rec.finish(exitCode: 0) }
}
stdinSource.resume()
for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let s = DispatchSource.makeSignalSource(signal: sig, queue: .global())
    s.setEventHandler { rec.finish(exitCode: 0) }
    s.resume()
    _ = Unmanaged.passRetained(s) // keep alive
}

Task {
    do {
        try await rec.start(displayIndex: displayIndex, windowID: windowID)
    } catch {
        // Most likely: Screen Recording permission not granted for the app, or
        // SCK unavailable. main.ts treats a non-zero early exit as "backend
        // unavailable" and falls back to the normal cursor-included capture.
        FileHandle.standardError.write("mac-capture: failed to start: \(error.localizedDescription)\n".data(using: .utf8)!)
        exit(3)
    }
}
RunLoop.main.run()
