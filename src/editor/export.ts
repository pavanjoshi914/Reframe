import {
  Input,
  Output,
  BufferSource,
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
import type { CursorSample, ClickSample, CursorKindSample } from '@shared/ipc';
import { renderCard3D, renderScene3D, projectCardPoint, type CardXform } from './card3d';
import { sceneInstances, heroIndex, DEFAULT_SCENE_SETTINGS, SCENE_SHAPE_RATIO, type SceneSettings } from './scenes';
import { CURSOR_GLYPHS, KIND_GLYPHS, CURSOR_IDLE_MS, CURSOR_IDLE_FADE_MS, CURSOR_MOVE_EPS_SQ } from './cursorGlyphs';

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

// Rich progress: a coarse stage + percentage, plus optional frame counters and
// a small live preview (data URL) so the UI can show "frame X / N" and the
// frame currently being processed, openscreen-style.
export type ProgressDetail = { frame?: number; totalFrames?: number; preview?: string };
type ProgressFn = (phase: string, pct: number, detail?: ProgressDetail) => void;

// Cooperative cancellation: the export loops poll this flag between frames so the
// progress modal's Cancel button can stop a long encode without an AbortSignal
// threaded through every mediabunny call.
let cancelRequested = false;
export function cancelExport() {
  cancelRequested = true;
}

// Downscale the export canvas to a small JPEG data URL for the progress modal's
// live "frame being processed" thumbnail. Reuses one offscreen canvas.
let previewCanvas: HTMLCanvasElement | null = null;
function snapshotPreview(src: HTMLCanvasElement): string {
  try {
    const W = 256;
    const h = Math.max(1, Math.round(W * (src.height / Math.max(1, src.width))));
    if (!previewCanvas) previewCanvas = document.createElement('canvas');
    previewCanvas.width = W;
    previewCanvas.height = h;
    const pctx = previewCanvas.getContext('2d');
    if (!pctx) return '';
    pctx.drawImage(src, 0, 0, W, h);
    return previewCanvas.toDataURL('image/jpeg', 0.5);
  } catch {
    return '';
  }
}

// A source frame the compositor can draw: an export decode canvas, a still
// image, or — in the live preview — a <video> element.
export type FrameSource = HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | HTMLVideoElement;

// Bitrate matters more than resolution for this content. A zoom is continuous
// full-frame motion — the hardest thing for an encoder — so a starved bitrate
// smears exactly during the zoom in/out and sharpens once the shot settles.
// The old middle tier was 5 Mbps and it is the DEFAULT, so most exports were
// quietly getting the softest zooms of the three.
//
// The ladder is shifted up a step: the default now encodes at what used to be
// the top tier, and the top tier is a genuinely transparent one for people who
// want a master. Resolution is only ever a CAP — `outH = min(source, maxHeight)`
// — so on a 1080p recording these differ by bitrate alone.
const QUALITY_PRESETS = {
  low: { maxHeight: 720, bitrate: 3_000_000 },
  medium: { maxHeight: 1440, bitrate: 12_000_000 },
  high: { maxHeight: 2160, bitrate: 28_000_000 }
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

// Zoom transition shape. The preview composites with this same drawFrame, so
// there is no CSS transition to keep in sync — changing it here changes both.
//
// Two styles, because they are genuinely different intents:
//
//  • snappy    — 450ms easeInOutCubic. Symmetric: accelerates and decelerates
//                equally, peak speed at the halfway point. The original feel.
//  • cinematic — 1100ms critically damped spring. Accelerates hard, then settles
//                slowly onto the target without overshoot, so
//                the move reads as a camera being placed rather than a jump.
//                Measured off reference demos from the tools people compare us
//                to: their transitions run ~1.1s with peak velocity at 6-12% of
//                the duration, which is an ease-OUT. A symmetric curve peaks at
//                50% — that difference is most of why 450ms/easeInOutCubic
//                reads as "snappy" and theirs reads as "expensive".
export type ZoomStyle = 'snappy' | 'cinematic';

function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
// Critically damped spring — the step response of a mass-spring-damper at
// exactly zeta=1: moves off immediately, never overshoots, settles asymptotically.
//
// k=10 puts peak velocity at 10% of the duration, which is what the reference
// demos measure at (6%, 12%, 12% across their three transitions). The obvious
// alternatives are wrong in a way you can feel rather than see: easeOutExpo and
// easeOutQuint both peak at t=0, i.e. they START at full speed — a velocity step
// that reads as a snap. A real camera move accelerates, however briefly.
// Normalized by its own value at t=1 so the zoom lands exactly on target
// (the raw response is at 99.95%, and that last 0.05% would be a visible
// half-pixel of drift at high zoom).
const SPRING_K = 10;
const SPRING_END = 1 - (1 + SPRING_K) * Math.exp(-SPRING_K);
function easeOutSpring(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return (1 - (1 + SPRING_K * x) * Math.exp(-SPRING_K * x)) / SPRING_END;
}
const zoomTransitionMs = (style?: ZoomStyle) => (style === 'snappy' ? 450 : 1100);
const zoomEase = (style?: ZoomStyle) => (style === 'snappy' ? easeInOutCubic : easeOutSpring);

// 3D rotation of the video card (degrees). All-zero = flat = the legacy 2D path.
export type Rotation = { tiltX: number; tiltY: number; spinZ: number };
export const NO_ROTATION: Rotation = { tiltX: 0, tiltY: 0, spinZ: 0 };
export const hasRotation = (r?: Rotation | null): r is Rotation =>
  !!r && (Math.abs(r.tiltX) > 1e-6 || Math.abs(r.tiltY) > 1e-6 || Math.abs(r.spinZ) > 1e-6);

type ZoomItem = {
  startMs: number; endMs: number; zoomLevel?: number; zoomTargetX?: number; zoomTargetY?: number;
  // Per-frame rotation from the rotation LANE, attached here so drawVideoBox /
  // cursorToOutput receive zoom + rotation together (they compose in one matrix).
  rotation?: Rotation;
  // Multi-card scene from the rotation lane (preset id + linear progress).
  // When set it replaces the single-card rotation render entirely.
  scene?: { id: string; p: number; tSec: number; settings: SceneSettings };
};

// Consecutive zoom regions this close (ms) are treated as ONE continuous zoom:
// the camera stays zoomed in and PANS from one focus to the next instead of
// zooming back out to 1× and in again between them (the ugly pump you get from
// back-to-back click-zooms). A real gap larger than this still zooms out.
const ZOOM_CONNECT_GAP_MS = 300;

type FocusLevel = { fx: number; fy: number; target: number };
const focusOf = (it: ZoomItem): FocusLevel => ({
  fx: it.zoomTargetX ?? 0.5,
  fy: it.zoomTargetY ?? 0.5,
  target: it.zoomLevel ?? 1.5
});
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const clamp01n = (n: number) => Math.max(0, Math.min(1, n));

// ── Rotation lane ──────────────────────────────────────────────────────────
// Rotation is its OWN lane, independent of zoom: a region tilts/spins the card
// over its time range, easing in over ROT_TRANSITION_MS at its start and out
// after its end (so it never snaps), and interpolating Start→End keyframes
// across the region. It composes with whatever zoom is active at that moment.
const ROT_TRANSITION_MS = 500;
type RotItem = { startMs: number; endMs: number; scene?: string; scenePosX?: number; scenePosY?: number; sceneSpeed?: number; sceneZoom?: number; sceneTiltX?: number; sceneTiltY?: number; sceneDepth?: number; sceneSpacing?: number; sceneRadius?: number; sceneShape?: SceneSettings['shape']; tiltX?: number; tiltY?: number; spinZ?: number; tiltXEnd?: number; tiltYEnd?: number; spinZEnd?: number };
const rotOf = (it: RotItem, p: number): Rotation => {
  const sx = it.tiltX ?? 0, sy = it.tiltY ?? 0, sz = it.spinZ ?? 0;
  return { tiltX: lerp(sx, it.tiltXEnd ?? sx, p), tiltY: lerp(sy, it.tiltYEnd ?? sy, p), spinZ: lerp(sz, it.spinZEnd ?? sz, p) };
};
// Effective rotation at `ms`, or null when no rotation region is active. If
// regions overlap, the later-starting one wins (it's the user's most recent
// intent at that instant).
// The active rotation-lane region at `ms` (rotation OR scene). Later-starting
// region wins; on a start-time tie the most recently ADDED one wins (higher
// index) — without the index tie-break, a stale region stacked on the same
// span silently shadows every newer one and edits appear to do nothing.
function activeRotItem(items: ReturnType<typeof useEditor.getState>['items'], ms: number, tailMs: number): RotItem | null {
  const regs = items
    .map((raw, i) => ({ it: raw as unknown as RotItem & { kind: string }, i }))
    .filter(({ it }) => it.kind === 'rotation' && ms >= it.startMs && ms <= it.endMs + tailMs)
    .sort((a, b) => (b.it.startMs - a.it.startMs) || (b.i - a.i));
  return regs[0]?.it ?? null;
}

// Multi-card scene active at `ms` — linear progress, no edge easing (a scene
// exists only inside its region; the arrangement itself carries the motion).
function computeScene(items: ReturnType<typeof useEditor.getState>['items'], ms: number): { id: string; p: number; tSec: number; settings: SceneSettings } | null {
  const regs = items
    .map((raw, i) => ({ it: raw as unknown as RotItem & { kind: string }, i }))
    .filter(({ it }) => (it.kind === 'scene' || (it.kind === 'rotation' && it.scene)) && ms >= it.startMs && ms <= it.endMs)
    .sort((a, b) => (b.it.startMs - a.it.startMs) || (b.i - a.i));
  const it = regs[0]?.it;
  if (!it) return null;
  const d = DEFAULT_SCENE_SETTINGS;
  const settings: SceneSettings = {
    speed: it.sceneSpeed ?? d.speed, zoom: it.sceneZoom ?? d.zoom,
    tiltX: it.sceneTiltX ?? d.tiltX, tiltY: it.sceneTiltY ?? d.tiltY,
    depth: it.sceneDepth ?? d.depth, spacing: it.sceneSpacing ?? d.spacing,
    radius: it.sceneRadius ?? d.radius, shape: it.sceneShape ?? d.shape,
    posX: it.scenePosX ?? d.posX, posY: it.scenePosY ?? d.posY
  };
  return { id: it.scene ?? 'orbit', p: clamp01n((ms - it.startMs) / Math.max(1, it.endMs - it.startMs)), tSec: Math.max(0, ms - it.startMs) / 1000, settings };
}

function computeRotation(items: ReturnType<typeof useEditor.getState>['items'], ms: number): Rotation | null {
  const T = ROT_TRANSITION_MS;
  const it = activeRotItem(items, ms, T);
  if (!it || it.scene) return null;
  // ease envelope at the region edges
  let env: number;
  if (ms < it.startMs + T) env = easeInOutCubic((ms - it.startMs) / T);
  else if (ms > it.endMs) env = 1 - easeInOutCubic((ms - it.endMs) / T);
  else env = 1;
  env = clamp01n(env);
  // keyframe progress across the region (clamped once we're in the ease-out tail)
  const p = easeInOutCubic(clamp01n((ms - it.startMs) / Math.max(1, it.endMs - it.startMs)));
  const r = rotOf(it, p);
  const out = { tiltX: r.tiltX * env, tiltY: r.tiltY * env, spinZ: r.spinZ * env };
  return hasRotation(out) ? out : null;
}

// Focus + target level within a chain at `ms`: held on each region's focus,
// and eased from one region's focus/level to the next across a window centred
// on their boundary (so the camera glides between clicks). The chain's outer
// ease-in/out is applied separately, on the level only.
function sampleChainFocus(chain: ZoomItem[], ms: number, style?: ZoomStyle): FocusLevel {
  const first = chain[0];
  const last = chain[chain.length - 1];
  if (ms <= first.startMs) return focusOf(first);
  if (ms >= last.endMs) return focusOf(last);
  const T0 = zoomTransitionMs(style);
  const half = T0 / 2;
  const panAt = (aItem: ZoomItem, bItem: ZoomItem, boundary: number): FocusLevel => {
    // A PAN between two focuses is symmetric either way — it has no "arrival"
    // to settle into, so it keeps the in-out curve even in cinematic mode.
    const p = easeInOutCubic(clamp01n((ms - (boundary - half)) / T0));
    const a = focusOf(aItem);
    const b = focusOf(bItem);
    return { fx: lerp(a.fx, b.fx, p), fy: lerp(a.fy, b.fy, p), target: lerp(a.target, b.target, p) };
  };
  for (let i = 0; i < chain.length; i++) {
    const it = chain[i];
    if (ms >= it.startMs && ms <= it.endMs) {
      // Near the boundary INTO the next region → pan toward it.
      if (i < chain.length - 1 && ms >= it.endMs - half) return panAt(it, chain[i + 1], it.endMs);
      // Near the boundary OUT OF the previous region → still panning in.
      if (i > 0 && ms <= chain[i - 1].endMs + half) return panAt(chain[i - 1], it, chain[i - 1].endMs);
      return focusOf(it);
    }
    // In a (small) gap between two connected regions → pan across it.
    if (i < chain.length - 1 && ms > it.endMs && ms < chain[i + 1].startMs) {
      return panAt(it, chain[i + 1], it.endMs);
    }
  }
  return focusOf(last);
}

// Returns the effective zoom (level + focus) at `ms`. Adjacent zoom regions
// (within ZOOM_CONNECT_GAP_MS) form a chain: the level eases in at the chain's
// start and out after its end, staying fully zoomed in between while the focus
// pans from region to region. Isolated zooms behave as before (ease in, hold,
// ease out). Returns null when no zoom is active nor easing out.
function computeEasedZoom(
  items: ReturnType<typeof useEditor.getState>['items'],
  ms: number,
  style?: ZoomStyle
): ZoomItem | null {
  const zooms = (items.filter((it) => it.kind === 'zoom') as ZoomItem[])
    .slice()
    .sort((a, b) => a.startMs - b.startMs);
  if (zooms.length === 0) return null;

  // Group adjacent regions into continuous-zoom chains.
  const chains: ZoomItem[][] = [];
  for (const z of zooms) {
    const chain = chains[chains.length - 1];
    if (chain && z.startMs <= chain[chain.length - 1].endMs + ZOOM_CONNECT_GAP_MS) chain.push(z);
    else chains.push([z]);
  }

  // The chain covering ms is active from its start until ZOOM_TRANSITION_MS
  // after its end (the ease-out tail).
  const T = zoomTransitionMs(style);
  const ease = zoomEase(style);
  const chain = chains.find((c) => ms >= c[0].startMs && ms <= c[c.length - 1].endMs + T);
  if (!chain) return null;
  const chainStart = chain[0].startMs;
  const chainEnd = chain[chain.length - 1].endMs;

  // Level envelope: ease in over the chain's first T, hold, ease out over the T
  // after its end — NOT reset between the chain's own regions.
  let env: number;
  if (ms < chainStart + T) env = ease((ms - chainStart) / T);
  // Zoom OUT is 1 - ease(u), NOT ease(1 - u).
  //
  // They look interchangeable and are not. ease(1-u) plays the curve backwards:
  // a fast-then-slow curve reversed is slow-then-FAST, so the camera sits at 96%
  // zoom for half the tail and then slams to wide at peak speed — the "it just
  // stops instantly" feel. 1 - ease(u) keeps the shape and only flips the
  // direction: it leaves briskly and glides to rest.
  //
  // The spring's derivative is zero at both ends (k²u·e^(-ku) vanishes at u=0
  // and u=1), so this is continuous in position AND velocity at every boundary,
  // which is the whole reason spring-driven motion reads as smooth rather than
  // merely eased.
  else if (ms > chainEnd) env = 1 - ease((ms - chainEnd) / T);
  else env = 1;
  env = clamp01n(env);

  const { fx, fy, target } = sampleChainFocus(chain, ms, style);
  return {
    startMs: chainStart,
    endMs: chainEnd,
    zoomLevel: 1 + (target - 1) * env,
    zoomTargetX: fx,
    zoomTargetY: fy
  };
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

/**
 * Runs the export and resolves to `true` only when a file actually landed on
 * disk — false if the user cancelled mid-encode or backed out of the save
 * dialog. The caller uses that to decide whether the moment is worth
 * celebrating (and worth asking anything of the user).
 */
export async function runExport({ onProgress }: { onProgress: ProgressFn }): Promise<boolean> {
  cancelRequested = false;
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
  // Read the recording into an ArrayBuffer rather than a Blob: `.blob()` parks
  // the body in Chromium's blob store, whose quota shrinks with free memory and
  // disk — on a stressed machine a ~40 MB recording fails with a bare
  // "Failed to fetch". An ArrayBuffer lives in this renderer and has no quota.
  const screenBuf = await (await fetch(fileUrl)).arrayBuffer();
  const screenInput = new Input({ source: new BufferSource(screenBuf), formats: ALL_FORMATS });
  const screenTrack = await screenInput.getPrimaryVideoTrack();
  if (!screenTrack) throw new Error('Recording has no video track.');
  const screenSink = new CanvasSink(screenTrack);

  let webcamSink: CanvasSink | null = null;
  if (webcamFileUrl && webcam.enabled) {
    try {
      const webcamBuf = await (await fetch(webcamFileUrl)).arrayBuffer();
      const webcamInput = new Input({ source: new BufferSource(webcamBuf), formats: ALL_FORMATS });
      const webcamTrack = await webcamInput.getPrimaryVideoTrack();
      if (webcamTrack) webcamSink = new CanvasSink(webcamTrack);
    } catch (err) {
      console.warn('[export] webcam track failed to open, exporting without it', err);
    }
  }

  // Sequential webcam follower — ONE decoder for the whole export.
  //
  // The obvious call, webcamSink.getCanvas(timestamp) once per composited
  // frame, creates and destroys a fresh VideoDecoder on EVERY call (mediabunny
  // treats each one-shot getCanvas as its own decode session). A 30s webcam
  // export is ~900 hardware-decoder create/destroy cycles; Windows' D3D11
  // decoder pool degrades under that churn and eventually a create fails
  // mid-export, which surfaced as "Export failed: Decoding error." on Windows
  // (and could hang the tail of the export). The export loop only ever moves
  // FORWARD through source time — trims and speed regions skip frames but
  // never rewind — so a single sequential canvases() iteration can follow it:
  // hold the current webcam frame until the screen timeline passes the next
  // one's timestamp. CanvasSink's default poolSize of 0 allocates a fresh
  // canvas per frame, so holding `current` while reading ahead is safe.
  function makeWebcamFollower(sink: CanvasSink) {
    type Wrapped = { canvas: FrameSource; timestamp: number };
    const iter = sink.canvases()[Symbol.asyncIterator]();
    let current: Wrapped | null = null;
    let next: Wrapped | null = null;
    let done = false;
    return async (timestampSec: number): Promise<FrameSource | null> => {
      try {
        while (!done) {
          if (!next) {
            const r = await iter.next();
            if (r.done || !r.value) { done = true; break; }
            next = r.value as unknown as Wrapped;
          }
          if (next.timestamp <= timestampSec) { current = next; next = null; }
          else break;
        }
      } catch (err) {
        // A webcam decode failure must never kill the export — match the old
        // getCanvas().catch(() => null) behaviour and just stop following.
        console.warn('[export] webcam follower stopped', err);
        done = true;
      }
      return current?.canvas ?? null;
    };
  }
  const webcamFrameAt = webcamSink ? makeWebcamFollower(webcamSink) : null;

  const sourceDurationSec = await screenTrack.computeDuration();
  // The real number of source frames (= encoded packets). MediaRecorder WebMs
  // often carry an unreliable duration, so driving progress off timestamps can
  // saturate at 99% partway through and freeze the frame counter. The packet
  // count is exact, so we drive both the percentage AND the "frame X / N"
  // counter off frames actually processed.
  let totalSrcFrames = 0;
  try {
    totalSrcFrames = (await screenTrack.computePacketStats()).packetCount;
  } catch { /* fall back to the duration estimate below */ }

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

  const drawCtx: DrawCtx = { items, background, effects, webcam, layoutPreset, cropRegion, bgImage, cursorSamples: state.cursorSamples, cursorSamplesSmooth: state.cursorSamplesSmooth, cursorClicks: state.cursorClicks, cursorKinds: state.cursorKinds, cursorFx: state.cursorFx, zoomStyle: state.zoomStyle };

  // Motion blur: composite each frame onto a scratch canvas, then blend it onto
  // the output at alpha (1-k) so the output is an exponential frame average
  // (out = (1-k)·frame + k·out). k=0 ⇒ alpha 1 ⇒ exact frame (no blur). Matches
  // the preview's identical blend in Preview.tsx.
  const motionBlur = Math.max(0, Math.min(0.9, effects.motionBlur || 0));
  const work = document.createElement('canvas');
  work.width = outW;
  work.height = outH;
  const workCtx = work.getContext('2d');
  if (!workCtx) throw new Error('2D canvas unavailable');
  const composite = (srcF: FrameSource, wcF: FrameSource | null, ms: number) => {
    drawFrame(workCtx, outW, outH, srcF, wcF, ms, drawCtx);
    ctx.globalAlpha = 1 - motionBlur;
    ctx.drawImage(work, 0, 0);
    ctx.globalAlpha = 1;
  };

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
    let gifFrameCount = 0;
    let gifTotalEst = totalSrcFrames;
    let gifPreviewPct = -100;
    for await (const wrapped of screenSink.canvases()) {
      if (cancelRequested) break;
      const { canvas: srcCanvas, timestamp, duration } = wrapped;
      const ms = timestamp * 1000;
      const frameDuration = duration || 1 / 30;
      if (!gifTotalEst && sourceDurationSec > 0) gifTotalEst = Math.max(1, Math.round(sourceDurationSec / frameDuration));
      gifFrameCount++;
      if (items.some((it) => it.kind === 'trim' && ms >= it.startMs && ms < it.endMs)) continue;
      const speed = items.find((it) => it.kind === 'speed' && ms >= it.startMs && ms <= it.endMs);
      const speedFactor = speed?.speed ?? 1;
      const endOut = outMs + (frameDuration / speedFactor) * 1000;
      if (endOut >= nextEmitMs) {
        const webcamCanvas: FrameSource | null = webcamFrameAt ? await webcamFrameAt(timestamp) : null;
        composite(srcCanvas, webcamCanvas, ms);
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
      {
        const pct = gifTotalEst
          ? Math.min(99, (gifFrameCount / gifTotalEst) * 100)
          : sourceDurationSec > 0 ? Math.min(99, (timestamp / sourceDurationSec) * 100) : 0;
        if (pct - lastProgress >= 1) {
          lastProgress = pct;
          let preview: string | undefined;
          if (pct - gifPreviewPct >= 4) { gifPreviewPct = pct; preview = snapshotPreview(canvas); }
          onProgress('Encoding GIF', pct, { frame: gifFrameCount, totalFrames: gifTotalEst, preview });
        }
      }
    }
    if (cancelRequested) { onProgress('Cancelled', 100); return false; }
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
    return gifRes.saved;
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
    bitrate: preset.bitrate,
    // Speed: the low-latency encode path skips the heavy multi-frame
    // lookahead/rate-control — a solid wall-time win at negligible quality cost
    // for screen recordings. We deliberately leave hardwareAcceleration at its
    // default ('no-preference'): that still uses a GPU encoder when the machine
    // has one, but — unlike 'prefer-hardware' — it falls back to software
    // instead of failing the whole export when no hardware encoder exists.
    latencyMode: 'realtime'
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
        outAudioBuffer = await buildTimelineAudio(screenBuf, items, videoVolume);
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
  // Frame counters + preview throttle for the progress modal. totalFramesEst
  // prefers the exact packet count; only if that wasn't available do we fall
  // back to a per-frame-duration estimate.
  let srcFrameCount = 0;
  let totalFramesEst = totalSrcFrames;
  let lastPreviewPct = -100;

  for await (const wrapped of screenSink.canvases()) {
    if (cancelRequested) break;
    const { canvas: srcCanvas, timestamp, duration } = wrapped;
    const ms = timestamp * 1000;
    const frameDuration = duration || 1 / 30;
    if (!totalFramesEst && sourceDurationSec > 0) {
      totalFramesEst = Math.max(1, Math.round(sourceDurationSec / frameDuration));
    }
    srcFrameCount++;

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

    // Webcam frame for this timestamp (sequential follower — see above).
    const webcamCanvas: FrameSource | null = webcamFrameAt ? await webcamFrameAt(timestamp) : null;

    composite(srcCanvas, webcamCanvas, ms);

    for (let i = 0; i < emitCount; i++) {
      await videoSource.add(outTs, frameDuration);
      outTs += frameDuration;
    }

    // Drive progress off frames processed when we know the total (exact, never
    // saturates); fall back to the timestamp ratio only if we have no count.
    const pct = totalFramesEst
      ? Math.min(99, (srcFrameCount / totalFramesEst) * 100)
      : sourceDurationSec > 0 ? Math.min(99, (timestamp / sourceDurationSec) * 100) : 0;
    if (pct - lastProgress >= 1) {
      lastProgress = pct;
      // A small JPEG snapshot every ~4% gives the modal a live "frame being
      // processed" preview without the cost of doing it every frame.
      let preview: string | undefined;
      if (pct - lastPreviewPct >= 4) {
        lastPreviewPct = pct;
        preview = snapshotPreview(canvas);
      }
      onProgress('Encoding', pct, { frame: srcFrameCount, totalFrames: totalFramesEst, preview });
    }
  }

  // Make sure the counter lands on the true total even if the last 1% tick fell
  // a few frames short of the end.
  if (!cancelRequested && totalFramesEst) {
    onProgress('Encoding', 99, { frame: srcFrameCount, totalFrames: totalFramesEst });
  }

  if (cancelRequested) {
    try { await output.finalize(); } catch { /* nothing to keep */ }
    onProgress('Cancelled', 100);
    return false;
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
    return false;
  }
  onProgress('Done', 100);
  return true;
}

// ── Audio timeline rebuild ───────────────────────────────────────────────────
// Decodes the source recording's audio to PCM (Web Audio), then rebuilds it
// applying the SAME timeline transforms the video loop uses so the two stay in
// sync: frames inside a trim region are dropped; speed regions resample by
// dropping samples (fast-forward, pitch up) or duplicating them (slow-mo, pitch
// down) using the same accumulator cadence as the video. `volume` scales the
// samples. Returns null when the source has no decodable audio.
async function buildTimelineAudio(
  screenBuf: ArrayBuffer,
  items: ReturnType<typeof useEditor.getState>['items'],
  volume: number
): Promise<AudioBuffer | null> {
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  const ac = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ac.decodeAudioData(screenBuf.slice(0));
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

export type DrawCtx = {
  items: ReturnType<typeof useEditor.getState>['items'];
  background: ReturnType<typeof useEditor.getState>['background'];
  effects: ReturnType<typeof useEditor.getState>['effects'];
  webcam: ReturnType<typeof useEditor.getState>['webcam'];
  layoutPreset: ReturnType<typeof useEditor.getState>['layoutPreset'];
  cropRegion: CropRegion;
  bgImage: HTMLImageElement | null;
  cursorSamples?: CursorSample[];
  cursorSamplesSmooth?: CursorSample[];
  cursorClicks?: ClickSample[];
  cursorKinds?: CursorKindSample[];
  cursorFx?: { enabled: boolean; size: number; clicks: boolean; clickPress?: boolean; smoothing?: number; style?: string; color?: string; hideWhenIdle?: boolean; emoji?: string; motionBlur?: number; tilt?: number };
  zoomStyle?: ZoomStyle;
};

// Interpolated cursor position (normalized 0..1 of the source frame) at `ms`,
// or null if there are no samples. Used by the cursor spotlight/magnifier.
function cursorAt(samples: CursorSample[] | undefined, ms: number): { x: number; y: number } | null {
  if (!samples || samples.length === 0) return null;
  if (ms <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  const last = samples[samples.length - 1];
  if (ms >= last.t) return { x: last.x, y: last.y };
  // binary search for the bracketing pair
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= ms) lo = mid; else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const f = b.t === a.t ? 0 : (ms - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Interpolated cursor position at `ms` using a CENTRIPETAL Catmull-Rom spline
// (alpha = 0.5) through the four surrounding samples — a smooth curve that
// passes through every real point (no offset) and curves nicely between sparse
// samples during fast moves (where linear interpolation looks angular), without
// the overshoot uniform Catmull-Rom can produce. Falls back to linear when
// there aren't enough points.
function cursorAtSpline(samples: CursorSample[] | undefined, ms: number): { x: number; y: number } | null {
  if (!samples || samples.length === 0) return null;
  if (samples.length < 4) return cursorAt(samples, ms);
  if (ms <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  const last = samples[samples.length - 1];
  if (ms >= last.t) return { x: last.x, y: last.y };
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= ms) lo = mid; else hi = mid;
  }
  const i1 = lo, i2 = hi;
  const p1 = samples[i1], p2 = samples[i2];
  const p0 = samples[Math.max(0, i1 - 1)];
  const p3 = samples[Math.min(samples.length - 1, i2 + 1)];
  const segLen = p2.t - p1.t;
  const t = segLen > 0 ? (ms - p1.t) / segLen : 0;
  const knot = (ti: number, a: { x: number; y: number }, b: { x: number; y: number }) =>
    ti + Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)); // alpha = 0.5
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  if (t1 === t0 || t2 === t1 || t3 === t2) {
    return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
  }
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, u: number) => ({
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u
  });
  const tt = t1 + (t2 - t1) * t;
  const A1 = lerp(p0, p1, (tt - t0) / (t1 - t0));
  const A2 = lerp(p1, p2, (tt - t1) / (t2 - t1));
  const A3 = lerp(p2, p3, (tt - t2) / (t3 - t2));
  const B1 = lerp(A1, A2, (tt - t0) / (t2 - t0));
  const B2 = lerp(A2, A3, (tt - t1) / (t3 - t1));
  return lerp(B1, B2, (tt - t1) / (t2 - t1));
}

// Map a cursor (normalized source coords) to output-canvas pixels, mirroring
// drawCoverWithCrop's crop+cover fit and then drawVideoBox's zoom transform, so
// the spotlight/magnifier track exactly where the cursor appears on screen.
// Returns null if the cursor falls outside the visible (cropped) region.
function cursorToOutput(
  cur: { x: number; y: number },
  srcW: number, srcH: number,
  crop: CropRegion,
  bx: number, by: number, bw: number, bh: number,
  zoom?: { zoomLevel?: number; zoomTargetX?: number; zoomTargetY?: number; rotation?: Rotation; scene?: { id: string; p: number; tSec: number; settings: SceneSettings } },
  outWForCursor = 0, outHForCursor = 0
): { x: number; y: number } | null {
  if (!srcW || !srcH) return null;
  const sxp = cur.x * srcW, syp = cur.y * srcH;
  const cropPxW = crop.width * srcW, cropPxH = crop.height * srcH;
  if (cropPxW <= 0 || cropPxH <= 0) return null;
  const scale = Math.max(bw / cropPxW, bh / cropPxH);
  const overflowSrcW = (cropPxW * scale - bw) / scale;
  const overflowSrcH = (cropPxH * scale - bh) / scale;
  const sxStart = crop.x * srcW + overflowSrcW / 2;
  const syStart = crop.y * srcH + overflowSrcH / 2;
  const sW = cropPxW - overflowSrcW, sH = cropPxH - overflowSrcH;
  if (sxp < sxStart || sxp > sxStart + sW || syp < syStart || syp > syStart + sH) return null;
  // Where the point sits ON the card, 0..1 (card space).
  const u = (sxp - sxStart) / sW;
  const v = (syp - syStart) / sH;
  const z = zoom?.zoomLevel ?? 1;
  const tx = (0.5 - (zoom?.zoomTargetX ?? 0.5)) * (z - 1) * bw;
  const ty = (0.5 - (zoom?.zoomTargetY ?? 0.5)) * (z - 1) * bh;
  // 3D: push the card-space point through the SAME perspective matrix the
  // card was drawn with, so the cursor / ripples / spotlight stay glued to the
  // tilted surface. (projectCardPoint reproduces the flat 2D mapping exactly
  // when rotation is zero — verified — but we keep the cheap 2D math for that
  // case anyway so the legacy path is untouched.)
  const rot = zoom?.rotation;
  const scn = zoom?.scene;
  if (scn && outWForCursor > 0) {
    // Multi-card scene: glue the cursor to the card fronting the arrangement.
    const cards = sceneInstances(scn.id, scn.p, scn.settings, scn.tSec);
    if (cards?.length) {
      const [cbx, cby, cbw, cbh] = sceneCardBox(bx, by, bw, bh, scn.settings, outWForCursor, outHForCursor);
      const xf: CardXform = { outW: outWForCursor, outH: outHForCursor, bx: cbx, by: cby, bw: cbw, bh: cbh, zoom: z, zoomTx: tx, zoomTy: ty, rot: NO_ROTATION };
      return projectCardPoint(xf, u, v, cards[heroIndex(cards)]);
    }
  }
  if (hasRotation(rot) && outWForCursor > 0) {
    const xf: CardXform = { outW: outWForCursor, outH: outHForCursor, bx, by, bw, bh, zoom: z, zoomTx: tx, zoomTy: ty, rot };
    return projectCardPoint(xf, u, v);
  }
  let px = bx + u * bw;
  let py = by + v * bh;
  if (z !== 1) {
    const cx0 = bx + bw / 2, cy0 = by + bh / 2;
    px = z * px + cx0 * (1 - z) + z * tx;
    py = z * py + cy0 * (1 - z) + z * ty;
  }
  return { x: px, y: py };
}

// Composite one fully-rendered frame onto `ctx`. Shared by the export encoder
// (one call per output frame) and the live editor preview (one call per rAF,
// with <video> elements as the frame sources) so the two render identically.
export function drawFrame(
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

  // Zoom and rotation are separate lanes but render through ONE card transform
  // (they compose in the same matrix), so attach the frame's rotation to the
  // zoom object drawVideoBox / cursorToOutput already receive. Rotation with no
  // zoom active still needs a carrier — a 1x zoom at centre is the identity.
  const zoomOnly = computeEasedZoom(items, ms, d.zoomStyle);
  const rotation = computeRotation(items, ms);
  const scene = computeScene(items, ms);
  const activeZoom = rotation || scene
    ? { ...(zoomOnly ?? { startMs: 0, endMs: 0, zoomLevel: 1, zoomTargetX: 0.5, zoomTargetY: 0.5 }), rotation: rotation ?? undefined, scene: scene ?? undefined }
    : zoomOnly;
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
      // Shrink the bubble as the camera zooms in. Driven by the SAME eased zoom
      // level the video card uses, so the two move in lockstep instead of the
      // webcam popping after the zoom lands.
      //
      // zoom^-0.75, floored at 0.45.
      //
      // The reference sits at ~0.75x while zoomed to roughly 2x (zoom^-0.4), but
      // that's subtle enough to read as "the webcam didn't change" rather than as
      // a deliberate move. This is tuned DELIBERATELY past the reference so the
      // shrink is legible: at 2.5x the bubble is now half its wide size instead
      // of 0.69 — about 20 points more reduction.
      //
      // The floor has to come down with the exponent or it does nothing: the old
      // 0.6 clamp would have caught 2.5x (0.50) and cancelled the change outright.
      const zLevel = Math.max(1, activeZoom?.zoomLevel ?? 1);
      const zoomScale = Math.max(0.45, Math.pow(zLevel, -0.75));
      const wcH = outH * webcam.size * zoomScale;
      const wcW = wcH * (webcam.shape === 'rectangle' ? 16 / 9 : 1);
      // Keep the bubble's MARGIN constant as it resizes, so it stays pinned to
      // its corner instead of drifting inward (x/y are the top-left, so a
      // shrinking box would otherwise pull away from the bottom/right edges).
      const fullH = outH * webcam.size;
      const fullW = fullH * (webcam.shape === 'rectangle' ? 16 / 9 : 1);
      const anchorR = webcam.x * outW + fullW;   // right edge at full size
      const anchorB = webcam.y * outH + fullH;   // bottom edge at full size
      // Which corner it's parked in is decided by the box's CENTRE, not its
      // top-left: a tall bubble sitting on the bottom edge still has a top-left
      // y well above the midpoint (the reference's is 0.48), and anchoring that
      // to the top would make it climb away from the edge as it shrank.
      const cxFull = webcam.x + fullW / outW / 2;
      const cyFull = webcam.y + fullH / outH / 2;
      const wx = cxFull > 0.5 ? anchorR - wcW : webcam.x * outW;
      const wy = cyFull > 0.5 ? anchorB - wcH : webcam.y * outH;
      // Radius as a FRACTION of the box, not a pixel cap. The old
      // min(h/4, 24px@1080) capped a 0.45-height bubble at ~24px of rounding,
      // which reads as a plain rectangle; the reference sits at 0.35 of the box.
      const cornerRadius =
        webcam.shape === 'circle' ? wcH / 2 : Math.min(wcW, wcH) * WEBCAM_CORNER_RATIO;
      if (webcamCanvas) {
        drawWebcamVideo(ctx, webcamCanvas, wx, wy, wcW, wcH, cornerRadius, webcam.shape === 'circle');
      } else {
        drawWebcamPlaceholder(ctx, wx, wy, wcW, wcH, cornerRadius);
      }
    }
    // Cursor spotlight + magnifier. Each is active either globally (its slider,
    // applied to the whole video) OR within a placed timeline region. A region
    // either follows the recorded cursor ('cursor', default) or sits at a fixed
    // user-dragged point ('manual', posX/posY as fractions of the output frame).
    const magItem = items.find((it) => it.kind === 'magnify' && ms >= it.startMs && ms <= it.endMs);
    const spotItem = items.find((it) => it.kind === 'spotlight' && ms >= it.startMs && ms <= it.endMs);
    const globalMag = effects.cursorMagnifier;
    const globalSpot = effects.cursorSpotlight;
    if (globalMag > 0 || globalSpot > 0 || magItem || spotItem) {
      // Position following the recorded cursor — shared by the global sliders
      // and any 'cursor'-tracked region. Null when there's no cursor data.
      let cursorPos: { x: number; y: number } | null = null;
      if (d.cursorSamples) {
        const cur = cursorAt(d.cursorSamples, ms);
        if (cur) {
          const { w: sw, h: sh } = srcDims(srcCanvas);
          cursorPos = cursorToOutput(cur, sw, sh, cropRegion, innerX, innerY, innerW, innerH, activeZoom ?? undefined, outW, outH);
        }
      }
      const manualPos = (it: { posX?: number; posY?: number }) => ({ x: (it.posX ?? 0.5) * outW, y: (it.posY ?? 0.5) * outH });
      // Magnifier: global slider wins; else the in-range region at default strength.
      if (globalMag > 0) {
        if (cursorPos) drawCursorMagnifier(ctx, outW, outH, cursorPos.x, cursorPos.y, globalMag);
      } else if (magItem) {
        const p = magItem.track === 'manual' ? manualPos(magItem) : cursorPos;
        if (p) drawCursorMagnifier(ctx, outW, outH, p.x, p.y, 0.7);
      }
      // Spotlight: same resolution.
      if (globalSpot > 0) {
        if (cursorPos) drawCursorSpotlight(ctx, outW, outH, cursorPos.x, cursorPos.y, globalSpot);
      } else if (spotItem) {
        const p = spotItem.track === 'manual' ? manualPos(spotItem) : cursorPos;
        if (p) drawCursorSpotlight(ctx, outW, outH, p.x, p.y, 0.8);
      }
    }

    // Synthetic cursor + click ripples — the "smooth cursor" demo look. The
    // pointer follows the (optionally smoothed) recorded path through the same
    // crop/zoom transform as the content, but its SIZE is constant in output
    // space (it doesn't grow when the video zooms in). Drawn on top of effects.
    // During a multi-card scene there is no single surface the pointer belongs
    // to, and a cursor floating over flying tiles reads as a glitch — hide it
    // and let it return with the plain video when the scene ends.
    const cfx = d.cursorFx;
    if (cfx?.enabled && !scene && (d.cursorSamples?.length || d.cursorClicks?.length)) {
      const { w: sw, h: sh } = srcDims(srcCanvas);
      const toOut = (nx: number, ny: number) =>
        cursorToOutput({ x: nx, y: ny }, sw, sh, cropRegion, innerX, innerY, innerW, innerH, activeZoom ?? undefined, outW, outH);
      if (cfx.clicks && d.cursorClicks) {
        for (const c of d.cursorClicks) {
          const age = ms - c.t;
          if (age < 0 || age > CLICK_RIPPLE_MS) continue;
          const p = toOut(c.x, c.y);
          if (p) drawClickRipple(ctx, p.x, p.y, age / CLICK_RIPPLE_MS, outH);
        }
      }
      // Blend the raw (pixel-exact) and One-Euro-smoothed positions by the
      // smoothing amount: 0 = exactly where the cursor was, 1 = full glide.
      const sm = Math.max(0, Math.min(1, cfx.smoothing ?? 0.5));
      const raw = cursorAt(d.cursorSamples, ms);
      const smooth = d.cursorSamplesSmooth?.length ? cursorAtSpline(d.cursorSamplesSmooth, ms) : raw;
      const cur =
        raw && smooth ? { x: raw.x + (smooth.x - raw.x) * sm, y: raw.y + (smooth.y - raw.y) * sm } : smooth || raw;
      if (cur) {
        const p = toOut(cur.x, cur.y);
        // Where the pointer was one frame ago, measured through the SAME blend
        // and projection, so the travel vector is in output pixels and already
        // accounts for zoom/rotation — a flick during a 2x zoom smears twice as
        // far on screen, which is correct.
        const pm = ms - CURSOR_MOTION_DT_MS;
        const rawPrev = cursorAt(d.cursorSamples, pm);
        const smoothPrev = d.cursorSamplesSmooth?.length ? cursorAtSpline(d.cursorSamplesSmooth, pm) : rawPrev;
        const prev =
          rawPrev && smoothPrev
            ? { x: rawPrev.x + (smoothPrev.x - rawPrev.x) * sm, y: rawPrev.y + (smoothPrev.y - rawPrev.y) * sm }
            : smoothPrev || rawPrev;
        const pPrev = prev ? toOut(prev.x, prev.y) : null;
        // "Hide when idle": fade the pointer out while it sits still, so a
        // paused demo isn't dominated by a parked arrow. Click ripples are
        // exempt — a click is activity by definition.
        const idleA = cfx.hideWhenIdle ? cursorIdleAlpha(d.cursorSamples, ms) : 1;
        if (p && idleA > 0.01) {
          ctx.save();
          ctx.globalAlpha *= idleA;
          // 'system' means "whatever the OS was showing", resolved per frame
          // from the captured kinds; every other style is a fixed glyph.
          const style = (cfx.style ?? 'system') === 'system'
            ? glyphForKind(d.cursorKinds, ms)
            : cfx.style!;
          const press = (cfx.clickPress ?? true) ? clickPressScale(d.cursorClicks, ms) : 1;
          drawCursorWithMotion(
            ctx, p.x, p.y, pPrev?.x ?? null, pPrev?.y ?? null,
            cfx.size * press, outH, style, cfx.color ?? '#ffffff', cfx.emoji ?? '',
            cfx.motionBlur ?? 0, cfx.tilt ?? 0
          );
          ctx.restore();
        }
      }
    }
  }

  // Redaction: blur/pixelate any active blur regions over the composited frame
  // (above the video + cursor, below annotations) so sensitive areas are hidden.
  drawBlurRegions(ctx, items, ms, outW, outH);

  if (activeAnnotation && activeAnnotation.text) {
    drawAnnotation(ctx, activeAnnotation, outW, outH);
  }

  ctx.restore();
}

// Reusable offscreen scratch for blur/pixelate so we don't allocate a canvas
// every frame during export.
let blurScratch: OffscreenCanvas | null = null;
function scratchCanvas(w: number, h: number): OffscreenCanvas {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (!blurScratch) blurScratch = new OffscreenCanvas(cw, ch);
  else if (blurScratch.width < cw || blurScratch.height < ch) {
    blurScratch.width = Math.max(blurScratch.width, cw);
    blurScratch.height = Math.max(blurScratch.height, ch);
  }
  return blurScratch;
}

// Blur (or pixelate) each active blur region's rectangle in output space. The
// rect is stored as fractions (0..1) of the output frame. Gaussian blur copies
// the rect PLUS a margin to a scratch canvas and draws it back through a blur
// filter clipped to the rect (so edges sample real neighbouring pixels — no
// halo); pixelate down- then up-scales with smoothing off.
function drawBlurRegions(
  ctx: CanvasRenderingContext2D,
  items: DrawCtx['items'],
  ms: number,
  outW: number,
  outH: number
) {
  for (const it of items) {
    if (it.kind !== 'blur' || ms < it.startMs || ms > it.endMs) continue;
    const rx = Math.round((it.rectX ?? 0.34) * outW);
    const ry = Math.round((it.rectY ?? 0.4) * outH);
    const rw = Math.round((it.rectW ?? 0.32) * outW);
    const rh = Math.round((it.rectH ?? 0.14) * outH);
    if (rw <= 1 || rh <= 1) continue;
    const strength = Math.max(0, Math.min(1, it.blurStrength ?? 0.5));
    const sc = outH / 1080;
    if ((it.blurStyle ?? 'blur') === 'pixelate') {
      const block = Math.max(4, Math.round((6 + strength * 30) * sc));
      const dw = Math.max(1, Math.round(rw / block));
      const dh = Math.max(1, Math.round(rh / block));
      const tmp = scratchCanvas(dw, dh);
      const tctx = tmp.getContext('2d') as OffscreenCanvasRenderingContext2D;
      tctx.imageSmoothingEnabled = false;
      tctx.clearRect(0, 0, dw, dh);
      tctx.drawImage(ctx.canvas, rx, ry, rw, rh, 0, 0, dw, dh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(tmp, 0, 0, dw, dh, rx, ry, rw, rh);
      ctx.restore();
    } else {
      const px = Math.max(2, Math.round((6 + strength * 34) * sc));
      const m = px * 2;
      const sx = Math.max(0, rx - m);
      const sy = Math.max(0, ry - m);
      const sw = Math.min(outW, rx + rw + m) - sx;
      const sh = Math.min(outH, ry + rh + m) - sy;
      const tmp = scratchCanvas(sw, sh);
      const tctx = tmp.getContext('2d') as OffscreenCanvasRenderingContext2D;
      tctx.clearRect(0, 0, sw, sh);
      tctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.filter = `blur(${px}px)`;
      ctx.drawImage(tmp, 0, 0, sw, sh, sx, sy, sw, sh);
      ctx.filter = 'none';
      ctx.restore();
    }
  }
}

// Scratch canvas the 3D path renders the flat card into before texturing it.
// Reused across frames (resized when the box size changes) so the preview
// doesn't allocate a 1440x810 canvas 60 times a second.
let _cardCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
// The unit card for a scene: the largest box of the chosen aspect that fits
// inside the video box, centred. '16:9'-ish shapes keep the full box.
function sceneCardBox(x: number, y: number, w: number, h: number, st: SceneSettings, outW: number, outH: number): [number, number, number, number] {
  const r = SCENE_SHAPE_RATIO[st.shape];
  const cw = Math.min(w, h * r);
  const ch = cw / r;
  // Position moves the whole arrangement: its centre lands at (posX, posY) of
  // the frame instead of the frame centre.
  const dx = (st.posX - 0.5) * outW, dy = (st.posY - 0.5) * outH;
  return [x + (w - cw) / 2 + dx, y + (h - ch) / 2 + dy, cw, ch];
}

function cardCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (!_cardCanvas) {
    _cardCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  } else if (_cardCanvas.width !== w || _cardCanvas.height !== h) {
    _cardCanvas.width = w; _cardCanvas.height = h;
  }
  return _cardCanvas;
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
  activeZoom?: { zoomLevel?: number; zoomTargetX?: number; zoomTargetY?: number; rotation?: Rotation; scene?: { id: string; p: number; tSec: number; settings: SceneSettings } },
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
  const tx = (0.5 - (activeZoom?.zoomTargetX ?? 0.5)) * (z - 1) * w;
  const ty = (0.5 - (activeZoom?.zoomTargetY ?? 0.5)) * (z - 1) * h;

  // ── 3D rotation (tilt / spin) ─────────────────────────────────────────
  // A 2D canvas can't do perspective, so when the zoom carries a rotation we
  // render the card flat (cropped video + rounded corners, exactly as below)
  // into an offscreen canvas and draw it as ONE textured quad on WebGL with a
  // real perspective projection — zoom folded into the same matrix so it
  // composes identically. The rotation-free path below is untouched, so every
  // existing project renders byte-for-byte as before.
  const rot = activeZoom?.rotation;
  const scene = activeZoom?.scene;
  const sceneCards = scene ? sceneInstances(scene.id, scene.p, scene.settings, scene.tSec) : null;
  if (hasRotation(rot) || sceneCards) {
    const outW = ctx.canvas.width;
    // A scene can re-crop the card to a chosen shape (1:1, 9:16…); the unit
    // card the instances are laid out around is then that smaller box.
    const [cx0, cy0, cw, ch] = scene ? sceneCardBox(x, y, w, h, scene.settings, outW, outH) : [x, y, w, h];
    const xf: CardXform = { outW, outH, bx: cx0, by: cy0, bw: cw, bh: ch, zoom: z, zoomTx: tx, zoomTy: ty, rot: rot ?? NO_ROTATION };
    const card = cardCanvas(Math.max(2, Math.round(cw)), Math.max(2, Math.round(ch)));
    const cctx = card.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    cctx.clearRect(0, 0, card.width, card.height);
    cctx.save();
    roundedRectPath(cctx as CanvasRenderingContext2D, 0, 0, card.width, card.height, Math.min(roundness, Math.min(cw, ch) / 2));
    cctx.clip();
    drawCoverWithCrop(cctx as CanvasRenderingContext2D, src, crop, 0, 0, card.width, card.height);
    cctx.restore();
    const gl = sceneCards ? renderScene3D(card, xf, sceneCards) : renderCard3D(card, xf);
    if (gl) {
      // Shadow: let the canvas derive it from the GL image's own alpha, so it
      // hugs the card's real silhouette — perspective AND rounded corners.
      // (The old approach filled the projected 4-corner polygon with opaque
      // black behind the card; the card's transparent rounded corners let that
      // sharp polygon show through, which read as "roundness is broken".)
      const shadowAlpha = Math.max(0, shadowPct) / 100;
      ctx.save();
      if (shadowAlpha > 0) {
        const sc = outH / 1080;
        ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`;
        ctx.shadowBlur = (20 + shadowPct) * sc;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = (4 + shadowPct / 2) * sc;
      }
      ctx.drawImage(gl as CanvasImageSource, 0, 0, outW, outH);
      ctx.restore();
      ctx.restore();
      return;
    }
    // WebGL unavailable → fall through to the flat path (rotation ignored).
  }

  if (z !== 1) {
    const cx = x + w / 2;
    const cy = y + h / 2;
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

// Superellipse ("squircle") corner exponent. A plain rounded rect is n=2: the
// corner is a circular arc, and the curvature jumps discontinuously where the
// arc meets the straight edge — which is exactly what makes it read as "a
// rectangle with the corners filed off". n>2 blends the curvature in, so the
// outline flows continuously; that's the shape Apple uses for app icons and
// what the reference demos use for the camera bubble.
//
// n=3.15 and r=0.35*box are MEASURED off a reference bubble: fitting
// |dx/r|^n + |dy/r|^n = 1 to its top-left corner boundary gave n=3.15, r=118px
// on a 340px box (residual 0.014).
const SQUIRCLE_N = 3.15;
export const WEBCAM_CORNER_RATIO = 0.35;

// Superellipse-cornered rectangle. Sampled as a polyline rather than
// bezier-approximated: 24 segments per corner is visually exact at any size we
// draw, and it takes the exponent as a parameter instead of hard-coding control
// points for one particular n.
function squirclePath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number, n = SQUIRCLE_N
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (rr <= 0.5) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    return;
  }
  const SEG = 24;
  const p = 2 / n;
  // Each corner is walked CLOCKWISE from where it leaves one edge to where it
  // meets the next. The sin/cos pair swaps between corners because the sweep
  // direction alternates — getting that wrong makes the outline cross itself.
  const l = x + rr, rgt = x + w - rr, t = y + rr, b = y + h - rr;
  const arc = (
    cx: number, cy: number,
    fx: (c: number, s: number) => number,
    fy: (c: number, s: number) => number,
    first: boolean
  ) => {
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * (Math.PI / 2);
      const c = Math.pow(Math.cos(th), p);
      const sn = Math.pow(Math.sin(th), p);
      const px = cx + rr * fx(c, sn);
      const py = cy + rr * fy(c, sn);
      if (first && i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  };
  ctx.beginPath();
  arc(rgt, t, (_c, sn) => sn, (c) => -c, true);      // top-right:    (0,-r) -> (r,0)
  arc(rgt, b, (c) => c, (_c, sn) => sn, false);      // bottom-right: (r,0)  -> (0,r)
  arc(l, b, (_c, sn) => -sn, (c) => c, false);       // bottom-left:  (0,r)  -> (-r,0)
  arc(l, t, (c) => -c, (_c, sn) => -sn, false);      // top-left:     (-r,0) -> (0,-r)
  ctx.closePath();
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
  const path = () => {
    if (circle) {
      const r = Math.min(w, h) / 2;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      ctx.closePath();
    } else {
      squirclePath(ctx, x, y, w, h, roundness);
    }
  };

  // Soft drop shadow, so the bubble sits ABOVE the composition instead of
  // looking pasted onto it. Painted by filling the shape with the shadow on —
  // the fill is then covered by the video, so only the halo survives.
  // Measured off the reference: the halo reaches ~9% of the box beyond its
  // edge and is offset slightly downward.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = Math.min(w, h) * 0.09;
  ctx.shadowOffsetY = Math.min(w, h) * 0.02;
  path();
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  ctx.save();
  path();
  ctx.clip();
  drawCover(ctx, src, x, y, w, h);
  ctx.restore();

  ctx.save();
  path();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// Cursor spotlight: a full-frame darkening with a transparent soft circle at
// the cursor, so attention is pulled to where the user is pointing. `strength`
// (0..1) scales the max darkness at the edges.
function drawCursorSpotlight(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  cx: number,
  cy: number,
  strength: number
) {
  const radius = Math.min(outW, outH) * 0.16;
  const inner = radius * 0.6;
  const outer = radius * 2.4;
  const alpha = Math.max(0, Math.min(0.85, strength * 0.85));
  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, outW, outH);
  ctx.restore();
}

// Cursor magnifier: a circular lens at the cursor showing the surrounding
// content scaled up. `strength` (0..1) maps to ~1.4×–3× magnification. Reads
// back from the canvas region around the cursor (already composited) and draws
// it enlarged into a clipped circle, with a soft ring.
function drawCursorMagnifier(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  cx: number,
  cy: number,
  strength: number
) {
  const R = Math.min(outW, outH) * 0.12;
  const mag = 1.4 + Math.max(0, Math.min(1, strength)) * 1.6; // 1.4×..3×
  const sr = R / mag; // half-size of the source square to magnify
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  // Draw the surrounding region (from the canvas itself) enlarged into the lens.
  ctx.drawImage(ctx.canvas, cx - sr, cy - sr, sr * 2, sr * 2, cx - R, cy - R, R * 2, R * 2);
  ctx.restore();
  // Lens ring.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, R * 0.05);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.stroke();
  ctx.restore();
}

// How long a click-highlight ripple lives (ms).
const CLICK_RIPPLE_MS = 520;

// Crisp, scalable pointer masks (vectors — sharp at any size). The hotspot
// (the actual pointer position) is the arrows' tip / the dot & ring centre.
// Height is a constant fraction of the frame so the cursor reads the same
// regardless of how far the video is zoomed. `scale` is the user multiplier.
// Path2D per glyph, built once — the shapes never change between frames.
const cursorPathCache = new Map<string, Path2D>();
function cursorPath(style: string): Path2D | null {
  const g = CURSOR_GLYPHS[style];
  if (!g?.d) return null;
  let path = cursorPathCache.get(style);
  if (!path) { path = new Path2D(g.d); cursorPathCache.set(style, path); }
  return path;
}

// Opacity of the pointer at `ms` when "hide when idle" is on: 1 while the
// cursor is moving, fading to 0 once it has been still for CURSOR_IDLE_MS.
// The backward walk is bounded by the fade window, so a long idle stretch
// costs no more than a short one.
function cursorIdleAlpha(samples: CursorSample[] | undefined, ms: number): number {
  if (!samples?.length) return 1;
  let lo = 0, hi = samples.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= ms) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0) return 1;
  const cur = samples[idx];
  const limit = ms - (CURSOR_IDLE_MS + CURSOR_IDLE_FADE_MS);
  let lastMove = limit;
  for (let i = idx; i >= 0 && samples[i].t >= limit; i--) {
    const dx = samples[i].x - cur.x, dy = samples[i].y - cur.y;
    if (dx * dx + dy * dy > CURSOR_MOVE_EPS_SQ) { lastMove = samples[i].t; break; }
  }
  const still = ms - lastMove;
  if (still <= CURSOR_IDLE_MS) return 1;
  return Math.max(0, 1 - (still - CURSOR_IDLE_MS) / CURSOR_IDLE_FADE_MS);
}

// Relative luminance of a #rrggbb colour — picks a contrasting outline so the
// cursor stays visible whether its fill is light or dark.
function hexLuminance(hex: string): number {
  const h = (hex || '#ffffff').replace('#', '');
  if (h.length < 6) return 1;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The captured system-cursor kind in effect at `ms`, as a glyph id. The kinds
// list is a sparse timeline of CHANGES (each entry holds until the next), so
// this is a walk back to the last entry at or before `ms`. Returns the arrow
// when the recording carries no kinds at all — which is every recording made
// before capture existed, plus Wayland sessions.
function glyphForKind(kinds: CursorKindSample[] | undefined, ms: number): string {
  if (!kinds || kinds.length === 0) return 'arrow';
  let lo = 0, hi = kinds.length - 1;
  if (ms < kinds[0].t) return 'arrow';
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kinds[mid].t <= ms) lo = mid; else hi = mid;
  }
  const k = kinds[hi].t <= ms ? kinds[hi].k : kinds[lo].k;
  return KIND_GLYPHS[k] ?? 'arrow';
}

// How far back to look when measuring cursor velocity: one frame at 60fps.
// Short enough to track a flick, long enough not to be dominated by sampling
// noise (the path is already One-Euro smoothed upstream).
const CURSOR_MOTION_DT_MS = 16;
// Below this many output pixels of travel per frame the pointer is "settled" —
// no blur, no lean. Scaled by cursor size so it holds at any resolution.
const CURSOR_MOTION_MIN_PX = 0.35;
const CURSOR_MAX_TILT_RAD = (14 * Math.PI) / 180;

// A click PRESS: the pointer shrinks and springs back.
//
// This is what the reference recordings actually do on click — not a ripple.
// Tracking the cursor as a connected blob through a click shows it scale
// UNIFORMLY (its aspect holds at 1.10 the whole way, so the glyph isn't
// deforming) down to 0.79 and back, identically for the arrow, the hand and
// the I-beam. Earlier I looked for a ripple, found none, and wrongly concluded
// there was no click effect at all; the effect is on the pointer itself.
//
// Every number here is fitted to that measurement (315ms, easeOutQuad down
// over the first 54%, a brief hold, then back up — 0.45% mean error against
// 21 sampled frames). It is deliberately slower and deeper than it feels like
// it should be: a 16%/260ms version read as a twitch beside the reference.
const CLICK_PRESS_MS = 315;
const CLICK_PRESS_DEPTH = 0.211;
const CLICK_PRESS_DOWN = 0.54;  // fraction of the duration spent shrinking
const CLICK_PRESS_HOLD = 0.62;  // …and held at the bottom until here

// Scale multiplier for the pointer at `ms`. 1 when no click is near.
function clickPressScale(clicks: ClickSample[] | undefined, ms: number): number {
  if (!clicks || clicks.length === 0) return 1;
  const easeOutQuad = (t: number) => {
    const x = Math.max(0, Math.min(1, t));
    return 1 - (1 - x) * (1 - x);
  };
  let dip = 0;
  for (const c of clicks) {
    const age = ms - c.t;
    if (age < 0 || age > CLICK_PRESS_MS) continue;
    const u = age / CLICK_PRESS_MS;
    const d = u < CLICK_PRESS_DOWN ? easeOutQuad(u / CLICK_PRESS_DOWN)
      : u < CLICK_PRESS_HOLD ? 1
      : easeOutQuad(1 - (u - CLICK_PRESS_HOLD) / (1 - CLICK_PRESS_HOLD));
    // Overlapping clicks take the deepest press rather than compounding.
    dip = Math.max(dip, d);
  }
  return 1 - CLICK_PRESS_DEPTH * dip;
}

// Draw the pointer with velocity-derived motion: a directional smear while it
// travels, and a slight lean into the direction of travel.
//
// The smear is an ACCUMULATION blur — the same sprite stamped N times along the
// path it covered this frame, each at 1/N alpha — which is what a real camera
// shutter does and what reference demos show (a fast flick renders as a smeared
// arrow, sharp again the moment it settles). It is not a canvas filter blur:
// that would soften the sprite in every direction and just look out of focus.
function drawCursorWithMotion(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  px: number | null, py: number | null,
  scale: number, outH: number,
  style: string, color: string, emoji: string,
  motionBlur: number, tilt: number
) {
  const targetH = outH * 0.05 * Math.max(0.3, scale);
  const dx = px === null || py === null ? 0 : x - px;
  const dy = px === null || py === null ? 0 : y - py;
  const dist = Math.hypot(dx, dy);
  const moving = dist > CURSOR_MOTION_MIN_PX * (targetH / 18);

  // Lean into the horizontal component of travel. Vertical moves stay upright,
  // which is what reads naturally — a pointer leans the way it's thrown.
  let angle = 0;
  if (moving && tilt > 0) {
    const norm = Math.max(-1, Math.min(1, dx / Math.max(1, targetH)));
    angle = norm * CURSOR_MAX_TILT_RAD * Math.max(0, Math.min(1, tilt));
  }

  const draw = (cx: number, cy: number, alpha: number, pass: CursorPass = 'both') => {
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (angle !== 0) {
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-cx, -cy);
    }
    drawSyntheticCursor(ctx, cx, cy, scale, outH, style, color, emoji, pass);
    ctx.restore();
  };

  const strength = Math.max(0, Math.min(1, motionBlur));
  if (!moving || strength <= 0) {
    draw(x, y, 1, 'both');
    return;
  }

  // The trail is a SMEAR of the finished pointer, not a stack of pointers.
  //
  // Stamping the glyph repeatedly along the path — the previous approach —
  // has two failure modes once the halo is wide: stamps layered in any order
  // put someone's halo over someone's fill, and even with that solved, stamps
  // ~1.5px apart each leave a hard-edged black outline, which shows on the
  // trailing side as a staircase. Real motion blur is the average of many
  // copies at sub-pixel spacing, so: render the pointer ONCE into a sprite
  // (halo and body composited correctly), then draw that sprite densely along
  // the travel at low alpha. Copies under 1px apart blend into a gradient. The
  // head goes on top, complete and opaque — it is the object in front.
  const sprite = cursorSprite(targetH);
  const sctx = sprite.getContext('2d');
  if (!sctx) { draw(x, y, 1, 'both'); return; }
  const half = sprite.width / 2;
  sctx.clearRect(0, 0, sprite.width, sprite.height);
  drawSyntheticCursor(sctx, half, half, scale, outH, style, color, emoji, 'both');

  const spacing = 0.75;
  const len = dist * strength;
  const n = Math.max(2, Math.min(40, Math.ceil(len / spacing)));
  // Enough alpha per copy that the overlap near the head reads solid and the
  // tail end fades out; scales with n so density doesn't change brightness.
  const base = Math.min(0.9, 2.2 / n);
  ctx.save();
  if (angle !== 0) {
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.translate(-x, -y);
  }
  for (let i = n; i >= 1; i--) {
    const u = (i / n) * strength;
    ctx.globalAlpha = base * (1 - i / n);
    ctx.drawImage(sprite, x - dx * u - half, y - dy * u - half);
  }
  ctx.restore();
  draw(x, y, 1, 'both');
}

// Offscreen canvas the motion smear renders the pointer into. Reused across
// frames; sized generously around the hotspot so every glyph (the hand
// extends left of it, the caret is centred on it) fits with its halo.
let cursorSpriteCanvas: HTMLCanvasElement | null = null;
function cursorSprite(targetH: number): HTMLCanvasElement {
  const side = Math.ceil(targetH * 3.2);
  if (!cursorSpriteCanvas) cursorSpriteCanvas = document.createElement('canvas');
  if (cursorSpriteCanvas.width !== side) {
    cursorSpriteCanvas.width = side;
    cursorSpriteCanvas.height = side;
  }
  return cursorSpriteCanvas;
}

// Which layers of the pointer to paint. 'halo' is the outline (with its
// shadow) and 'body' the fill; the motion trail paints all halos before any
// body so a halo never lands on a neighbouring stamp's fill.
type CursorPass = 'both' | 'halo' | 'body';

function drawSyntheticCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  outH: number,
  style = 'system',
  color = '#ffffff',
  emoji = '',
  pass: CursorPass = 'both'
) {
  const unitH = 18;
  const targetH = outH * 0.05 * Math.max(0.3, scale);
  const f = targetH / unitH;
  const fill = color || '#ffffff';
  const outline = hexLuminance(fill) > 0.6 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)';
  ctx.save();

  // Dot / ring / emoji are single-layer glyphs: they paint once, on the body
  // pass, and contribute nothing to a halo pass.
  if (pass === 'halo' && (style === 'dot' || style === 'ring' || style === 'emoji' || CURSOR_GLYPHS[style]?.char)) {
    ctx.restore();
    return;
  }

  // Dot / ring pointers are centred on the hotspot.
  if (style === 'dot' || style === 'ring') {
    const r = targetH * 0.42;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = targetH * 0.18;
    ctx.shadowOffsetY = targetH * 0.04;
    if (style === 'dot') {
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = Math.max(1, targetH * 0.05);
      ctx.strokeStyle = outline;
      ctx.stroke();
    } else {
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = Math.max(1.5, targetH * 0.13);
      ctx.strokeStyle = fill;
      ctx.stroke();
      // A small centre dot marks the exact hotspot inside the ring.
      ctx.beginPath();
      ctx.arc(x, y, targetH * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // Emoji pointer: a text glyph, drawn in its own colours (the fill/outline
  // treatment below would flatten it).
  // The user's chosen emoji wins; the glyph table's char is the fallback for
  // older projects (and any future glyph-based style).
  const glyph = CURSOR_GLYPHS[style];
  const char = (style === 'emoji' && emoji.trim()) || glyph?.char;
  if (char) {
    ctx.font = `${targetH * 1.3}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = targetH * 0.18;
    ctx.shadowOffsetY = targetH * 0.04;
    ctx.fillText(char, x, y - targetH * 0.08);
    ctx.restore();
    return;
  }

  // Scale the glyph into output space via the path itself, so the shadow and
  // outline widths below stay in output px (a ctx.scale would blow them up).
  const base = cursorPath(style) ?? cursorPath('system');
  if (!base) { ctx.restore(); return; }
  const path = new Path2D();
  path.addPath(base, new DOMMatrix([f, 0, 0, f, x, y]));
  // Three passes, all with round joins, which together give the soft, chunky
  // look of a real system pointer:
  //
  //   1. the OUTLINE, stroked under everything at a wide width — the visible
  //      halo is the part that sticks out past the fill;
  //   2. the fill;
  //   3. the fill's OWN colour stroked over its edge at a narrow width.
  //
  // Pass 3 is the one that was missing. The outline under the fill rounds the
  // outer silhouette, but the fill drawn on top still came to hard points at
  // every corner — so the arrow read as sharp and thin however wide the border
  // was. Stroking the fill colour with a round join rounds the fill itself, the
  // way the real pointer's corners are rounded.
  //
  // Sized as fractions of the glyph height so it holds at any resolution:
  // the halo showing past the fill is ~10% of the height (measured off a
  // reference pointer at display size), and the fill's corner radius ~3.5%.
  // `weight` scales the halo per glyph; 1 is the pointer.
  const weight = CURSOR_GLYPHS[style]?.weight ?? 1;
  const roundW = Math.max(1, targetH * 0.07);                     // fill stroke → corner radius 0.035H
  const haloW = Math.max(1.5, targetH * 0.20 * weight);           // extra beyond the fill stroke → 0.10H visible
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = targetH * 0.16;
  ctx.shadowOffsetY = targetH * 0.045;
  const strokeUnits = CURSOR_GLYPHS[style]?.stroke;
  if (strokeUnits) {
    // Centreline glyph (the caret): the line itself is the body, so stroke it
    // in the fill colour, with the halo as a wider stroke underneath. Same
    // visible halo as the filled glyphs — haloW/2 either side.
    const bodyW = strokeUnits * f;
    if (pass !== 'body') {
      ctx.lineWidth = bodyW + haloW;
      ctx.strokeStyle = outline;
      ctx.stroke(path);
    }
    ctx.shadowColor = 'transparent';
    if (pass !== 'halo') {
      ctx.lineWidth = bodyW;
      ctx.strokeStyle = fill;
      ctx.stroke(path);
    }
    ctx.restore();
    return;
  }
  if (pass !== 'body') {
    ctx.lineWidth = roundW + haloW;
    ctx.strokeStyle = outline;
    ctx.stroke(path);
  }
  ctx.shadowColor = 'transparent';
  if (pass === 'halo') { ctx.restore(); return; }
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.lineWidth = roundW;
  ctx.strokeStyle = fill;
  ctx.stroke(path);
  // Interior line work (the hand's finger separations) goes ON TOP of the
  // fill, in the outline colour — as part of `d` it would be painted over.
  const detail = CURSOR_GLYPHS[style]?.detail;
  if (detail) {
    const dp = new Path2D();
    dp.addPath(new Path2D(detail), new DOMMatrix([f, 0, 0, f, x, y]));
    ctx.lineWidth = Math.max(1, targetH * 0.045);
    ctx.strokeStyle = outline;
    ctx.stroke(dp);
  }
  ctx.restore();
}

// An expanding, fading ring (+ a quick soft disc) at a click position. `p` is
// the ripple's progress 0..1 over CLICK_RIPPLE_MS.
function drawClickRipple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: number,
  outH: number
) {
  const ease = 1 - Math.pow(1 - p, 3);
  const maxR = outH * 0.06;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, maxR * ease, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, outH * 0.006 * (1 - p));
  ctx.strokeStyle = `rgba(110,231,183,${0.75 * (1 - p)})`;
  ctx.stroke();
  if (p < 0.5) {
    ctx.beginPath();
    ctx.arc(x, y, maxR * 0.45 * ease, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(110,231,183,${0.25 * (1 - p * 2)})`;
    ctx.fill();
  }
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
  squirclePath(ctx, x, y, w, h, roundness);
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

// CSS "to <side>" direction keywords → the angle CSS defines for them.
const GRADIENT_DIRECTIONS: Record<string, number> = {
  'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
  'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135,
  'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315
};

// Turn a CSS linear-gradient() string into a CanvasGradient. Handles what CSS
// actually produces — an angle in deg, a "to <side>" keyword, or no direction
// (= 180deg) — and color stops with or without a "<pct>%" position. Stops
// without a position are spread evenly between their positioned neighbours
// (the CSS rule), so `#a,#b 21%,#c` and plain `#a,#b,#c` both render right.
// Canvas' addColorStop() rejects anything but a bare color, so the position
// must be split off before it gets there — feeding it "#ff8c7f 21%" throws
// and took the whole export down.
function parseLinearGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  w: number,
  h: number
): CanvasGradient | null {
  const m = css.match(/^linear-gradient\(\s*(.+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/,(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // Optional leading direction: "NNdeg" or "to <side>".
  let deg = 180;
  const first = parts[0].toLowerCase();
  const degMatch = first.match(/^(-?\d+(?:\.\d+)?)deg$/);
  if (degMatch) {
    deg = Number(degMatch[1]);
    parts.shift();
  } else if (first in GRADIENT_DIRECTIONS) {
    deg = GRADIENT_DIRECTIONS[first];
    parts.shift();
  }
  if (parts.length < 2) return null;

  // Split "<color> [<pct>%]" into color + optional 0..1 offset.
  const stops = parts.map((p) => {
    const sm = p.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)%$/);
    return sm
      ? { color: sm[1].trim(), pos: Math.max(0, Math.min(1, Number(sm[2]) / 100)) as number | null }
      : { color: p, pos: null as number | null };
  });
  // CSS: first/last default to 0/1; unpositioned runs interpolate between the
  // nearest positioned neighbours; positions never decrease.
  if (stops[0].pos == null) stops[0].pos = 0;
  if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = 1;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].pos == null) {
      let j = i + 1;
      while (stops[j].pos == null) j++;
      const a = stops[i - 1].pos as number, b = stops[j].pos as number, n = j - i + 1;
      for (let k = i; k < j; k++) stops[k].pos = a + ((b - a) * (k - i + 1)) / n;
      i = j;
    }
    if ((stops[i].pos as number) < (stops[i - 1].pos as number)) stops[i].pos = stops[i - 1].pos;
  }

  const rad = ((deg - 90) * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const len = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const x1 = cx - Math.cos(rad) * len;
  const y1 = cy - Math.sin(rad) * len;
  const x2 = cx + Math.cos(rad) * len;
  const y2 = cy + Math.sin(rad) * len;
  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  for (const s of stops) {
    try { grad.addColorStop(s.pos as number, s.color); } catch { /* skip an unparsable color, never crash */ }
  }
  return grad;
}
