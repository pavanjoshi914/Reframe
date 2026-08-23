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
// Usage: mac-capture <displayIndex> <fps> <out.mp4>

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
    let queue = DispatchQueue(label: "reframe.mac-capture", qos: .userInteractive)

    init(outURL: URL, fps: Int32) {
        self.outURL = outURL
        self.fps = fps
    }

    // MARK: - start

    func start(displayIndex: Int) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        let displays = content.displays
        guard !displays.isEmpty else { throw NSError(domain: "mac-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "no displays"]) }
        let display = displays[min(max(displayIndex, 0), displays.count - 1)]

        // Retina: capture at physical pixels, like the Linux/Windows paths.
        let scale = Int(NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == display.displayID })?.backingScaleFactor ?? 2)
        var w = display.width * scale
        var h = display.height * scale
        // H.264 ceiling; a 5K display would otherwise crash the encoder.
        let maxW = 4096, maxH = 2304
        if w > maxW || h > maxH {
            let s = min(Double(maxW) / Double(w), Double(maxH) / Double(h))
            w = Int(Double(w) * s); h = Int(Double(h) * s)
        }
        // yuv420p needs even dimensions.
        w -= w % 2; h -= h % 2

        // Stream: configured ONCE. showsCursor=false is the whole point.
        let filter = SCContentFilter(display: display, excludingWindows: [])
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
        FileHandle.standardError.write("mac-capture: started \(w)x\(h)@\(fps) display=\(display.displayID) cursor=hidden\n".data(using: .utf8)!)
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
    FileHandle.standardError.write("usage: mac-capture <displayIndex> <fps> <out.mp4>\n".data(using: .utf8)!)
    exit(64)
}
let outURL = URL(fileURLWithPath: args[3])
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
        try await rec.start(displayIndex: displayIndex)
    } catch {
        // Most likely: Screen Recording permission not granted for the app, or
        // SCK unavailable. main.ts treats a non-zero early exit as "backend
        // unavailable" and falls back to the normal cursor-included capture.
        FileHandle.standardError.write("mac-capture: failed to start: \(error.localizedDescription)\n".data(using: .utf8)!)
        exit(3)
    }
}
RunLoop.main.run()
