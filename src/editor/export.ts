import {
  Input,
  Output,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSink,
  CanvasSource,
  ALL_FORMATS,
  getFirstEncodableVideoCodec,
  type VideoCodec
} from 'mediabunny';
import { useEditor, type CropRegion } from './store';

// Export pipeline — frame-accurate, NOT real-time.
//
// Earlier versions played the recording through a <video> element and captured
// canvas.captureStream() with MediaRecorder. That was unreliable: the <video>
// element would declare the clip "ended" a fraction of a second in and the
// export came out 1–2 s long regardless of the real duration.
//
// This version follows openscreen's approach: decode the source with WebCodecs
// (via mediabunny's CanvasSink), composite each decoded frame onto the output
// canvas, and encode + mux the result (via mediabunny's CanvasSource + Output).
// Every source frame is processed deterministically — no playback, no
// MediaRecorder, no dependence on video.currentTime.

type ProgressFn = (phase: string, pct: number) => void;

type FrameSource = HTMLCanvasElement | OffscreenCanvas | HTMLImageElement;

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

function srcDims(s: CanvasImageSource): { w: number; h: number } {
  const anyS = s as unknown as {
    videoWidth?: number; videoHeight?: number;
    naturalWidth?: number; naturalHeight?: number;
    width?: number; height?: number;
  };
  return {
    w: anyS.videoWidth || anyS.naturalWidth || anyS.width || 0,
    h: anyS.videoHeight || anyS.naturalHeight || anyS.height || 0
  };
}

export async function runExport({ onProgress }: { onProgress: ProgressFn }) {
  const state = useEditor.getState();
  if (!state.fileUrl) throw new Error('No recording loaded.');
  if (state.exportFormat === 'gif') {
    throw new Error('GIF export requires ffmpeg post-processing — coming in a future update. For now, please pick MP4.');
  }

  const {
    fileUrl, webcamFileUrl, items, background, effects, webcam,
    layoutPreset, aspect, exportQuality, cropRegion
  } = state;

  onProgress('Preparing', 0);

  // ── Open the source recording(s) ────────────────────────────────────────
  // fetch() works on the media:// scheme (registered with supportFetchAPI).
  // mediabunny reads the resulting Blob entirely in-memory, so there's no
  // dependence on HTTP range support or <video> playback quirks.
  const screenBlob = await (await fetch(fileUrl)).blob();
  const screenInput = new Input({ source: new BlobSource(screenBlob), formats: ALL_FORMATS });
  const screenTrack = await screenInput.getPrimaryVideoTrack();
  if (!screenTrack) throw new Error('Recording has no video track.');
  const screenSink = new CanvasSink(screenTrack);

  let webcamSink: CanvasSink | null = null;
  if (webcamFileUrl && webcam.enabled) {
    try {
      const webcamBlob = await (await fetch(webcamFileUrl)).blob();
      const webcamInput = new Input({ source: new BlobSource(webcamBlob), formats: ALL_FORMATS });
      const webcamTrack = await webcamInput.getPrimaryVideoTrack();
      if (webcamTrack) webcamSink = new CanvasSink(webcamTrack);
    } catch (err) {
      console.warn('[export] webcam track failed to open, exporting without it', err);
    }
  }

  const sourceDurationSec = await screenTrack.computeDuration();

  // ── Output dimensions ───────────────────────────────────────────────────
  const intrinsic = { w: screenTrack.displayWidth || 1920, h: screenTrack.displayHeight || 1080 };
  const ratio =
    aspect === 'auto' ? intrinsic.w / intrinsic.h : ASPECT_RATIOS[aspect] ?? intrinsic.w / intrinsic.h;
  const preset = QUALITY_PRESETS[exportQuality];
  let outH = Math.min(intrinsic.h, preset.maxHeight);
  outH = Math.max(2, Math.floor(outH / 2) * 2);
  let outW = Math.floor(outH * ratio);
  outW = Math.max(2, Math.floor(outW / 2) * 2);

  // ── Background image preload ────────────────────────────────────────────
  let bgImage: HTMLImageElement | null = null;
  if (background.mode === 'image' && background.value) {
    bgImage = new Image();
    bgImage.src = background.value;
    await new Promise((res) => {
      bgImage!.onload = res;
      bgImage!.onerror = res;
    });
  }

  // ── Output canvas + encoder + muxer ─────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  // Prefer H.264/MP4; fall back to VP9/VP8 in WebM if the system can't encode
  // H.264 via WebCodecs.
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], {
    width: outW,
    height: outH
  });
  if (!codec) throw new Error('No encodable video codec available on this system.');
  const isMp4 = codec === 'avc';
  const ext: 'mp4' | 'webm' = isMp4 ? 'mp4' : 'webm';

  const output = new Output({
    format: isMp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget()
  });
  const videoSource = new CanvasSource(canvas, {
    codec: codec as VideoCodec,
    bitrate: preset.bitrate
  });
  output.addVideoTrack(videoSource);
  await output.start();

  // ── Composite every source frame ────────────────────────────────────────
  // outTs accumulates the OUTPUT timeline position (seconds). For untouched
  // footage it tracks the source timestamp 1:1; trim regions are skipped and
  // speed regions stretch/compress each frame's duration.
  let outTs = 0;
  let lastProgress = 0;

  for await (const wrapped of screenSink.canvases()) {
    const { canvas: srcCanvas, timestamp, duration } = wrapped;
    const ms = timestamp * 1000;

    // Trim: drop frames inside any trim region entirely.
    const inTrim = items.some(
      (it) => it.kind === 'trim' && ms >= it.startMs && ms < it.endMs
    );
    if (inTrim) continue;

    // Speed: a speed region stretches (slow) or compresses (fast) the frame's
    // contribution to the output timeline.
    const speed = items.find(
      (it) => it.kind === 'speed' && ms >= it.startMs && ms <= it.endMs
    );
    const speedFactor = speed?.speed ?? 1;
    const outDuration = Math.max(1 / 240, (duration || 1 / 30) / speedFactor);

    // Webcam frame for this timestamp (random-access; mediabunny caches).
    let webcamCanvas: FrameSource | null = null;
    if (webcamSink) {
      const wc = await webcamSink.getCanvas(timestamp).catch(() => null);
      webcamCanvas = wc?.canvas ?? null;
    }

    drawFrame(ctx, outW, outH, srcCanvas, webcamCanvas, ms, {
      items, background, effects, webcam, layoutPreset, cropRegion, bgImage
    });

    await videoSource.add(outTs, outDuration);
    outTs += outDuration;

    if (sourceDurationSec > 0) {
      const pct = Math.min(99, (timestamp / sourceDurationSec) * 100);
      if (pct - lastProgress >= 1) {
        lastProgress = pct;
        onProgress('Encoding', pct);
      }
    }
  }

  onProgress('Saving', 99);
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Export produced no data.');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const res = await window.api.saveExport({
    defaultName: `reframe-${stamp}`,
    data: buffer,
    format: ext
  });
  if (!res.saved) {
    onProgress('Cancelled', 100);
    return;
  }
  onProgress('Done', 100);
}

