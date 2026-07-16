export type RecordingOptions = {
  sourceId: string;
  withSystemAudio: boolean;
  withMic: boolean;
  withCam: boolean;
  // When true, capture the screen WITHOUT the OS cursor (via getDisplayMedia
  // cursor:'never') so the editor's synthetic smooth cursor can replace it.
  // Falls back to the normal cursor-included capture if that path fails.
  hideCursor?: boolean;
  micDeviceId?: string;
  camDeviceId?: string;
  // Optional pre-opened webcam stream. The HUD opens this when the user
  // toggles the cam icon (so the camera LED turns on right away) and hands
  // it in here so we don't re-prompt or blink the LED off/on at record time.
  // When provided, the recorder treats the stream as borrowed — it records
  // from it but does NOT stop the tracks on `stop()`; the caller owns the
  // stream's lifecycle.
  camStream?: MediaStream | null;
};

import fixWebmDuration from 'fix-webm-duration';

export type RecordingHandle = {
  stop: () => Promise<{
    // Exactly one of `blob` (Chromium MediaRecorder path) or `screenFilePath`
    // (cursor-hidden path — the file already exists on disk) is set.
    blob?: Blob;
    screenFilePath?: string;
    webcamBlob?: Blob;
    durationMs: number;
    width: number;
    height: number;
    startedAt: number;
  }>;
};

// MediaRecorder writes streaming WebM with no Duration element in the header,
// so HTMLVideoElement.duration reads as Infinity and seeking/currentTime are
// unreliable everywhere downstream (editor preview + export). Patch the real
// duration into the EBML header right after recording so every consumer gets
// a well-formed file. No-op (returns the blob untouched) for non-WebM blobs.
async function repairWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.type.includes('webm') || durationMs <= 0) return blob;
  try {
    return await fixWebmDuration(blob, durationMs, { logger: false });
  } catch (err) {
    console.warn('[recording] fixWebmDuration failed, using unrepaired blob', err);
    return blob;
  }
}

// Codec choice for MediaRecorder (screen AND webcam — one mimeType drives both).
//
// H.264 in MP4 on macOS/Windows: there the OS gives Chromium a HARDWARE H.264
// encoder (VideoToolbox / Media Foundation), so encoding costs almost no CPU and
// holds frame rate on high-resolution displays. VP8 has no hardware encoder
// anywhere and is encoded in software, which is what starves the frame rate on
// Retina and 4K screens.
//
// The container matters as much as the codec. H.264 must go in MP4, NEVER in
// WebM: MediaRecorder will happily produce `video/webm;codecs=h264`, but
// Chromium's <video> cannot reliably demux that non-standard combination — it
// decodes a fraction of a second then declares the clip "ended", which made the
// editor preview flaky and broke export (the exporter plays the recording
// through a <video> to composite frames). H.264-in-MP4 is the standard pairing:
// duration, seeking and playback are all sound, and MP4 carries its own duration
// so it needs no fixWebmDuration repair.
//
// Linux keeps VP8/WebM. Chromium there usually has no hardware H.264 encoder and
// falls back to software, so switching would risk a regression with nothing to
// gain — and the cursor-hidden path doesn't use MediaRecorder at all (it goes
// through the PipeWire helper in the main process). VP8-in-WebM is the most
// battle-tested combo in Chromium; VP9 is the fallback. The audio codec is left
// implicit so the same mimeType also works for the audio-less webcam recorder.
function pickMime(): string {
  const hwH264 = window.api.platform === 'darwin' || window.api.platform === 'win32';
  const candidates = [
    ...(hwH264 ? ['video/mp4;codecs=avc1.42E01E'] : []),
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm'
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}

// Open a webcam recorder (used by both capture paths). Borrows a pre-opened
// preview stream when provided; otherwise opens + owns one. Returns null (and
// stops any stream it opened) if the camera can't be captured — recording is
// never blocked by a webcam failure.
async function openWebcam(
  opts: RecordingOptions,
  mimeType: string
): Promise<{ recorder: MediaRecorder; chunks: BlobPart[]; stream: MediaStream; owns: boolean } | null> {
  let stream = opts.camStream ?? null;
  const owns = !opts.camStream;
  try {
    if (!stream) {
      const camVideoConstraints: MediaTrackConstraints = {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 30, max: 30 },
        ...(opts.camDeviceId ? { deviceId: { exact: opts.camDeviceId } } : {})
      };
      stream = await navigator.mediaDevices.getUserMedia({ video: camVideoConstraints, audio: false });
    }
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    return { recorder, chunks, stream, owns };
  } catch (err) {
    console.warn('webcam capture failed; continuing without it', err);
    if (owns) stream?.getTracks().forEach((t) => t.stop());
    return null;
  }
}

