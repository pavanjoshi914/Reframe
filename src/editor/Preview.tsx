import { useEffect, useMemo, useRef } from 'react';
import { useEditor, ANNOTATION_DEFAULTS } from './store';
import { primeVideo } from './videoPrime';
import { drawFrame } from './export';
import { useT } from '../i18n';

const aspectMap: Record<string, number | null> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  auto: null
};

export function Preview() {
  const t = useT();
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
  const editingAnnotationId = useEditor((s) => s.editingAnnotationId);
  const setEditingAnnotation = useEditor((s) => s.setEditingAnnotation);
  const updateItem = useEditor((s) => s.updateItem);
  const selectItem = useEditor((s) => s.selectItem);
  const selectedZoom = useMemo(() => {
    if (!selectedItemId) return null;
    const it = items.find((i) => i.id === selectedItemId);
    return it && it.kind === 'zoom' ? it : null;
  }, [selectedItemId, items]);
  // A selected spotlight/magnify region in 'manual' mode gets a draggable
  // handle on the stage so the user can place the lens where they want.
  const selectedManualLens = useMemo(() => {
    if (!selectedItemId) return null;
    const it = items.find((i) => i.id === selectedItemId);
    return it && (it.kind === 'magnify' || it.kind === 'spotlight') && it.track === 'manual' ? it : null;
  }, [selectedItemId, items]);

  const videoVolume = useEditor((s) => s.videoVolume);
  const videoMuted = useEditor((s) => s.videoMuted);

  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Canvas preview: a single <canvas> composited every rAF by the SAME
  // drawFrame the exporter uses (true WYSIWYG), with the <video>s as hidden
  // decode sources. `work` is the per-frame scratch canvas; blending it onto
  // the visible canvas at alpha (1-motionBlur) yields an exponential frame
  // average = motion blur. `bgImage` holds a preloaded image background.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

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

  // Preload an image background for the canvas compositor (mirrors export.ts).
  useEffect(() => {
    if (background.mode === 'image' && background.value) {
      const img = new Image();
      img.onload = () => { bgImageRef.current = img; };
      img.onerror = () => { bgImageRef.current = null; };
      img.src = background.value;
    } else {
      bgImageRef.current = null;
    }
  }, [background.mode, background.value]);

  // Canvas render loop — composite the current frame with the shared drawFrame
  // every animation frame, reading live state via getState() (so it needs no
  // deps and never tears down mid-playback). Annotations are excluded here and
  // drawn as a DOM overlay so they stay directly draggable. Motion blur is an
  // exponential blend: drawing the fresh frame onto the visible canvas at
  // alpha (1-k) gives canvas = (1-k)·frame + k·canvas. k=0 ⇒ exact frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!workRef.current) workRef.current = document.createElement('canvas');
    const work = workRef.current;
    const wctx = work.getContext('2d');
    if (!wctx) return;
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const st = useEditor.getState();
      const v = videoRef.current;
      const rect = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const bw = Math.max(2, Math.round(rect.width * dpr));
      const bh = Math.max(2, Math.round(rect.height * dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      if (work.width !== bw || work.height !== bh) { work.width = bw; work.height = bh; }
      if (!st.fileUrl || !v) { ctx.clearRect(0, 0, bw, bh); return; }
      const ms = v.currentTime * 1000;
      const itemsNoAnno = st.items.filter((it) => it.kind !== 'annotation');
      const webcamSrc = st.webcam.enabled && st.webcamFileUrl ? webcamRef.current : null;
      drawFrame(wctx, bw, bh, v, webcamSrc, ms, {
        items: itemsNoAnno,
        background: st.background,
        effects: st.effects,
        webcam: st.webcam,
        layoutPreset: st.layoutPreset,
        cropRegion: st.cropRegion,
        bgImage: bgImageRef.current,
        cursorSamples: st.cursorSamples
      });
      const k = Math.max(0, Math.min(0.9, st.effects.motionBlur || 0));
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(work, 0, 0);
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  // The annotation is the one overlay still drawn in the DOM (so it stays
  // directly editable/draggable); everything else is composited on the canvas.
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

  // Padding only affects the zoom-focus crosshair placement now (the canvas
  // applies the actual padding via drawFrame). Keep innerScale in sync with
  // export's `1 - paddingPct/100 * 0.5`.
  const innerScale = 1 - (effects.paddingPct / 100) * 0.5;

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

  // Manual spotlight/magnify lens dragging — places posX/posY (fractions of the
  // stage = output frame), the same coordinates the exporter reads in 'manual'.
  const lensDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; id: string } | null>(null);
  function onLensDown(e: React.PointerEvent, item: NonNullable<typeof selectedManualLens>) {
    if (!stageRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    selectItem(item.id);
    lensDragRef.current = { startX: e.clientX, startY: e.clientY, baseX: item.posX ?? 0.5, baseY: item.posY ?? 0.5, id: item.id };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onLensMove(e: React.PointerEvent) {
    const d = lensDragRef.current;
    const stage = stageRef.current;
    if (!d || !stage) return;
    const r = stage.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / r.width;
    const dy = (e.clientY - d.startY) / r.height;
    updateItem(d.id, {
      posX: Math.max(0, Math.min(1, d.baseX + dx)),
      posY: Math.max(0, Math.min(1, d.baseY + dy))
    });
  }
  function onLensUp(e: React.PointerEvent) {
    if (!lensDragRef.current) return;
    lensDragRef.current = null;
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
        {/* Hidden decode sources. Kept in the DOM (opacity 0) so they keep
            decoding; the main <video> still drives playback/audio/timing while
            the canvas composites its frames. */}
        <video
          ref={videoRef}
          src={fileUrl ?? undefined}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          playsInline
          muted={false}
        />
        {webcamFileUrl && (
          <video
            ref={webcamRef}
            src={webcamFileUrl}
            className="pointer-events-none absolute opacity-0"
            style={{ width: 2, height: 2 }}
            playsInline
            muted
          />
        )}

        {/* WYSIWYG composite — drawn every frame by the same drawFrame the
            exporter uses, so the preview matches the export exactly (incl.
            motion blur). */}
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {!fileUrl && (
          <div className="relative text-sm text-white/60">{t('editor.noRecording')}</div>
        )}

        {/* Transparent drag handle over the canvas-drawn webcam PiP (standard
            layout only — side-by-side is fixed). */}
        {fileUrl && webcam.enabled && !isSideBySide && (
          <div
            onPointerDown={onWebcamDown}
            onPointerMove={onWebcamMove}
            onPointerUp={onWebcamUp}
            onPointerCancel={onWebcamUp}
            className="absolute z-10 cursor-grab active:cursor-grabbing"
            style={{
              left: `${webcam.x * 100}%`,
              top: `${webcam.y * 100}%`,
              height: `${webcam.size * 100}%`,
              aspectRatio: String(webcamAspect)
            }}
            title={t('editor.dragReposition')}
          />
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
          const editing = editingAnnotationId === item.id;
          const empty = !item.text || item.text.trim() === '';
          const boxStyle: React.CSSProperties = {
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
            outline: editing ? '2px solid rgba(110,231,183,0.9)' : selected ? '2px dashed rgba(110,231,183,0.7)' : 'none',
            outlineOffset: '2px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          };
          // Editing: a focused contentEditable that matches the rendered text
          // exactly (WYSIWYG). Esc / Enter (without Shift) or clicking away
          // commits and exits; typing never leaks to lane shortcuts.
          if (editing) {
            return (
              <AnnotationCanvasEditor
                key={item.id}
                initialText={item.text ?? ''}
                style={boxStyle}
                onChange={(text) => updateItem(item.id, { text })}
                onDone={() => setEditingAnnotation(null)}
              />
            );
          }
          return (
            <div
              onPointerDown={(e) => onAnnotationDown(e, item)}
              onPointerMove={onAnnotationMove}
              onPointerUp={onAnnotationUp}
              onPointerCancel={onAnnotationUp}
              onDoubleClick={(e) => { e.stopPropagation(); setEditingAnnotation(item.id); }}
              data-anno="overlay"
              className="absolute z-10 cursor-grab select-none active:cursor-grabbing"
              style={{ ...boxStyle, color: empty ? 'rgba(255,255,255,0.5)' : textColor }}
              title={t('editor.dragAnnotation')}
            >
              {empty ? t('side.enterText') : item.text}
            </div>
          );
        })()}

        {selectedManualLens && (() => {
          const it = selectedManualLens;
          const px = (it.posX ?? 0.5) * 100;
          const py = (it.posY ?? 0.5) * 100;
          return (
            <div
              onPointerDown={(e) => onLensDown(e, it)}
              onPointerMove={onLensMove}
              onPointerUp={onLensUp}
              onPointerCancel={onLensUp}
              data-lens="handle"
              className="absolute z-20 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-violet-500/30 ring-2 ring-violet-300 shadow-[0_0_12px_rgba(167,139,250,0.6)] active:cursor-grabbing"
              style={{ left: `${px}%`, top: `${py}%` }}
              title={t('editor.dragLens')}
            >
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-violet-200/80" />
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-violet-200/80" />
              <span className="block h-1.5 w-1.5 rounded-full bg-violet-100" />
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
            title={t('editor.dragFocus')}
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

// On-canvas WYSIWYG text editor for an annotation. A focused contentEditable
// that visually matches the rendered text; commits on blur and exits on
// Esc / Enter (Shift+Enter inserts a newline). Pointer + key events are kept
// local so dragging the stage and lane shortcuts don't fire while typing.
function AnnotationCanvasEditor({
  initialText,
  style,
  onChange,
  onDone
}: {
  initialText: string;
  style: React.CSSProperties;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerText = initialText;
    el.focus();
    // Caret to the end of any existing text.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-anno="editor"
      onInput={(e) => onChange(e.currentTarget.innerText)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          onDone();
        }
      }}
      onBlur={onDone}
      className="absolute z-20 cursor-text outline-none"
      style={{ ...style, minWidth: '1ch' }}
    />
  );
}
