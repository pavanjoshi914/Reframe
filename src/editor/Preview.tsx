import { useEffect, useMemo, useRef } from 'react';
import { Camera } from 'lucide-react';
import { useEditor, ANNOTATION_DEFAULTS } from './store';
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
  const selectedItemId = useEditor((s) => s.selectedItemId);
  const updateItem = useEditor((s) => s.updateItem);
  const selectItem = useEditor((s) => s.selectItem);
  const selectedZoom = useMemo(() => {
    if (!selectedItemId) return null;
    const it = items.find((i) => i.id === selectedItemId);
    return it && it.kind === 'zoom' ? it : null;
  }, [selectedItemId, items]);

  const videoVolume = useEditor((s) => s.videoVolume);
  const videoMuted = useEditor((s) => s.videoMuted);
  const cropRegion = useEditor((s) => s.cropRegion);

  // Crop is implemented as: oversize the video element so the cropped region
  // fills its overflow:hidden parent, then translate the rest off-frame. The
  // math maps each source pixel to a fraction of the parent box and assumes
  // the parent has the *crop's* aspect ratio (see cropFrameStyle below),
  // hence object-fit:fill — cover would re-crop and break the mapping.
  const cropStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${-(cropRegion.x / cropRegion.width) * 100}%`,
    top: `${-(cropRegion.y / cropRegion.height) * 100}%`,
    width: `${100 / cropRegion.width}%`,
    height: `${100 / cropRegion.height}%`,
    // Tailwind preflight applies `video { max-width: 100% }` globally, which
    // silently clamps a >100% width and breaks the crop math — undo it.
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'fill'
  };

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

  // Publish the live <video> ref into the store so overlays (CropModal,
  // future thumbnail extractors) can read frames from the same already-primed
  // element the editor is using. Re-runs whenever videoRef target changes
  // (layout swap between side-by-side and standard re-mounts the element).
  useEffect(() => {
    useEditor.getState().setMainVideoEl(videoRef.current);
    return () => { useEditor.getState().setMainVideoEl(null); };
  });

  // Mirror the user's volume/mute preference onto the main video element.
  // Webcam stays permanently muted (mic audio comes from the main recording).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = videoVolume;
    v.muted = videoMuted;
  }, [videoVolume, videoMuted]);

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
      // Webcam recordings often have a black warm-up frame at t=0 (camera
      // sensor is still settling). When parked at the very start, show a
      // slightly later frame as the visible preview — much friendlier than a
      // black circle. Once playback runs from 0, currentMs increments past
      // this offset within a couple of frames so it doesn't look like a jump.
      const previewTarget =
        currentMs === 0
          ? Math.min(0.15, (recording?.durationMs ?? 0) / 1000 / 20)
          : target;
      if (Math.abs(wc.currentTime - previewTarget) > 0.05) wc.currentTime = previewTarget;
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

  // Sync playbackRate against the active speed item on every playhead move
  // (not only on the native `timeupdate` event, which fires ~every 250ms and
  // missed short speed regions entirely). Runs whenever `items` or
  // `currentMs` changes, so adjusting a speed item from the sidebar takes
  // effect immediately rather than waiting for the next timeupdate.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const ms = currentMs;
    const active = items.find(
      (it) => it.kind === 'speed' && ms >= it.startMs && ms <= it.endMs
    );
    const targetRate = active?.speed ?? 1;
    if (Math.abs(v.playbackRate - targetRate) > 0.01) {
      v.playbackRate = targetRate;
    }
  }, [currentMs, items]);

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

  // Aspect ratio of the cropped sub-rectangle in source pixels. The rounded
  // clipping frame is sized to this ratio and centered inside the project
  // frame (letterbox/pillarbox), matching openscreen's PixiJS mask layout —
  // the crop reshapes the visible content area, it doesn't stretch to fill.
  const cropAspect = videoIntrinsicSize
    ? (cropRegion.width * videoIntrinsicSize.width) /
      (cropRegion.height * videoIntrinsicSize.height)
    : ratio;
  // Pick the constraining axis: wider crop than project → fit width;
  // taller crop than project → fit height. `aspect-ratio` then derives
  // the other dimension.
  const cropFrameStyle: React.CSSProperties = {
    aspectRatio: String(cropAspect),
    width: cropAspect >= ratio ? '100%' : 'auto',
    height: cropAspect >= ratio ? 'auto' : '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: `${effects.roundnessPx}px`,
    boxShadow: `0 ${4 + effects.shadowPct / 2}px ${20 + effects.shadowPct}px rgba(0,0,0,${effects.shadowPct / 100})`
  };

  const zoomScale = activeZoom?.zoomLevel ?? 1;
  const zoomTx = activeZoom ? (0.5 - (activeZoom.zoomTargetX ?? 0.5)) * 100 * (zoomScale - 1) : 0;
  const zoomTy = activeZoom ? (0.5 - (activeZoom.zoomTargetY ?? 0.5)) * 100 * (zoomScale - 1) : 0;

  const isSideBySide = layoutPreset === 'side-by-side';

  // Webcam container aspect (width/height). Rectangle uses 16:9 to match the
  // typical webcam intrinsic; square and circle stay 1:1. Used both to size
  // the box and to clamp drag bounds.
  const webcamAspect = webcam.shape === 'rectangle' ? 16 / 9 : 1;

  // Clamp the saved x/y back into the frame whenever shape / size / project
  // aspect change. Without this, switching from a 1:1 shape parked in the
  // bottom-right to rectangle would leave the wider box overflowing the stage.
  useEffect(() => {
    if (!webcam.enabled) return;
    const widthFrac = (webcam.size * webcamAspect) / ratio;
    const maxX = Math.max(0, 1 - widthFrac);
    const maxY = Math.max(0, 1 - webcam.size);
    if (webcam.x > maxX || webcam.y > maxY) {
      setWebcam({ x: Math.min(webcam.x, maxX), y: Math.min(webcam.y, maxY) });
    }
  }, [webcam.shape, webcam.size, ratio, webcam.enabled, webcam.x, webcam.y, webcamAspect, setWebcam]);

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
    // Webcam height is `size * stageHeight`. Width = height * aspect. Convert
    // both to fractions of the stage axes so dragging clamps to the canvas.
    const widthInPctOfW = (webcam.size * webcamAspect * r.height) / r.width;
    const maxX = 1 - widthInPctOfW;
    const maxY = 1 - webcam.size;
    setWebcam({
      x: Math.max(0, Math.min(maxX, d.baseX + dx)),
      y: Math.max(0, Math.min(maxY, d.baseY + dy))
    });
  }
  // Annotation dragging — same coord system as webcam (normalised 0..1 of the
  // stage). We track centre-of-text positions so the annotation reads "at
  // (posX, posY)" intuitively, matching how the exporter places it.
  const annDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; id: string } | null>(null);
  function onAnnotationDown(e: React.PointerEvent, item: NonNullable<typeof activeAnnotation>) {
    if (!stageRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    selectItem(item.id);
    annDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: item.posX ?? ANNOTATION_DEFAULTS.posX,
      baseY: item.posY ?? ANNOTATION_DEFAULTS.posY,
      id: item.id
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onAnnotationMove(e: React.PointerEvent) {
    const d = annDragRef.current;
    const stage = stageRef.current;
    if (!d || !stage) return;
    const r = stage.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / r.width;
    const dy = (e.clientY - d.startY) / r.height;
    updateItem(d.id, {
      posX: Math.max(0.05, Math.min(0.95, d.baseX + dx)),
      posY: Math.max(0.05, Math.min(0.95, d.baseY + dy))
    });
  }
  function onAnnotationUp(e: React.PointerEvent) {
    if (!annDragRef.current) return;
    annDragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function onWebcamUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  // Focus crosshair drag — converts pointer position on the stage to a
  // (zoomTargetX, zoomTargetY) pair in the unzoomed-inner reference frame.
  // The crosshair sits in stage coordinates so it's unaffected by an active
  // zoom transform on the inner div; users can drag freely whether or not
  // the playhead is currently inside the zoom region.
  const focusDragRef = useRef(false);
  function pointerToFocus(clientX: number, clientY: number): { x: number; y: number } | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const r = stage.getBoundingClientRect();
    const stageX = (clientX - r.left) / r.width;
    const stageY = (clientY - r.top) / r.height;
    const pad = (1 - innerScale) / 2;
    const innerX = (stageX - pad) / innerScale;
    const innerY = (stageY - pad) / innerScale;
    return { x: Math.max(0, Math.min(1, innerX)), y: Math.max(0, Math.min(1, innerY)) };
  }
  function onFocusDown(e: React.PointerEvent) {
    if (!selectedZoom) return;
    e.stopPropagation();
    e.preventDefault();
    focusDragRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const f = pointerToFocus(e.clientX, e.clientY);
    if (f) updateItem(selectedZoom.id, { zoomTargetX: f.x, zoomTargetY: f.y });
  }
  function onFocusMove(e: React.PointerEvent) {
    if (!focusDragRef.current || !selectedZoom) return;
    const f = pointerToFocus(e.clientX, e.clientY);
    if (f) updateItem(selectedZoom.id, { zoomTargetX: f.x, zoomTargetY: f.y });
  }
  function onFocusUp(e: React.PointerEvent) {
    if (!focusDragRef.current) return;
    focusDragRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }
  const focusLeftPct = selectedZoom
    ? ((1 - innerScale) / 2 + (selectedZoom.zoomTargetX ?? 0.5) * innerScale) * 100
    : 0;
  const focusTopPct = selectedZoom
    ? ((1 - innerScale) / 2 + (selectedZoom.zoomTargetY ?? 0.5) * innerScale) * 100
    : 0;

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
                className="relative flex flex-1 items-center justify-center"
                style={{
                  transform: `scale(${zoomScale}) translate(${zoomTx}%, ${zoomTy}%)`,
                  transformOrigin: 'center center'
                }}
              >
                {/* Crop frame — see comment on the standard-layout branch. */}
                <div className="relative overflow-hidden" style={cropFrameStyle}>
                  <video ref={videoRef} src={fileUrl} style={cropStyle} playsInline muted={false} />
                </div>
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
                className="relative flex items-center justify-center transition-transform duration-[400ms] ease-out"
                style={{
                  width: `${innerScale * 100}%`,
                  height: `${innerScale * 100}%`,
                  transform: `scale(${zoomScale}) translate(${zoomTx}%, ${zoomTy}%)`,
                  transformOrigin: 'center center'
                }}
              >
                {/* Crop frame — sized to the crop's aspect ratio and
                    centered inside the project frame (letterbox/pillarbox).
                    Rounded corners and shadow live here so they hug the
                    visible cropped content, not the unused background. */}
                <div className="relative overflow-hidden" style={cropFrameStyle}>
                  <video ref={videoRef} src={fileUrl} style={cropStyle} playsInline muted={false} />
                </div>
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
                    aspectRatio: String(webcamAspect),
                    // Circle = full pill; square + rectangle share the same
                    // soft 16px corner so the only visual difference between
                    // them is the aspect ratio.
                    borderRadius: webcam.shape === 'circle' ? '9999px' : '16px'
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

        {activeAnnotation && (() => {
          const item = activeAnnotation;
          const posX = item.posX ?? ANNOTATION_DEFAULTS.posX;
          const posY = item.posY ?? ANNOTATION_DEFAULTS.posY;
          const bg = item.backgroundColor === null ? null : (item.backgroundColor ?? ANNOTATION_DEFAULTS.backgroundColor);
          const textColor = item.textColor ?? ANNOTATION_DEFAULTS.textColor;
          const fontFamily = item.fontFamily ?? ANNOTATION_DEFAULTS.fontFamily;
          const bold = item.bold ?? ANNOTATION_DEFAULTS.bold;
          const italic = item.italic ?? ANNOTATION_DEFAULTS.italic;
          const textAlign = item.textAlign ?? ANNOTATION_DEFAULTS.textAlign;
          // Scale the px size against the rendered stage so what the user
          // sees in the preview matches the export (which scales against the
          // output height). Stage height ≈ stageRef.current?.clientHeight,
          // but vmin-based unit (%) keeps it simple and good enough visually.
          const fontSizeFrac = (item.fontSize ?? ANNOTATION_DEFAULTS.fontSize) / 1080;
          const selected = selectedItemId === item.id;
          return (
            <div
              onPointerDown={(e) => onAnnotationDown(e, item)}
              onPointerMove={onAnnotationMove}
              onPointerUp={onAnnotationUp}
              onPointerCancel={onAnnotationUp}
              className="absolute z-10 cursor-grab select-none active:cursor-grabbing"
              style={{
                left: `${posX * 100}%`,
                top: `${posY * 100}%`,
                transform: 'translate(-50%, -50%)',
                maxWidth: '80%',
                fontFamily,
                fontWeight: bold ? 700 : 400,
                fontStyle: italic ? 'italic' : 'normal',
                fontSize: `calc(${fontSizeFrac * 100}vh)`,
                lineHeight: 1.25,
                color: textColor,
                textAlign,
                backgroundColor: bg ?? 'transparent',
                padding: bg ? '0.4em 0.7em' : '0',
                borderRadius: bg ? '10px' : '0',
                outline: selected ? '2px dashed rgba(110,231,183,0.7)' : 'none',
                outlineOffset: '2px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {item.text || ''}
            </div>
          );
        })()}

        {selectedZoom && fileUrl && (
          <div
            onPointerDown={onFocusDown}
            onPointerMove={onFocusMove}
            onPointerUp={onFocusUp}
            onPointerCancel={onFocusUp}
            className="absolute z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-emerald-500/30 ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.6)] active:cursor-grabbing"
            style={{ left: `${focusLeftPct}%`, top: `${focusTopPct}%` }}
            title="Drag to set zoom focus"
          >
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-emerald-300/80" />
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-emerald-300/80" />
            <span className="block h-1.5 w-1.5 rounded-full bg-emerald-300" />
          </div>
        )}
      </div>
    </div>
  );
}