// Cursor-hidden capture path (Linux): the screen (+ system/mic audio) is
// captured by the PipeWire ScreenCast helper in the main process with the OS
// cursor omitted; only the webcam is recorded here in the renderer. See
// electron/main.ts ffcap:start.
async function startHelperRecording(
  opts: RecordingOptions,
  started: { width: number; height: number }
): Promise<RecordingHandle> {
  const mimeType = pickMime();
  const cam = opts.withCam ? await openWebcam(opts, mimeType) : null;
  const startedAt = Date.now();
  cam?.recorder.start(1000);

  return {
    async stop() {
      const stoppedCam = cam
        ? new Promise<void>((resolve) => { cam.recorder.onstop = () => resolve(); })
        : Promise.resolve();
      cam?.recorder.stop();
      await stoppedCam;
      if (cam?.owns) cam.stream.getTracks().forEach((t) => t.stop());

      const ff = await window.api.ffcapStop();
      const durationMs = ff?.durationMs ?? Date.now() - startedAt;
      const rawWebcamBlob = cam && cam.chunks.length > 0 ? new Blob(cam.chunks, { type: mimeType }) : undefined;
      const webcamBlob = rawWebcamBlob ? await repairWebmDuration(rawWebcamBlob, durationMs) : undefined;

      return {
        screenFilePath: ff?.filePath,
        webcamBlob,
        durationMs,
        width: ff?.width ?? started.width,
        height: ff?.height ?? started.height,
        startedAt
      };
    }
  };
}