// ── Frame compositing ──────────────────────────────────────────────────────
// Draws one fully-composited output frame: background, the (cropped, possibly
// zoomed) screen recording, the webcam overlay, and any active annotation.

type DrawCtx = {
  items: ReturnType<typeof useEditor.getState>['items'];
  background: ReturnType<typeof useEditor.getState>['background'];
  effects: ReturnType<typeof useEditor.getState>['effects'];
  webcam: ReturnType<typeof useEditor.getState>['webcam'];
  layoutPreset: ReturnType<typeof useEditor.getState>['layoutPreset'];
  cropRegion: CropRegion;
  bgImage: HTMLImageElement | null;
};

function drawFrame(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  srcCanvas: FrameSource,
  webcamCanvas: FrameSource | null,
  ms: number,
  d: DrawCtx
) {
  const { items, background, effects, webcam, layoutPreset, cropRegion, bgImage } = d;

  ctx.save();
  ctx.fillStyle = '#0a0b0e';
  ctx.fillRect(0, 0, outW, outH);

  if (background.mode === 'color') {
    ctx.fillStyle = background.value;
    ctx.fillRect(0, 0, outW, outH);
  } else if (background.mode === 'gradient') {
    const grad = parseLinearGradient(ctx, background.value, outW, outH);
    ctx.fillStyle = grad ?? '#1a1d23';
    ctx.fillRect(0, 0, outW, outH);
  } else if (background.mode === 'image' && bgImage && bgImage.complete) {
    drawCover(ctx, bgImage, 0, 0, outW, outH);
  }

  const padding = effects.paddingPct / 100;
  const innerScale = 1 - padding * 0.5;

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
    drawVideoBox(ctx, srcCanvas, innerX, innerY, vidW, innerH, effects.roundnessPx, cropRegion, activeZoom);
    if (webcamCanvas) {
      drawWebcamVideo(ctx, webcamCanvas, innerX + vidW + 12, innerY, wcW, innerH, effects.roundnessPx, false);
    } else {
      drawWebcamPlaceholder(ctx, innerX + vidW + 12, innerY, wcW, innerH, effects.roundnessPx);
    }
  } else {
    const innerW = outW * innerScale;
    const innerH = outH * innerScale;
    const innerX = (outW - innerW) / 2;
    const innerY = (outH - innerH) / 2;
    drawVideoBox(ctx, srcCanvas, innerX, innerY, innerW, innerH, effects.roundnessPx, cropRegion, activeZoom);
    if (webcam.enabled) {
      const wcH = outH * webcam.size;
      const wcW = wcH * (webcam.shape === 'rectangle' ? 16 / 9 : 1);
      const wx = webcam.x * outW;
      const wy = webcam.y * outH;
      const cornerRadius =
        webcam.shape === 'circle' ? wcH / 2 :
        Math.min(wcH / 4, 24 * (outH / 1080));
      if (webcamCanvas) {
        drawWebcamVideo(ctx, webcamCanvas, wx, wy, wcW, wcH, cornerRadius, webcam.shape === 'circle');
      } else {
        drawWebcamPlaceholder(ctx, wx, wy, wcW, wcH, cornerRadius);
      }
    }
  }

  if (activeAnnotation && activeAnnotation.text) {
    drawAnnotation(ctx, activeAnnotation.text, outW, outH);
  }

  ctx.restore();
}

