import { useEditor, type CropRegion } from './store';
import { primeVideo } from './videoPrime';

type ProgressFn = (phase: string, pct: number) => void;

const QUALITY_PRESETS = {
  low: { maxHeight: 720, bitrate: 2_000_000 },
  medium: { maxHeight: 1080, bitrate: 5_000_000 },
  high: { maxHeight: 2160, bitrate: 12_000_000 }
};

const ASPECT_RATIOS: Record<string, number | null> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  auto: null
};

const LAYOUT_COORDS: Record<
  ReturnType<typeof useEditor.getState>['layoutPreset'],
  { x: number; y: number; size: number; sideBySide: boolean }
> = {
  'pip-bottom-right': { x: 0.78, y: 0.78, size: 0.18, sideBySide: false },
  'pip-bottom-left': { x: 0.04, y: 0.78, size: 0.18, sideBySide: false },
  'pip-top-right': { x: 0.78, y: 0.04, size: 0.18, sideBySide: false },
  'pip-top-left': { x: 0.04, y: 0.04, size: 0.18, sideBySide: false },
  'side-by-side': { x: 0.5, y: 0.5, size: 0.4, sideBySide: true }
};

function pickMimeType(format: 'mp4' | 'gif'): { mime: string; ext: 'mp4' | 'webm' } {
  if (format === 'mp4') {
    const candidates = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=h264',
      'video/mp4'
    ];
    const ok = candidates.find((m) => MediaRecorder.isTypeSupported(m));
    if (ok) return { mime: ok, ext: 'mp4' };
    // Fall through to webm.
  }
  const webm = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m)
  ) ?? 'video/webm';
  return { mime: webm, ext: 'webm' };
}