export async function startRecording(opts: RecordingOptions): Promise<RecordingHandle> {
  // Linux + "Hide cursor": capture the screen via a PipeWire ScreenCast in the
  // main process — the only reliable way to omit the OS cursor on X11
  // (Chromium's getDisplayMedia cursor:'never' is silently ignored there). If
  // no ScreenCast is available, fall through to the normal path.
  if (opts.hideCursor && window.api.platform === 'linux') {
    try {
      await window.api.setPendingCaptureSource(opts.sourceId);
      const started = await window.api.ffcapStart({
        withSystemAudio: !!opts.withSystemAudio,
        withMic: !!opts.withMic
      });
      if (started?.ok) return await startHelperRecording(opts, started);
      console.warn('[recording] cursor-hidden capture unavailable; using normal capture');
    } catch (err) {
      console.warn('[recording] cursor-hidden capture failed; using normal capture', err);
    }
  }

  const constraints: any = {
    audio: opts.withSystemAudio
      ? {
          mandatory: {
            chromeMediaSource: 'desktop'
          }
        }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: opts.sourceId,
        minWidth: 1280,
        maxWidth: 3840,
        minHeight: 720,
        maxHeight: 2160,
        minFrameRate: 30,
        maxFrameRate: 60
      }
    }
  };

  // Cursor-hidden capture (opt-in): grab the screen via getDisplayMedia with
  // cursor:'never'. main's display-media handler resolves it to the source the
  // user already picked (no OS picker). We try with system audio, then without,
  // then fall back to the normal cursor-included getUserMedia path — so a
  // failure here never prevents a recording.
  let screenStream: MediaStream | null = null;
  if (opts.hideCursor) {
    try {
      await window.api.setPendingCaptureSource(opts.sourceId);
      const gdm = (withAudio: boolean) =>
        navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'never', width: { max: 3840 }, height: { max: 2160 }, frameRate: { max: 60 } },
          audio: withAudio
        } as DisplayMediaStreamOptions);
      try {
        screenStream = await gdm(!!opts.withSystemAudio);
      } catch {
        screenStream = await gdm(false);
      }
    } catch (err) {
      console.warn('[recording] cursor-hidden capture failed; using normal capture', err);
      screenStream = null;
    }
  }
  if (!screenStream) {
    screenStream = await navigator.mediaDevices.getUserMedia(constraints);
  }

  let combinedStream = screenStream;
  if (opts.withMic) {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: opts.micDeviceId ? { deviceId: { exact: opts.micDeviceId } } : true,
      video: false
    });
    const tracks: MediaStreamTrack[] = [...screenStream.getVideoTracks()];
    const audioTracks: MediaStreamTrack[] = [...screenStream.getAudioTracks(), ...micStream.getAudioTracks()];
    if (audioTracks.length > 0) {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      audioTracks.forEach((t) => {
        const src = ctx.createMediaStreamSource(new MediaStream([t]));
        src.connect(dest);
      });
      tracks.push(...dest.stream.getAudioTracks());
    }
    combinedStream = new MediaStream(tracks);
  }

  const settings = screenStream.getVideoTracks()[0].getSettings();
  const width = settings.width ?? 1920;
  const height = settings.height ?? 1080;

  const mimeType = pickMime();

  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // Optional webcam — separate stream + recorder so the editor can re-position it.
  // If the caller already opened a preview stream (`opts.camStream`) we borrow
  // it; otherwise we open one ourselves and own its lifecycle.
  let camStream: MediaStream | null = opts.camStream ?? null;
  const ownsCamStream = !opts.camStream;
  let camRecorder: MediaRecorder | null = null;
  const camChunks: BlobPart[] = [];
  if (opts.withCam) {
    try {
      if (!camStream) {
        // Cap webcam at 30fps so the software encoder isn't doing 60fps on the
        // cam in addition to whatever the screen recorder is doing.
        const camVideoConstraints: MediaTrackConstraints = {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 30 },
          ...(opts.camDeviceId ? { deviceId: { exact: opts.camDeviceId } } : {})
        };
        camStream = await navigator.mediaDevices.getUserMedia({
          video: camVideoConstraints,
          audio: false
        });
      }
      // 6 Mbps for the webcam — enough headroom for the encoder to produce a
      // clean stream at 480p–720p without starving and emitting the malformed
      // clusters that caused the "plays a few seconds then freezes" symptom.
      camRecorder = new MediaRecorder(camStream, { mimeType, videoBitsPerSecond: 6_000_000 });
      camRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) camChunks.push(e.data);
      };
    } catch (err) {
      console.warn('webcam capture failed; continuing without it', err);
      if (ownsCamStream) camStream?.getTracks().forEach((t) => t.stop());
      camStream = null;
      camRecorder = null;
    }
  }

  const startedAt = Date.now();
  recorder.start(1000);
  camRecorder?.start(1000);

  return {
    async stop() {
      const stoppedScreen = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      const stoppedCam = camRecorder
        ? new Promise<void>((resolve) => { camRecorder!.onstop = () => resolve(); })
        : Promise.resolve();

      recorder.stop();
      camRecorder?.stop();
      await Promise.all([stoppedScreen, stoppedCam]);

      combinedStream.getTracks().forEach((t) => t.stop());
      screenStream.getTracks().forEach((t) => t.stop());
      // Only stop tracks on a stream we own; a borrowed preview stream keeps
      // running so the camera LED stays lit between sessions.
      if (ownsCamStream) camStream?.getTracks().forEach((t) => t.stop());

      const durationMs = Date.now() - startedAt;
      const rawBlob = new Blob(chunks, { type: mimeType });
      const rawWebcamBlob = camChunks.length > 0 ? new Blob(camChunks, { type: mimeType }) : undefined;

      // Repair both files' duration headers before handing them off.
      const blob = await repairWebmDuration(rawBlob, durationMs);
      const webcamBlob = rawWebcamBlob
        ? await repairWebmDuration(rawWebcamBlob, durationMs)
        : undefined;

      return {
        blob,
        webcamBlob,
        durationMs,
        width,
        height,
        startedAt
      };
    }
  };
}