function drawVideoBox(
  ctx: CanvasRenderingContext2D,
  src: FrameSource,
  x: number,
  y: number,
  w: number,
  h: number,
  roundness: number,
  crop: CropRegion,
  activeZoom?: { zoomLevel?: number; zoomTargetX?: number; zoomTargetY?: number }
) {
  ctx.save();

  // Zoom scales the ENTIRE framed box — rounded corners and all — about its
  // centre, matching the editor preview, where the CSS `transform` sits on the
  // outer container that wraps the rounded crop frame. The key is applying the
  // transform BEFORE clipping so the rounded clip rect scales up too. (The old
  // code clipped first, so the frame stayed put and only the content inside it
  // scaled — "the internal canvas zooms instead of the window".)
  //
  // Matches the preview's `transform: scale(z) translate(tx%, ty%)` with
  // transform-origin centre: a point P maps to  centre + z·(P − centre) + z·t,
  // which the translate→scale→translate sequence below reproduces exactly.
  const z = activeZoom?.zoomLevel ?? 1;
  if (z !== 1) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const tx = (0.5 - (activeZoom?.zoomTargetX ?? 0.5)) * (z - 1) * w;
    const ty = (0.5 - (activeZoom?.zoomTargetY ?? 0.5)) * (z - 1) * h;
    ctx.translate(cx, cy);
    ctx.scale(z, z);
    ctx.translate(-cx + tx, -cy + ty);
  }

  roundedRectPath(ctx, x, y, w, h, Math.min(roundness, Math.min(w, h) / 2));
  ctx.clip();
  drawCoverWithCrop(ctx, src, crop, x, y, w, h);

  ctx.restore();
}

function drawWebcamVideo(
  ctx: CanvasRenderingContext2D,
  src: FrameSource,
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
  drawCover(ctx, src, x, y, w, h);
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
  src: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const { w: sw, h: sh } = srcDims(src);
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  const ox = dx + (dw - w) / 2;
  const oy = dy + (dh - h) / 2;
  ctx.drawImage(src, ox, oy, w, h);
}

// Cover-fit a CROPPED region of the source into the destination box. The crop
// rect is normalized 0..1 against the source's intrinsic dimensions;
// {x:0,y:0,width:1,height:1} reduces this to plain drawCover.
function drawCoverWithCrop(
  ctx: CanvasRenderingContext2D,
  src: FrameSource,
  crop: CropRegion,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const { w: sw, h: sh } = srcDims(src);
  if (!sw || !sh) return;

  const cropPxW = crop.width * sw;
  const cropPxH = crop.height * sh;
  if (cropPxW <= 0 || cropPxH <= 0) return;

  const scale = Math.max(dw / cropPxW, dh / cropPxH);
  const drawnW = cropPxW * scale;
  const drawnH = cropPxH * scale;

  const overflowSrcW = (drawnW - dw) / scale;
  const overflowSrcH = (drawnH - dh) / scale;
  const sx = crop.x * sw + overflowSrcW / 2;
  const sy = crop.y * sh + overflowSrcH / 2;
  const sWidth = cropPxW - overflowSrcW;
  const sHeight = cropPxH - overflowSrcH;

  ctx.drawImage(src, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
}

function parseLinearGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  w: number,
  h: number
): CanvasGradient | null {
  const m = css.match(/^linear-gradient\(\s*(?:(\-?\d+(?:\.\d+)?)deg\s*,)?\s*(.+)\)$/i);
  if (!m) return null;
  const deg = m[1] != null ? Number(m[1]) : 180;
  const stopsRaw = m[2].split(/,(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
  if (stopsRaw.length < 2) return null;
  const rad = ((deg - 90) * Math.PI) / 180;
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