export async function runExport({ onProgress }: { onProgress: ProgressFn }) {
  const state = useEditor.getState();
  if (!state.fileUrl) throw new Error('No recording loaded.');
  if (state.exportFormat === 'gif') {
    throw new Error('GIF export requires ffmpeg post-processing — coming in a future update. For now, please pick MP4.');
  }

  const { fileUrl, webcamFileUrl, durationMs, items, background, effects, webcam, layoutPreset, aspect, exportQuality, exportFormat, videoMuted, cropRegion } = state;

  function loadVideo(src: string) {
    return new Promise<HTMLVideoElement>((resolve, reject) => {
      const v = document.createElement('video');
      v.src = src;
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      const cleanup = () => {
        v.removeEventListener('loadedmetadata', onMeta);
        v.removeEventListener('error', onErr);
      };
      const onMeta = () => { cleanup(); resolve(v); };
      const onErr = () => { cleanup(); reject(new Error('Failed to load video: ' + src)); };
      v.addEventListener('loadedmetadata', onMeta);
      v.addEventListener('error', onErr);
    });
  }

  const video = await loadVideo(fileUrl);
  const webcamVideo = webcamFileUrl && webcam.enabled ? await loadVideo(webcamFileUrl).catch(() => null) : null;

  // Prime so .duration and seeking work — see videoPrime.ts.
  onProgress('Preparing', 0);
  await primeVideo(video, durationMs);
  if (webcamVideo) await primeVideo(webcamVideo, durationMs);

  // Output dimensions.
  const intrinsic = { w: video.videoWidth || 1920, h: video.videoHeight || 1080 };
  const ratio =
    aspect === 'auto' ? intrinsic.w / intrinsic.h : ASPECT_RATIOS[aspect] ?? intrinsic.w / intrinsic.h;
  const preset = QUALITY_PRESETS[exportQuality];
  let outH = Math.min(intrinsic.h, preset.maxHeight);
  // Make even (some encoders require it).
  outH = Math.max(2, Math.floor(outH / 2) * 2);
  let outW = Math.floor(outH * ratio);
  outW = Math.max(2, Math.floor(outW / 2) * 2);

  // Background image preload (if used).
  let bgImage: HTMLImageElement | null = null;
  if (background.mode === 'image' && background.value) {
    bgImage = new Image();
    bgImage.src = background.value;
    await new Promise((res) => {
      bgImage!.onload = res;
      bgImage!.onerror = res;
    });
  }

  // Canvas + recorder.
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  const fps = 30;
  const stream = (canvas as HTMLCanvasElement).captureStream(fps);
  // When not muted, pull the audio track off the source video and merge it
  // into the canvas-driven stream so the exported file isn't silent. We must
  // do this BEFORE constructing the MediaRecorder; once it's recording, you
  // can't add tracks. captureStream() on the source returns live audio even
  // though the element itself is muted (mute only gates the local speaker
  // sink, not the underlying decoded track).
  if (!videoMuted) {
    const sourceCapture = (video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    });
    const grab = sourceCapture.captureStream ?? sourceCapture.mozCaptureStream;
    if (grab) {
      try {
        const srcStream = grab.call(video);
        for (const track of srcStream.getAudioTracks()) stream.addTrack(track);
      } catch (err) {
        console.warn('[export] could not capture source audio, exporting silent', err);
      }
    }
  }
  const { mime, ext } = pickMimeType(exportFormat);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: preset.bitrate
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  let canceled = false;
  let finished = false;
  let raf = 0;
  let lastMs = 0;
  let lastProgressTickAt = performance.now();

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  function finalize() {
    if (finished) return;
    finished = true;
    if (recorder.state === 'recording') recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
  }

  function drawFrame() {
    const ms = video.currentTime * 1000;

    // Background.
    ctx!.save();
    ctx!.fillStyle = '#0a0b0e';
    ctx!.fillRect(0, 0, outW, outH);

    if (background.mode === 'color') {
      ctx!.fillStyle = background.value;
      ctx!.fillRect(0, 0, outW, outH);
    } else if (background.mode === 'gradient') {
      const grad = parseLinearGradient(ctx!, background.value, outW, outH);
      ctx!.fillStyle = grad ?? '#1a1d23';
      ctx!.fillRect(0, 0, outW, outH);
    } else if (background.mode === 'image' && bgImage && bgImage.complete) {
      drawCover(ctx!, bgImage, 0, 0, outW, outH);
    }

    // Inner padded video frame.
    const padding = effects.paddingPct / 100;
    const innerScale = 1 - padding * 0.5;

    // Active overlays.
    const activeZoom = items.find((it) => it.kind === 'zoom' && ms >= it.startMs && ms <= it.endMs);
    const activeAnnotation = items.find(
      (it) => it.kind === 'annotation' && ms >= it.startMs && ms <= it.endMs
    );
    const layout = LAYOUT_COORDS[layoutPreset];

    if (layout.sideBySide && webcam.enabled) {
      const innerW = outW * innerScale;
      const innerH = outH * innerScale;
      const innerX = (outW - innerW) / 2;
      const innerY = (outH - innerH) / 2;
      const wcW = innerW * 0.4;
      const vidW = innerW - wcW - 12;
      drawVideoBox(ctx!, video, innerX, innerY, vidW, innerH, effects.roundnessPx, cropRegion, activeZoom);
      if (webcamVideo) {
        drawWebcamVideo(ctx!, webcamVideo, innerX + vidW + 12, innerY, wcW, innerH, effects.roundnessPx, false);
      } else {
        drawWebcamPlaceholder(ctx!, innerX + vidW + 12, innerY, wcW, innerH, effects.roundnessPx);
      }
    } else {
      const innerW = outW * innerScale;
      const innerH = outH * innerScale;
      const innerX = (outW - innerW) / 2;
      const innerY = (outH - innerH) / 2;
      drawVideoBox(ctx!, video, innerX, innerY, innerW, innerH, effects.roundnessPx, cropRegion, activeZoom);
      if (webcam.enabled) {
        const wcSide = outH * webcam.size;
        const wx = webcam.x * outW;
        const wy = webcam.y * outH;
        const cornerRadius =
          webcam.shape === 'circle' ? wcSide / 2 :
          webcam.shape === 'rounded' ? Math.min(wcSide / 4, 24 * (outH / 1080)) :
          0;
        if (webcamVideo) {
          drawWebcamVideo(ctx!, webcamVideo, wx, wy, wcSide, wcSide, cornerRadius, webcam.shape === 'circle');
        } else {
          drawWebcamPlaceholder(ctx!, wx, wy, wcSide, wcSide, cornerRadius);
        }
      }
    }

    if (activeAnnotation && activeAnnotation.text) {
      drawAnnotation(ctx!, activeAnnotation.text, outW, outH);
    }

    ctx!.restore();
  }

  function tick() {
    if (canceled || finished) return;
    const ms = video.currentTime * 1000;

    // Authoritative end: durationMs from the recording metadata is the wall-clock
    // truth; rely on it instead of `video.ended`, which is unreliable for
    // MediaRecorder-emitted WebMs.
    if (durationMs > 0 && ms >= durationMs - 30) {
      drawFrame();
      finalize();
      return;
    }

    // Stuck detection: if the source video stops advancing for >1.5s the file
    // is probably tripping over an unindexed region — finalize gracefully so
    // the user always gets a partial export instead of a hung UI.
    if (Math.abs(ms - lastMs) > 1) {
      lastMs = ms;
      lastProgressTickAt = performance.now();
    } else if (performance.now() - lastProgressTickAt > 1500) {
      console.warn('[export] source video stalled — finalizing partial export');
      drawFrame();
      finalize();
      return;
    }

    // Trim skip.
    const trim = items.find((it) => it.kind === 'trim' && ms >= it.startMs && ms < it.endMs);
    if (trim) {
      video.currentTime = Math.min(durationMs / 1000, trim.endMs / 1000 + 0.001);
      if (webcamVideo) webcamVideo.currentTime = video.currentTime;
      raf = requestAnimationFrame(tick);
      return;
    }
    // Speed.
    const speed = items.find((it) => it.kind === 'speed' && ms >= it.startMs && ms <= it.endMs);
    const targetRate = speed?.speed ?? 1;
    if (Math.abs(video.playbackRate - targetRate) > 0.01) video.playbackRate = targetRate;
    if (webcamVideo) {
      if (Math.abs(webcamVideo.playbackRate - targetRate) > 0.01) webcamVideo.playbackRate = targetRate;
      if (Math.abs(webcamVideo.currentTime - video.currentTime) > 0.15) webcamVideo.currentTime = video.currentTime;
    }

    drawFrame();

    if (durationMs > 0) {
      onProgress('Encoding', Math.min(99, (ms / durationMs) * 100));
    }

    raf = requestAnimationFrame(tick);
  }

  const onEnded = () => finalize();
  video.addEventListener('ended', onEnded);

  try {
    video.currentTime = 0;
    if (webcamVideo) webcamVideo.currentTime = 0;
    // Draw an initial frame so the recorder has data.
    await new Promise((r) => setTimeout(r, 50));
    drawFrame();
    recorder.start(250);
    lastProgressTickAt = performance.now();
    await video.play();
    if (webcamVideo) {
      try { await webcamVideo.play(); } catch { /* ignore */ }
    }
    raf = requestAnimationFrame(tick);
    await stopped;
  } finally {
    canceled = true;
    cancelAnimationFrame(raf);
    video.removeEventListener('ended', onEnded);
    video.pause();
    video.src = '';
    if (webcamVideo) {
      webcamVideo.pause();
      webcamVideo.src = '';
    }
  }

  onProgress('Saving', 99);
  const blob = new Blob(chunks, { type: mime });
  const buf = await blob.arrayBuffer();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const res = await window.api.saveExport({
    defaultName: `reframe-${stamp}`,
    data: buf,
    format: ext
  });
  if (!res.saved) {
    onProgress('Cancelled', 100);
    return;
  }
  onProgress('Done', 100);
  if (ext === 'webm' && exportFormat === 'mp4') {
    alert(
      'Saved as .webm — your build of Chromium did not advertise MP4 encoder support. ' +
      'Convert with: ffmpeg -i in.webm -c:v libx264 -c:a aac out.mp4'
    );
  }
}

