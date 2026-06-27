import {
  Input,
  Output,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSink,
  CanvasSource,
  AudioBufferSource,
  ALL_FORMATS,
  getFirstEncodableVideoCodec,
  getFirstEncodableAudioCodec,
  type VideoCodec
} from 'mediabunny';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { useEditor, type CropRegion, ANNOTATION_DEFAULTS } from './store';

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

// Match the editor preview's CSS `transition-transform duration-[400ms] ease-out`
// on the zoom container — the preview ramps zoomLevel smoothly when a zoom
// item starts/ends; the export needs the same easing or the cut between
// zoomed/un-zoomed shows up as an abrupt jump in the rendered video. Keep
// this constant in sync with the Preview's CSS class.
const ZOOM_TRANSITION_MS = 400;
function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

type ZoomItem = { startMs: number; endMs: number; zoomLevel?: number; zoomTargetX?: number; zoomTargetY?: number };

// Returns the effective zoom (level + target) at `ms`, with the zoomLevel
// eased in over the first ZOOM_TRANSITION_MS of the active zoom item and
// eased out over the ZOOM_TRANSITION_MS following its end. Returns null when
// no zoom is active and we're past any recently-ended one.
function computeEasedZoom(
  items: ReturnType<typeof useEditor.getState>['items'],
  ms: number
): ZoomItem | null {
  // Inside an active zoom item — easing in (or fully zoomed).
  const active = items.find(
    (it) => it.kind === 'zoom' && ms >= it.startMs && ms <= it.endMs
  );
  if (active) {
    const target = active.zoomLevel ?? 1.5;
    const elapsed = ms - active.startMs;
    const progress = elapsed < ZOOM_TRANSITION_MS ? easeOutCubic(elapsed / ZOOM_TRANSITION_MS) : 1;
    return {
      startMs: active.startMs,
      endMs: active.endMs,
      zoomLevel: 1 + (target - 1) * progress,
      zoomTargetX: active.zoomTargetX,
      zoomTargetY: active.zoomTargetY
    };
  }
  // Otherwise check the most-recently-ended zoom — if we're within the ease-
  // out window, ramp back down toward 1.
  const justEnded = items
    .filter((it) => it.kind === 'zoom' && ms > it.endMs && ms <= it.endMs + ZOOM_TRANSITION_MS)
    .sort((a, b) => b.endMs - a.endMs)[0];
  if (justEnded) {
    const target = justEnded.zoomLevel ?? 1.5;
    const progress = 1 - easeOutCubic((ms - justEnded.endMs) / ZOOM_TRANSITION_MS);
    return {
      startMs: justEnded.startMs,
      endMs: justEnded.endMs,
      zoomLevel: 1 + (target - 1) * progress,
      zoomTargetX: justEnded.zoomTargetX,
      zoomTargetY: justEnded.zoomTargetY
    };
  }
  return null;
}

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

  const {
    fileUrl, webcamFileUrl, items, background, effects, webcam,
    layoutPreset, aspect, exportQuality, exportFormat, cropRegion, videoMuted, videoVolume
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
  const isGif = exportFormat === 'gif';
  // GIFs balloon at high resolutions (palette-indexed, one frame per delay),
  // so cap their height well below the video presets.
  const maxH = isGif ? Math.min(preset.maxHeight, 600) : preset.maxHeight;
  let outH = Math.min(intrinsic.h, maxH);
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
  const ctx = canvas.getContext('2d', { willReadFrequently: isGif });
  if (!ctx) throw new Error('2D canvas unavailable');

  const drawCtx: DrawCtx = { items, background, effects, webcam, layoutPreset, cropRegion, bgImage };

  // ── GIF path ──────────────────────────────────────────────────────────────
  // GIFs have no audio and a small palette, so we composite each frame the same
  // way (drawFrame) but encode with gifenc at a reduced, fixed frame rate. We
  // walk the source frames with the SAME trim/speed timeline math as the video
  // path, sampling one GIF frame per output 1/GIF_FPS slice.
  if (isGif) {
    const GIF_FPS = 15;
    const gifFrameMs = 1000 / GIF_FPS;
    const enc = GIFEncoder();
    let outMs = 0;
    let nextEmitMs = 0;
    let lastProgress = 0;
    for await (const wrapped of screenSink.canvases()) {
      const { canvas: srcCanvas, timestamp, duration } = wrapped;
      const ms = timestamp * 1000;
      const frameDuration = duration || 1 / 30;
      if (items.some((it) => it.kind === 'trim' && ms >= it.startMs && ms < it.endMs)) continue;
      const speed = items.find((it) => it.kind === 'speed' && ms >= it.startMs && ms <= it.endMs);
      const speedFactor = speed?.speed ?? 1;
      const endOut = outMs + (frameDuration / speedFactor) * 1000;
      if (endOut >= nextEmitMs) {
        let webcamCanvas: FrameSource | null = null;
        if (webcamSink) {
          const wc = await webcamSink.getCanvas(timestamp).catch(() => null);
          webcamCanvas = wc?.canvas ?? null;
        }
        drawFrame(ctx, outW, outH, srcCanvas, webcamCanvas, ms, drawCtx);
        let pixels: Uint8ClampedArray;
        try {
          pixels = ctx.getImageData(0, 0, outW, outH).data;
        } catch {
          throw new Error('GIF export can’t read a cross-origin background image. Use a solid colour, gradient, or an uploaded image.');
        }
        const palette = quantize(pixels, 256);
        const index = applyPalette(pixels, palette);
        // Emit one (or more, for slow-mo) GIF frame(s) for each elapsed slice.
        while (endOut >= nextEmitMs) {
          enc.writeFrame(index, outW, outH, { palette, delay: gifFrameMs });
          nextEmitMs += gifFrameMs;
        }
      }
      outMs = endOut;
      if (sourceDurationSec > 0) {
        const pct = Math.min(99, (timestamp / sourceDurationSec) * 100);
        if (pct - lastProgress >= 1) { lastProgress = pct; onProgress('Encoding GIF', pct); }
      }
    }
    onProgress('Saving', 99);
    enc.finish();
    const gifBytes = enc.bytes();
    const gifStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const gifRes = await window.api.saveExport({
      defaultName: `reframe-${gifStamp}`,
      data: gifBytes.slice().buffer,
      format: 'gif'
    });
    onProgress(gifRes.saved ? 'Done' : 'Cancelled', 100);
    return;
  }

  // WebM was requested → VP9/VP8 only. Otherwise prefer H.264/MP4 and fall
  // back to VP9/VP8 in WebM if the system can't encode H.264 via WebCodecs.
  const codecPrefs: VideoCodec[] = exportFormat === 'webm' ? ['vp9', 'vp8'] : ['avc', 'vp9', 'vp8'];
  const codec = await getFirstEncodableVideoCodec(codecPrefs, {
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

  // ── Audio track ─────────────────────────────────────────────────────────
  // Earlier versions added NO audio track, so every export was silent. We now
  // decode the source audio and rebuild it along the SAME timeline the video
  // uses — dropping trim regions and resampling speed regions (which shifts
  // pitch, the standard simple behaviour) so A/V stays in sync. Muted exports
  // intentionally omit the track; volume scales the samples. Audio tracks must
  // be added BEFORE output.start(), so we prepare the buffer up front.
  let audioSource: AudioBufferSource | null = null;
  let outAudioBuffer: AudioBuffer | null = null;
  if (!videoMuted) {
    try {
      const audioTrack = await screenInput.getPrimaryAudioTrack();
      if (audioTrack) {
        outAudioBuffer = await buildTimelineAudio(screenBlob, items, videoVolume);
        if (outAudioBuffer && outAudioBuffer.length > 0) {
          const audioCodec = await getFirstEncodableAudioCodec(
            isMp4 ? ['aac', 'opus'] : ['opus', 'vorbis'],
            { numberOfChannels: outAudioBuffer.numberOfChannels, sampleRate: outAudioBuffer.sampleRate }
          );
          if (audioCodec) {
            audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
            output.addAudioTrack(audioSource);
          } else {
            console.warn('[export] no encodable audio codec; exporting without audio');
            outAudioBuffer = null;
          }
        }
      }
    } catch (err) {
      console.warn('[export] audio passthrough failed; exporting without audio', err);
      audioSource = null;
      outAudioBuffer = null;
    }
  }

  await output.start();

  // ── Composite every source frame ────────────────────────────────────────
  // outTs accumulates the OUTPUT timeline position (seconds). For untouched
  // footage we emit one output frame per source frame with the source's own
  // duration. Trim regions drop frames; speed regions skip (fast-forward) or
  // duplicate (slow-motion) frames, keeping a constant output frame rate so
  // the muxer + every downstream player handles the file the same way.
  let outTs = 0;
  let lastProgress = 0;
  // Accumulator used in fast-forward regions: each source frame contributes
  // (1 / speedFactor) toward emitting one output frame; we emit + decrement
  // when the accumulator crosses 1. Reset on region change so the cadence
  // doesn't leak between regions.
  let fastForwardDebt = 0;
  let prevSpeedFactor = 1;

  for await (const wrapped of screenSink.canvases()) {
    const { canvas: srcCanvas, timestamp, duration } = wrapped;
    const ms = timestamp * 1000;
    const frameDuration = duration || 1 / 30;

    // Trim: drop frames inside any trim region entirely.
    const inTrim = items.some(
      (it) => it.kind === 'trim' && ms >= it.startMs && ms < it.endMs
    );
    if (inTrim) continue;

    // Speed region containing this source frame, if any.
    const speed = items.find(
      (it) => it.kind === 'speed' && ms >= it.startMs && ms <= it.endMs
    );
    const speedFactor = speed?.speed ?? 1;
    if (speedFactor !== prevSpeedFactor) {
      fastForwardDebt = 0;
      prevSpeedFactor = speedFactor;
    }

    // How many times should this source frame appear in the output?
    //   speedFactor = 1   → exactly one frame
    //   speedFactor > 1   → fractional emit via accumulator (skips frames)
    //   speedFactor < 1   → 1/speedFactor copies (duplicates for slow-mo)
    let emitCount: number;
    if (speedFactor === 1) {
      emitCount = 1;
    } else if (speedFactor > 1) {
      fastForwardDebt += 1 / speedFactor;
      emitCount = fastForwardDebt >= 1 ? 1 : 0;
      if (emitCount === 1) fastForwardDebt -= 1;
    } else {
      emitCount = Math.max(1, Math.round(1 / speedFactor));
    }
    if (emitCount === 0) continue;

    // Webcam frame for this timestamp (random-access; mediabunny caches).
    let webcamCanvas: FrameSource | null = null;
    if (webcamSink) {
      const wc = await webcamSink.getCanvas(timestamp).catch(() => null);
      webcamCanvas = wc?.canvas ?? null;
    }

    drawFrame(ctx, outW, outH, srcCanvas, webcamCanvas, ms, {
      items, background, effects, webcam, layoutPreset, cropRegion, bgImage
    });

    for (let i = 0; i < emitCount; i++) {
      await videoSource.add(outTs, frameDuration);
      outTs += frameDuration;
    }

    if (sourceDurationSec > 0) {
      const pct = Math.min(99, (timestamp / sourceDurationSec) * 100);
      if (pct - lastProgress >= 1) {
        lastProgress = pct;
        onProgress('Encoding', pct);
      }
    }
  }

  // Mux the rebuilt audio buffer (timestamps start at 0, aligning with frame 0).
  if (audioSource && outAudioBuffer) {
    onProgress('Encoding audio', 99);
    await audioSource.add(outAudioBuffer);
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

// ── Audio timeline rebuild ───────────────────────────────────────────────────
// Decodes the source recording's audio to PCM (Web Audio), then rebuilds it
// applying the SAME timeline transforms the video loop uses so the two stay in
// sync: frames inside a trim region are dropped; speed regions resample by
// dropping samples (fast-forward, pitch up) or duplicating them (slow-mo, pitch
// down) using the same accumulator cadence as the video. `volume` scales the
// samples. Returns null when the source has no decodable audio.
async function buildTimelineAudio(
  screenBlob: Blob,
  items: ReturnType<typeof useEditor.getState>['items'],
  volume: number
): Promise<AudioBuffer | null> {
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  const ac = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ac.decodeAudioData(await screenBlob.arrayBuffer());
  } catch {
    await ac.close().catch(() => {});
    return null; // no audio track, or codec the decoder can't handle
  }
  await ac.close().catch(() => {});

  const sr = decoded.sampleRate;
  const ch = decoded.numberOfChannels;
  const len = decoded.length;
  const vol = Math.max(0, Math.min(1, volume ?? 1));
  const inData: Float32Array[] = [];
  for (let c = 0; c < ch; c++) inData.push(decoded.getChannelData(c));

  const trims = items.filter((it) => it.kind === 'trim');
  const speeds = items.filter((it) => it.kind === 'speed');
  const speedAt = (ms: number) => speeds.find((s) => ms >= s.startMs && ms <= s.endMs)?.speed ?? 1;
  const inTrim = (ms: number) => trims.some((t) => ms >= t.startMs && ms < t.endMs);

  // Two passes: count output length, then fill preallocated buffers — avoids
  // multi-million-element array growth on longer recordings.
  const countEmit = (): number => {
    let total = 0, ffDebt = 0, prevF = 1;
    for (let i = 0; i < len; i++) {
      const ms = (i / sr) * 1000;
      if (inTrim(ms)) continue;
      const f = speedAt(ms);
      if (f !== prevF) { ffDebt = 0; prevF = f; }
      if (f === 1) total += 1;
      else if (f > 1) { ffDebt += 1 / f; if (ffDebt >= 1) { ffDebt -= 1; total += 1; } }
      else total += Math.max(1, Math.round(1 / f));
    }
    return total;
  };

  const outLen = countEmit();
  if (outLen === 0) return null;

  const outCtx = new AC();
  const outBuf = outCtx.createBuffer(ch, outLen, sr);
  const outData: Float32Array[] = [];
  for (let c = 0; c < ch; c++) outData.push(outBuf.getChannelData(c));

  let w = 0, ffDebt = 0, prevF = 1;
  for (let i = 0; i < len; i++) {
    const ms = (i / sr) * 1000;
    if (inTrim(ms)) continue;
    const f = speedAt(ms);
    if (f !== prevF) { ffDebt = 0; prevF = f; }
    let emit: number;
    if (f === 1) emit = 1;
    else if (f > 1) { ffDebt += 1 / f; emit = ffDebt >= 1 ? 1 : 0; if (emit) ffDebt -= 1; }
    else emit = Math.max(1, Math.round(1 / f));
    for (let k = 0; k < emit; k++) {
      for (let c = 0; c < ch; c++) outData[c][w] = inData[c][i] * vol;
      w++;
    }
  }
  await outCtx.close().catch(() => {});
  return outBuf;
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

  // Background. When blurBg is on, soften it to match the preview's CSS
  // `filter: blur(20px) scale(1.05)` — draw through a blur filter and overscan
  // ~5% so the blurred edges don't reveal the base fill underneath.
  ctx.save();
  if (effects.blurBg) ctx.filter = `blur(${Math.round(20 * (outH / 1080))}px)`;
  const ov = effects.blurBg ? 0.05 : 0;
  const bx = -outW * ov, by = -outH * ov, bw = outW * (1 + 2 * ov), bh = outH * (1 + 2 * ov);
  if (background.mode === 'color') {
    ctx.fillStyle = background.value;
    ctx.fillRect(bx, by, bw, bh);
  } else if (background.mode === 'gradient') {
    const grad = parseLinearGradient(ctx, background.value, outW, outH);
    ctx.fillStyle = grad ?? '#1a1d23';
    ctx.fillRect(bx, by, bw, bh);
  } else if (background.mode === 'image' && bgImage && bgImage.complete) {
    drawCover(ctx, bgImage, bx, by, bw, bh);
  }
  ctx.restore();

  const padding = effects.paddingPct / 100;
  const innerScale = 1 - padding * 0.5;

  const activeZoom = computeEasedZoom(items, ms);
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
    drawVideoBox(ctx, srcCanvas, innerX, innerY, vidW, innerH, effects.roundnessPx, cropRegion, activeZoom ?? undefined, effects.shadowPct, outH);
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
    drawVideoBox(ctx, srcCanvas, innerX, innerY, innerW, innerH, effects.roundnessPx, cropRegion, activeZoom ?? undefined, effects.shadowPct, outH);
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
    drawAnnotation(ctx, activeAnnotation, outW, outH);
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
  activeZoom?: { zoomLevel?: number; zoomTargetX?: number; zoomTargetY?: number },
  shadowPct = 0,
  outH = 1080
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

  // Drop shadow behind the framed box — matches the preview's CSS
  // `box-shadow: 0 (4+s/2)px (20+s)px rgba(0,0,0,s/100)` (Preview.tsx). Cast by
  // filling the rounded rect (opaque) with a shadow set; the clipped image then
  // paints over the fill, leaving only the shadow that spilled outside. Drawn
  // inside the zoom transform so it scales with the box, like the preview.
  const shadowAlpha = Math.max(0, shadowPct) / 100;
  if (shadowAlpha > 0) {
    const sc = outH / 1080;
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`;
    ctx.shadowBlur = (20 + shadowPct) * sc;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = (4 + shadowPct / 2) * sc;
    roundedRectPath(ctx, x, y, w, h, Math.min(roundness, Math.min(w, h) / 2));
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
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

// Renders an annotation honouring its styling fields. Positioned at the
// item's posX/posY (0..1 fractions of the canvas), with optional rounded
// background chip. Font size scales relative to a 1080-tall reference frame
// so a 32px choice looks the same regardless of export quality preset.
function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  item: ReturnType<typeof useEditor.getState>['items'][number],
  outW: number,
  outH: number
) {
  const text = item.text ?? '';
  if (!text) return;

  const fontFamily = item.fontFamily ?? ANNOTATION_DEFAULTS.fontFamily;
  const fontSizeSrc = item.fontSize ?? ANNOTATION_DEFAULTS.fontSize;
  // Scale the chosen px size against the output height so a "32px" annotation
  // looks the same at 1080p, 720p, or 4K.
  const fontSize = Math.max(10, Math.round(fontSizeSrc * (outH / 1080)));
  const bold = item.bold ?? ANNOTATION_DEFAULTS.bold;
  const italic = item.italic ?? ANNOTATION_DEFAULTS.italic;
  const textColor = item.textColor ?? ANNOTATION_DEFAULTS.textColor;
  const bg = item.backgroundColor === null ? null : (item.backgroundColor ?? ANNOTATION_DEFAULTS.backgroundColor);
  const textAlign = item.textAlign ?? ANNOTATION_DEFAULTS.textAlign;
  const posX = item.posX ?? ANNOTATION_DEFAULTS.posX;
  const posY = item.posY ?? ANNOTATION_DEFAULTS.posY;

  ctx.save();
  ctx.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${fontSize}px ${fontFamily}`;
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'middle';

  // Wrap if the text is too wide to fit 80% of the canvas — split on word
  // boundaries and stack lines vertically.
  const maxLineW = outW * 0.8;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const trial = line ? line + ' ' + w : w;
    if (ctx.measureText(trial).width > maxLineW && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);

  const lineHeight = fontSize * 1.25;
  const totalH = lineHeight * lines.length;
  const cx = posX * outW;
  const cy = posY * outH;
  const padding = fontSize * 0.5;

  if (bg) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const bw = Math.min(maxLineW + padding * 2, widest + padding * 2);
    const bh = totalH + padding;
    const bx = cx - bw / 2;
    const by = cy - bh / 2;
    ctx.fillStyle = bg;
    roundedRectPath(ctx, bx, by, bw, bh, 10);
    ctx.fill();
  }

  ctx.fillStyle = textColor;
  lines.forEach((l, i) => {
    const y = cy - totalH / 2 + lineHeight * (i + 0.5);
    ctx.fillText(l, cx, y);
  });

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
