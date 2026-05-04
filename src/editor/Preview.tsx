import { useEffect, useMemo, useRef } from 'react';
import { Camera } from 'lucide-react';
import { useEditor } from './store';
import { primeVideo } from './videoPrime';

const aspectMap: Record<string, number | null> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  auto: null
};

export function Preview() {
  const fileUrl = useEditor((s) => s.fileUrl);
  const webcamFileUrl = useEditor((s) => s.webcamFileUrl);
  const aspect = useEditor((s) => s.aspect);
  const playing = useEditor((s) => s.playing);
  const setCurrent = useEditor((s) => s.setCurrent);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setRecording = useEditor((s) => s.setRecording);
  const setVideoIntrinsicSize = useEditor((s) => s.setVideoIntrinsicSize);
  const recording = useEditor((s) => s.recording);
  const videoIntrinsicSize = useEditor((s) => s.videoIntrinsicSize);

  const background = useEditor((s) => s.background);
  const effects = useEditor((s) => s.effects);
  const items = useEditor((s) => s.items);
  const currentMs = useEditor((s) => s.currentMs);
  const layoutPreset = useEditor((s) => s.layoutPreset);
  const webcam = useEditor((s) => s.webcam);
  const setWebcam = useEditor((s) => s.setWebcam);

  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // Play / pause for the main video. Webcam play/pause + drift correction is
  // handled by the dedicated webcam-sync effect below — one effect owns the
  // webcam so the various playback paths don't fight each other.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      // Replay-from-end: if we hit play with the playhead parked at (or past)
      // the end, snap back to 0 first. Otherwise the knownDuration guard in
      // onTime fires on the next tick and pauses us right back.
      const { currentMs, durationMs, setCurrent } = useEditor.getState();
      if (durationMs > 0 && currentMs >= durationMs - 50) {
        v.currentTime = 0;
        setCurrent(0);
      }
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }, [playing, setPlaying]);

  // External seek: when something else (timeline scrubber, programmatic jump)
  // moves currentMs, push it onto the main video. The 100ms threshold avoids
  // the timeupdate→setCurrent→seek feedback loop that would otherwise fire
  // every frame during normal playback. The webcam catches up via the
  // dedicated sync effect (its 150ms drift threshold will trip after a scrub).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const target = currentMs / 1000;
    if (Math.abs(v.currentTime - target) > 0.1) {
      v.currentTime = target;
    }
  }, [currentMs]);

  // Webcam sync — single source of truth for the webcam <video>'s play state,
  // currentTime, and playbackRate. Looser thresholds (300ms playing / 50ms
  // paused) so we don't seek the webcam every tick: MediaRecorder-emitted
  // WebMs have sparse keyframes and frequent seeks stall the decoder, which
  // looks like the webcam (or the whole preview) hanging.
  useEffect(() => {
    const wc = webcamRef.current;
    if (!wc || !webcamFileUrl) return;
    const target = currentMs / 1000;

    const speed = items.find((it) => it.kind === 'speed' && currentMs >= it.startMs && currentMs <= it.endMs);
    const targetRate = speed?.speed ?? 1;
    if (Math.abs(wc.playbackRate - targetRate) > 0.01) wc.playbackRate = targetRate;

    if (!playing) {
      wc.pause();
      if (Math.abs(wc.currentTime - target) > 0.05) wc.currentTime = target;
      return;
    }

    // 0.3s threshold: we ride the native `timeupdate` event which only fires
    // every ~250ms, so a tighter threshold (e.g. 150ms) trips on the normal
    // gap-between-ticks and stomps the webcam mid-decode.
    if (Math.abs(wc.currentTime - target) > 0.3) wc.currentTime = target;
    wc.play().catch(() => {});
  }, [currentMs, playing, items, webcamFileUrl]);

  // Prime the webcam on its OWN loadedmetadata. MediaRecorder WebMs have
  // duration=Infinity until you phantom-seek past the file; without this the
  // webcam's seeks silently fail and playback freezes on the first frame.
  // (Previously we awaited primeVideo on webcamRef from inside the main
  // video's loadedmetadata handler — but webcam metadata usually loads later,
  // so that primeVideo timed out without ever priming anything.)
  useEffect(() => {
    const wc = webcamRef.current;
    if (!wc || !webcamFileUrl) return;
    let cancelled = false;
    const onLoaded = async () => {
      await primeVideo(wc, recording?.durationMs ?? 0);
      if (cancelled) return;
      // After priming the webcam often sits at currentTime≈huge — snap it
      // back to the current playhead so the sync effect doesn't do it for us
      // (which would race with any in-flight play()).
      wc.currentTime = currentMs / 1000;
    };
    if (wc.readyState >= 1 /* HAVE_METADATA */) {
      onLoaded();
    } else {
      wc.addEventListener('loadedmetadata', onLoaded);
    }
    return () => {
      cancelled = true;
      wc.removeEventListener('loadedmetadata', onLoaded);
    };
    // currentMs intentionally omitted — we only want to prime once per src.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webcamFileUrl, recording]);

  // Sync time + handle trim skip + apply speed via playbackRate.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const knownDuration = recording?.durationMs ?? 0;
    const onTime = () => {
      const ms = v.currentTime * 1000;

      // MediaRecorder-emitted WebMs don't have a Duration tag, so the native
      // `ended` event sometimes never fires. Use the recording metadata's
      // wall-clock duration as the authoritative end so playback doesn't
      // hang past the real end (this is what made fullscreen "freeze").
      if (knownDuration > 0 && ms >= knownDuration - 30) {
        v.pause();
        setCurrent(knownDuration);
        setPlaying(false);
        return;
      }

      const trim = items.find((it) => it.kind === 'trim' && ms >= it.startMs && ms < it.endMs);
      if (trim) {
        const t = (trim.endMs + 1) / 1000;
        v.currentTime = t;
        setCurrent(t * 1000); // surface the new time so the webcam-sync effect catches up
        return;
      }
      const speed = items.find((it) => it.kind === 'speed' && ms >= it.startMs && ms <= it.endMs);
      const targetRate = speed?.speed ?? 1;
      if (Math.abs(v.playbackRate - targetRate) > 0.01) v.playbackRate = targetRate;
      setCurrent(ms);
    };
    const onEnded = () => setPlaying(false);
    const onLoaded = async () => {
      if (v.videoWidth && v.videoHeight) {
        setVideoIntrinsicSize({ width: v.videoWidth, height: v.videoHeight });
      }
      // MediaRecorder webms ship without a real Duration in the EBML header —
      // prime the video so seek + playback work past ~halfway through the file.
      await primeVideo(v, recording?.durationMs ?? 0);
      if (webcamRef.current) {
        await primeVideo(webcamRef.current, recording?.durationMs ?? 0);
      }
      if (v.duration && isFinite(v.duration) && recording) {
        setRecording({ ...recording, durationMs: v.duration * 1000 }, fileUrl ?? '', webcamFileUrl ?? null);
      }
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    v.addEventListener('loadedmetadata', onLoaded);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [recording, fileUrl, webcamFileUrl, setRecording, setCurrent, setPlaying, setVideoIntrinsicSize, items]);

  // Active overlays.
  const activeZoom = useMemo(() => {
    return items.find((it) => it.kind === 'zoom' && currentMs >= it.startMs && currentMs <= it.endMs);
  }, [items, currentMs]);

  const activeAnnotation = useMemo(() => {
    return items.find((it) => it.kind === 'annotation' && currentMs >= it.startMs && currentMs <= it.endMs);
  }, [items, currentMs]);

  const ratio = useMemo(() => {
    if (aspect === 'auto') {
      if (videoIntrinsicSize) return videoIntrinsicSize.width / videoIntrinsicSize.height;
      return 16 / 9;
    }
    return aspectMap[aspect] ?? 16 / 9;
  }, [aspect, videoIntrinsicSize]);

  const bgStyle: React.CSSProperties =
    background.mode === 'image' && background.value
      ? { backgroundImage: `url(${background.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : background.mode === 'color'
      ? { backgroundColor: background.value }
      : background.mode === 'gradient'
      ? { backgroundImage: background.value }
      : { backgroundColor: '#0a0b0e' };

  if (effects.blurBg) {
    bgStyle.filter = 'blur(20px)';
    bgStyle.transform = 'scale(1.05)';
  }

  const padding = effects.paddingPct / 100;
  const innerScale = 1 - padding * 0.5;
  const zoomScale = activeZoom?.zoomLevel ?? 1;
  const zoomTx = activeZoom ? (0.5 - (activeZoom.zoomTargetX ?? 0.5)) * 100 * (zoomScale - 1) : 0;
  const zoomTy = activeZoom ? (0.5 - (activeZoom.zoomTargetY ?? 0.5)) * 100 * (zoomScale - 1) : 0;

  const isSideBySide = layoutPreset === 'side-by-side';

  // Webcam dragging — coords are normalized (0..1) of the OUTER stage (the
  // full canvas including the gradient padding), so the webcam sits at the
  // canvas corner regardless of the screen-recording's padded size.
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  function onWebcamDown(e: React.PointerEvent) {
    if (!stageRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: webcam.x, baseY: webcam.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onWebcamMove(e: React.PointerEvent) {
    const d = dragRef.current;
    const stage = stageRef.current;
    if (!d || !stage) return;
    const r = stage.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / r.width;
    const dy = (e.clientY - d.startY) / r.height;
    // Webcam side is `size * stageHeight` in px (height-based). As fraction
    // of width that's (size * stageHeight / stageWidth) — clamp accordingly.
    const widthInPctOfW = (webcam.size * r.height) / r.width;
    const maxX = 1 - widthInPctOfW;
    const maxY = 1 - webcam.size;
    setWebcam({
      x: Math.max(0, Math.min(maxX, d.baseX + dx)),
      y: Math.max(0, Math.min(maxY, d.baseY + dy))
    });
  }
  function onWebcamUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div
        ref={stageRef}
        className="relative flex items-center justify-center overflow-hidden rounded-xl shadow-2xl"
        style={{
          aspectRatio: String(ratio),
          width: 'auto',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%'
        }}
      >
        {/* Background — separate layer so blur doesn't touch the video. */}
        <div className="absolute inset-0" style={bgStyle} />

        {fileUrl ? (
          isSideBySide && webcam.enabled ? (
            <div
              className="relative flex items-stretch gap-3"
              style={{ width: `${innerScale * 100}%`, height: `${innerScale * 100}%` }}
            >
              <div
                className="relative flex-1 overflow-hidden"
                style={{
                  borderRadius: `${effects.roundnessPx}px`,
                  boxShadow: `0 ${4 + effects.shadowPct / 2}px ${20 + effects.shadowPct}px rgba(0,0,0,${effects.shadowPct / 100})`,
                  transform: `scale(${zoomScale}) translate(${zoomTx}%, ${zoomTy}%)`,
                  transformOrigin: 'center center'
                }}
              >
                <video ref={videoRef} src={fileUrl} className="h-full w-full object-cover" playsInline muted={false} />
              </div>
              <div
                className="relative flex shrink-0 items-center justify-center overflow-hidden bg-black/50"
                style={{
                  width: `${webcam.size * 200}%`,
                  maxWidth: '40%',
                  borderRadius: `${effects.roundnessPx}px`,
                  boxShadow: `0 ${4 + effects.shadowPct / 2}px ${20 + effects.shadowPct}px rgba(0,0,0,${effects.shadowPct / 100})`
                }}
              >
                {webcamFileUrl ? (
                  <video ref={webcamRef} src={webcamFileUrl} className="h-full w-full object-cover" playsInline muted />
                ) : (
                  <Camera size={48} className="text-white/30" />
                )}
              </div>
            </div>
          ) : (
            <>
              <div
                ref={innerRef}
                className="relative overflow-hidden transition-transform duration-300 ease-out"
                style={{
                  width: `${innerScale * 100}%`,
                  height: `${innerScale * 100}%`,
                  borderRadius: `${effects.roundnessPx}px`,
                  boxShadow: `0 ${4 + effects.shadowPct / 2}px ${20 + effects.shadowPct}px rgba(0,0,0,${effects.shadowPct / 100})`,
                  transform: `scale(${zoomScale}) translate(${zoomTx}%, ${zoomTy}%)`,
                  transformOrigin: 'center center'
                }}
              >
                <video ref={videoRef} src={fileUrl} className="h-full w-full object-cover" playsInline muted={false} />
              </div>
              {webcam.enabled && (
                <div
                  onPointerDown={onWebcamDown}
                  onPointerMove={onWebcamMove}
                  onPointerUp={onWebcamUp}
                  onPointerCancel={onWebcamUp}
                  className="absolute z-10 flex cursor-grab items-center justify-center overflow-hidden bg-black/70 ring-2 ring-white/30 active:cursor-grabbing"
                  style={{
                    left: `${webcam.x * 100}%`,
                    top: `${webcam.y * 100}%`,
                    height: `${webcam.size * 100}%`,
                    aspectRatio: '1 / 1',
                    borderRadius:
                      webcam.shape === 'circle'
                        ? '9999px'
                        : webcam.shape === 'rounded'
                        ? '16px'
                        : '0px'
                  }}
                  title="Drag to reposition"
                >
                  {webcamFileUrl ? (
                    <video ref={webcamRef} src={webcamFileUrl} className="h-full w-full object-cover" playsInline muted />
                  ) : (
                    <Camera size={Math.max(20, 64 * webcam.size)} className="text-white/40" />
                  )}
                </div>
              )}
            </>
          )
        ) : (
          <div className="relative text-sm text-white/60">No recording loaded.</div>
        )}

        {activeAnnotation && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
            <div className="max-w-[80%] rounded-lg bg-black/70 px-4 py-2 text-center text-sm font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm">
              {activeAnnotation.text || ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
