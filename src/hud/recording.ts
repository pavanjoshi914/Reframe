export type RecordingOptions = {
  sourceId: string;
  withSystemAudio: boolean;
  withMic: boolean;
  withCam: boolean;
  micDeviceId?: string;
  camDeviceId?: string;
};

export type RecordingHandle = {
  stop: () => Promise<{
    blob: Blob;
    webcamBlob?: Blob;
    durationMs: number;
    width: number;
    height: number;
    startedAt: number;
  }>;
};

export async function startRecording(opts: RecordingOptions): Promise<RecordingHandle> {
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

  const screenStream = await navigator.mediaDevices.getUserMedia(constraints);

  let combinedStream = screenStream;
  if (opts.withMic) {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: opts.micDeviceId ? { deviceId: { exact: opts.micDeviceId } } : true,
      video: false
    });
    const tracks = [...screenStream.getVideoTracks()];
    const audioTracks = [...screenStream.getAudioTracks(), ...micStream.getAudioTracks()];
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

  // Codec preference: prefer H.264 (hardware-accelerated on Linux/Intel/AMD/
  // NVIDIA), then VP8 (cheap software encode), VP9/AV1 last. VP9 software
  // encoding on Linux can't keep up with 60fps capture — frames pile up,
  // MediaRecorder writes malformed clusters, and playback freezes a few
  // seconds in. Audio codec is left implicit so the same mimeType works for
  // the audio-less webcam recorder.
  const mimeCandidates = [
    'video/webm;codecs=h264',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm;codecs=av1',
    'video/webm'
  ];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // Optional webcam — separate stream + recorder so the editor can re-position it.
  let camStream: MediaStream | null = null;
  let camRecorder: MediaRecorder | null = null;
  const camChunks: BlobPart[] = [];
  if (opts.withCam) {
    try {
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
      // 6 Mbps for the webcam — enough headroom for the encoder to produce a
      // clean stream at 480p–720p without starving and emitting the malformed
      // clusters that caused the "plays a few seconds then freezes" symptom.
      camRecorder = new MediaRecorder(camStream, { mimeType, videoBitsPerSecond: 6_000_000 });
      camRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) camChunks.push(e.data);
      };
    } catch (err) {
      console.warn('webcam capture failed; continuing without it', err);
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
      camStream?.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunks, { type: mimeType });
      const webcamBlob = camChunks.length > 0 ? new Blob(camChunks, { type: mimeType }) : undefined;
      return {
        blob,
        webcamBlob,
        durationMs: Date.now() - startedAt,
        width,
        height,
        startedAt
      };
    }
  };
}