function drawVideoBox(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
  roundness: number,
  crop: CropRegion,
  activeZoom?: { zoomLevel?: number; zoomTargetX?: number; zoomTargetY?: number }
) {
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, Math.min(roundness, Math.min(w, h) / 2));
  ctx.clip();

  const z = activeZoom?.zoomLevel ?? 1;
  const tx = activeZoom ? (0.5 - (activeZoom.zoomTargetX ?? 0.5)) * w * (z - 1) : 0;
  const ty = activeZoom ? (0.5 - (activeZoom.zoomTargetY ?? 0.5)) * h * (z - 1) : 0;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(z, z);
  ctx.translate(-w / 2 + tx / z, -h / 2 + ty / z);

  // Crop-aware cover. With identity crop {0,0,1,1} this is equivalent to
  // drawCover; otherwise the cropped sub-rect of the source becomes the new
  // "source" and is cover-fit into the destination box.
  drawCoverWithCrop(ctx, video, crop, 0, 0, w, h);
  ctx.restore();
}

function drawWebcamVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
  roundness: number,
  circle: boolean
) {
  ctx.save();
  if (circle) {
    const r = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
    ctx.closePath();
  } else {
    roundedRectPath(ctx, x, y, w, h, Math.min(roundness, Math.min(w, h) / 2));
  }
  ctx.clip();
  drawCover(ctx, video, x, y, w, h);
  ctx.restore();
  ctx.save();
  if (circle) {
    const r = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
  } else {
    roundedRectPath(ctx, x, y, w, h, Math.min(roundness, Math.min(w, h) / 2));
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawWebcamPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  roundness: number
) {
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, Math.min(roundness, Math.min(w, h) / 2));
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `${Math.max(12, Math.floor(h * 0.18))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Webcam', x + w / 2, y + h / 2);
  ctx.restore();
}

function drawAnnotation(ctx: CanvasRenderingContext2D, text: string, outW: number, outH: number) {
  ctx.save();
  const fontSize = Math.max(18, Math.floor(outH * 0.035));
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const padding = fontSize * 0.6;
  const metrics = ctx.measureText(text);
  const tw = Math.min(outW * 0.8, metrics.width);
  const th = fontSize * 1.4;
  const bx = (outW - tw) / 2 - padding;
  const by = outH - th - padding * 2 - outH * 0.06;
  const bw = tw + padding * 2;
  const bh = th + padding;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundedRectPath(ctx, bx, by, bw, bh, 10);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, outW / 2, by + bh / 2);
  ctx.restore();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  src: HTMLVideoElement | HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth;
  const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight;
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  const ox = dx + (dw - w) / 2;
  const oy = dy + (dh - h) / 2;
  ctx.drawImage(src as CanvasImageSource, ox, oy, w, h);
}

// Cover-fit a CROPPED region of the source into the destination box. The
// crop rect is normalized 0..1 against the source's intrinsic dimensions;
// {x:0,y:0,width:1,height:1} reduces this to plain drawCover. Cover-overflow
// (when crop aspect != dest aspect) is centered and trimmed by reducing the
// source rect we sample, never by overdrawing past the dest clip.
function drawCoverWithCrop(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: CropRegion,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return;

  const cropPxW = crop.width * sw;
  const cropPxH = crop.height * sh;
  if (cropPxW <= 0 || cropPxH <= 0) return;

  // Cover scale based on cropped source.
  const scale = Math.max(dw / cropPxW, dh / cropPxH);
  const drawnW = cropPxW * scale;
  const drawnH = cropPxH * scale;

  // Pixels of the crop region that overflow the destination — trim from the
  // source rect symmetrically.
  const overflowSrcW = (drawnW - dw) / scale;
  const overflowSrcH = (drawnH - dh) / scale;
  const sx = crop.x * sw + overflowSrcW / 2;
  const sy = crop.y * sh + overflowSrcH / 2;
  const sWidth = cropPxW - overflowSrcW;
  const sHeight = cropPxH - overflowSrcH;

  ctx.drawImage(video, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
}

function parseLinearGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  w: number,
  h: number
): CanvasGradient | null {
  // Supports `linear-gradient(<deg>deg, c1, c2[, c3...])`. Degrees follow CSS convention
  // (0deg = up, 90deg = right). Default 180deg if missing.
  const m = css.match(/^linear-gradient\(\s*(?:(\-?\d+(?:\.\d+)?)deg\s*,)?\s*(.+)\)$/i);
  if (!m) return null;
  const deg = m[1] != null ? Number(m[1]) : 180;
  const stopsRaw = m[2].split(/,(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
  if (stopsRaw.length < 2) return null;
  // Convert CSS degrees to a vector across the box.
  const rad = ((deg - 90) * Math.PI) / 180; // CSS 0deg = up, canvas 0rad = right; rotate -90.
  const cx = w / 2;
  const cy = h / 2;
  const len = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const x1 = cx - Math.cos(rad) * len;
  const y1 = cy - Math.sin(rad) * len;
  const x2 = cx + Math.cos(rad) * len;
  const y2 = cy + Math.sin(rad) * len;
  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  stopsRaw.forEach((c, i) => grad.addColorStop(i / (stopsRaw.length - 1), c));
  return grad;
}
