import { create } from 'zustand';
import type { RecordingMeta, CursorSample, ClickSample } from '@shared/ipc';
import { suggestZoomsFromActivity } from './autoZoom';
import type { CursorStyleId } from './cursorGlyphs';
import type { ZoomStyle } from './export';
import wallpaper01Url from '../../assets/wallpapers/wallpaper-01.jpg';

export type AspectRatio = '16:9' | '4:3' | '1:1' | '9:16' | 'auto';
export type LaneKind = 'zoom' | 'trim' | 'annotation' | 'speed' | 'magnify' | 'spotlight' | 'blur' | 'rotation' | 'scene';
// Redaction style for a blur region.
export type BlurStyle = 'blur' | 'pixelate';
// Synthetic-cursor pointer styles — arrows, a pointing hand, a text I-beam,
// ring/dot and the playful ones. Shapes live in cursorGlyphs.ts so the
// compositor and the sidebar picker draw from one source.
export type CursorStyle = CursorStyleId;

export type AnnotationStyle = {
  // Visual styling for an annotation. All fields optional so older projects
  // load with sensible defaults.
  fontFamily?: string;
  fontSize?: number;          // pixels in source space (scales with output)
  bold?: boolean;
  italic?: boolean;
  textColor?: string;         // any CSS color
  backgroundColor?: string | null; // null/undefined → transparent (no chip)
  textAlign?: 'left' | 'center' | 'right';
  // Position on the canvas as fractions 0..1 (centre of the text). Matches
  // how the webcam overlay is positioned, so the existing drag handling
  // pattern carries over.
  posX?: number;
  posY?: number;
};

export type LaneItem = {
  id: string;
  kind: LaneKind;
  startMs: number;
  endMs: number;
  // Per-kind data
  zoomLevel?: number;
  zoomTargetX?: number;
  zoomTargetY?: number;
  // 3D rotation of the framed video "card" — its own lane ('rotation'), so it
  // can be applied at any time, with or without a zoom (a tilt on an intro at
  // 1x, a spin across a cut, a held lean over a whole section). Degrees; all
  // default 0 = flat. tiltX nods the card about its horizontal axis, tiltY
  // turns it about the vertical axis, spinZ rotates it in-plane. The *End
  // values are the rotation at the region's end keyframe; when absent the
  // rotation holds the start values throughout. It interpolates start→end
  // across the region and eases in/out at the region's edges, so the card
  // tilts in and flattens back out smoothly. Composes with any active zoom.
  tiltX?: number;
  tiltY?: number;
  spinZ?: number;
  tiltXEnd?: number;
  tiltYEnd?: number;
  spinZEnd?: number;
  // Multi-card 3D scene preset id (see scenes.ts) — when set on a rotation
  // item, it replaces the manual tilt for that region: the video renders as
  // many cards (ring / grid / stream…) animated across the region.
  scene?: string;
  // Per-scene motion settings (see SceneSettings in scenes.ts). All optional;
  // absent = the defaults there.
  sceneSpeed?: number;    // cycles across the region (1 = one pass)
  sceneZoom?: number;     // camera dolly on the whole arrangement (1 = as designed)
  sceneTiltX?: number;    // group tilt of the arrangement, degrees
  sceneTiltY?: number;
  sceneDepth?: number;    // multiplies depth offsets
  sceneSpacing?: number;  // multiplies in-plane spread
  sceneRadius?: number;   // multiplies all offsets (ring radius)
  sceneShape?: '1:1' | '4:3' | '3:2' | '16:9' | '9:16'; // card crop
  scenePosX?: number;     // where the arrangement's centre sits in the frame (0..1)
  scenePosY?: number;
  text?: string;
  speed?: number;
  // Spotlight / magnify: how the lens is positioned over its time range.
  // 'cursor' (default) follows the recorded cursor; 'manual' stays put at
  // posX/posY (fractions of the output frame), which the user drags on the
  // preview. Whole-video application is just a region spanning 0..durationMs.
  track?: 'cursor' | 'manual';
  // Blur (redaction) region: rectangle in output-frame fractions (0..1) blurred
  // or pixelated over its time range to hide sensitive info (emails, passwords).
  rectX?: number;
  rectY?: number;
  rectW?: number;
  rectH?: number;
  blurStyle?: BlurStyle;
  blurStrength?: number; // 0..1
} & AnnotationStyle;

// Defaults applied when an annotation has no explicit value for a field.
// Kept here (not inlined) so preview, export, and the sidebar selection panel
// all read from the same source of truth.
export const ANNOTATION_DEFAULTS: Required<AnnotationStyle> = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 32,
  bold: true,
  italic: false,
  textColor: '#ffffff',
  backgroundColor: 'rgba(0,0,0,0.7)',
  textAlign: 'center',
  posX: 0.5,
  posY: 0.85
};

export type BackgroundMode = 'image' | 'color' | 'gradient';

export type PolishPreset = 'subtle' | 'soft' | 'dramatic';

// Webcam container shape. Rectangle uses a 16:9 box (matches typical webcam
// intrinsic aspect); Square and Rectangle both render with rounded corners,
// Circle is the full pill. The legacy 'rounded' value (square box, mid
// radius) is migrated to 'square' on hydrate.
export type WebcamShape = 'circle' | 'square' | 'rectangle';

// Gap kept between the webcam PiP and the frame edge, as a fraction of the
// frame. Used both when snapping to a corner and when clamping a drag, so the
// box never ends up flush against the wall.
export const WEBCAM_EDGE_MARGIN = 0.04;

// Crop region in normalized 0..1 coordinates relative to the source frame.
// Identity = full frame. Persisted with the project so saved files round-trip.
export type CropRegion = { x: number; y: number; width: number; height: number };
export const DEFAULT_CROP_REGION: CropRegion = { x: 0, y: 0, width: 1, height: 1 };

export type EditorState = {
  recording: RecordingMeta | null;
  fileUrl: string | null;
  webcamFileUrl: string | null;
  durationMs: number;
  currentMs: number;
  playing: boolean;
  videoIntrinsicSize: { width: number; height: number } | null;
  // Live ref to the main <video> DOM element. Set by Preview on mount, used
  // by overlays like CropModal that need to render the same frames the editor
  // is showing (the element is already primed and at the right currentTime).
  mainVideoEl: HTMLVideoElement | null;

  aspect: AspectRatio;

  // Composition
  cropRegion: CropRegion;
  background: { mode: BackgroundMode; value: string };
  // x,y in 0..1 (normalized). `zoomFollow` (0..1) is how strongly the bubble
  // shrinks as the camera zooms in: 0 keeps it a fixed size, 1 applies the full
  // inverse-zoom curve. The point is that when you magnify detail, the face
  // should give up screen real estate rather than cover what you zoomed into.
  webcam: { x: number; y: number; size: number; enabled: boolean; shape: WebcamShape; zoomFollow: number };
  layoutPreset: 'pip-bottom-right' | 'pip-bottom-left' | 'pip-top-right' | 'pip-top-left' | 'side-by-side';

  // Style
  polish: PolishPreset;
  showAdvanced: boolean;
  effects: { roundnessPx: number; paddingPct: number; shadowPct: number; motionBlur: number; blurBg: boolean; cursorSpotlight: number; cursorMagnifier: number };

  // How zoom transitions move. Kept OUT of `effects` on purpose: setPolish
  // swaps that whole object, and the zoom's feel shouldn't reset when someone
  // changes the look preset.
  //   snappy    — 450ms, symmetric ease-in-out (the original)
  //   cinematic — 900ms, ease-out: leaves fast, settles slow
  zoomStyle: ZoomStyle;

  // On-disk path of the auto-saved project file (set when a recording is
  // first loaded, kept stable for the rest of the session). Used by the editor
  // to debounce-write changes to the same file silently.
  currentProjectPath: string | null;
  // Wall-clock ms of the most recent successful auto-save write — drives the
  // "saved 5s ago" indicator in the toolbar so the user has feedback that
  // their changes have been persisted.
  lastSavedAt: number | null;

  // Audio — applies to preview playback AND to export. When muted, the export
  // pipeline drops the audio track entirely, so the saved file has no sound.
  videoVolume: number; // 0..1
  videoMuted: boolean;

  // Export
  exportFormat: 'mp4' | 'webm' | 'gif';
  exportQuality: 'low' | 'medium' | 'high';

  // Timeline
  items: LaneItem[];
  selectedItemId: string | null;
  // When set, the annotation with this id is in on-canvas text-edit mode (the
  // preview shows a focused editor). Transient; never serialized. Used to
  // suppress global/lane keyboard shortcuts while the user is typing a label.
  editingAnnotationId: string | null;
  pixelsPerSecond: number;

  // Cursor samples captured during recording (for auto-zoom + the synthetic
  // cursor). Not serialized; reloaded from the recording's sidecar on open.
  // cursorSamplesSmooth is a jitter-smoothed copy used to render the synthetic
  // cursor as a buttery glide; cursorClicks drives click-highlight ripples.
  cursorSamples: CursorSample[];
  cursorSamplesSmooth: CursorSample[];
  cursorClicks: ClickSample[];
  // Synthetic-cursor styling (serialized). When enabled, the compositor draws a
  // smoothed, scalable cursor + optional click ripples on top of the video.
  // smoothing 0..1: 0 = the raw cursor position (pixel-exact, no smoothing),
  // 1 = the full One Euro glide. Lets the user trade accuracy for buttery-ness.
  // style picks the pointer mask; color is its fill (outline auto-contrasts).
  // `emoji` is the glyph drawn when style === 'emoji' — any emoji the user
  // picks or types, not a fixed one. Ignored by every other style.
  cursorFx: {
    enabled: boolean; size: number; clicks: boolean; smoothing: number;
    style: CursorStyle; color: string; hideWhenIdle: boolean; emoji: string;
    // Velocity-driven motion. Both are 0..1 strengths, both cost nothing when 0.
    //  motionBlur — smears the pointer along its travel while it's moving fast,
    //               which is what stops a quick flick reading as a teleport.
    //  tilt       — leans the pointer a few degrees into its direction of
    //               travel. Tiny, but it's the difference between a sprite
    //               being moved and something with momentum.
    motionBlur: number; tilt: number;
  };

  // Undo/redo history (session-only; never serialized). past/future hold
  // document snapshots; _applyingHistory suppresses capture while a snapshot is
  // being restored. The capture subscription baselines off currentProjectPath,
  // so a fresh load re-baselines instead of being recorded as an undo step.
  past: SerializedProject[];
  future: SerializedProject[];
  _applyingHistory: boolean;

  // Actions
  setRecording: (r: RecordingMeta, fileUrl: string, webcamFileUrl?: string | null) => void;
  setCurrentProjectPath: (p: string | null) => void;
  setLastSavedAt: (t: number | null) => void;
  setVideoIntrinsicSize: (size: { width: number; height: number } | null) => void;
  setMainVideoEl: (el: HTMLVideoElement | null) => void;
  setCurrent: (ms: number) => void;
  setPlaying: (p: boolean) => void;
  setAspect: (a: AspectRatio) => void;
  setBackground: (b: { mode: BackgroundMode; value: string }) => void;
  setCropRegion: (r: CropRegion) => void;
  setWebcam: (w: Partial<EditorState['webcam']>) => void;
  setLayoutPreset: (p: EditorState['layoutPreset']) => void;
  setPolish: (p: PolishPreset) => void;
  setShowAdvanced: (v: boolean) => void;
  setEffect: <K extends keyof EditorState['effects']>(key: K, value: EditorState['effects'][K]) => void;
  setZoomStyle: (z: ZoomStyle) => void;
  setExportFormat: (f: 'mp4' | 'webm' | 'gif') => void;
  setExportQuality: (q: 'low' | 'medium' | 'high') => void;
  setVideoVolume: (v: number) => void;
  setVideoMuted: (m: boolean) => void;
  addItem: (kind: LaneKind, atMs: number) => void;
  // Add a spotlight/magnify region spanning the whole video, cursor-tracked.
  addWholeVideoEffect: (kind: 'spotlight' | 'magnify') => void;
  // Stretch an existing spotlight/magnify region to the whole video, dropping
  // any other regions of the same kind so only one full-span effect remains.
  applyEffectWholeVideo: (id: string) => void;
  updateItem: (id: string, patch: Partial<LaneItem>) => void;
  removeItem: (id: string) => void;
  selectItem: (id: string | null) => void;
  setEditingAnnotation: (id: string | null) => void;
  setPixelsPerSecond: (pps: number) => void;
  setCursorSamples: (s: CursorSample[]) => void;
  setCursorClicks: (c: ClickSample[]) => void;
  setCursorFx: (patch: Partial<EditorState['cursorFx']>) => void;
  // Replace existing zoom items with auto-suggested ones derived from the
  // captured cursor movement. Returns how many were added.
  suggestZooms: () => number;
  serialize: () => SerializedProject;
  hydrate: (data: SerializedProject) => void;
  // Undo/redo
  undo: () => void;
  redo: () => void;
  historyCommit: (snapshot: SerializedProject) => void;
  applyDoc: (snap: SerializedProject) => void;
};

export type SerializedProject = {
  aspect: AspectRatio;
  cropRegion?: CropRegion;
  background: EditorState['background'];
  webcam: EditorState['webcam'];
  layoutPreset: EditorState['layoutPreset'];
  polish: PolishPreset;
  showAdvanced: boolean;
  effects: EditorState['effects'];
  // Optional: projects saved before zoom styles existed load with the default.
  zoomStyle?: ZoomStyle;
  exportFormat: EditorState['exportFormat'];
  exportQuality: EditorState['exportQuality'];
  items: LaneItem[];
  cursorFx?: EditorState['cursorFx'];
};

const DEFAULT_CURSOR_FX: EditorState['cursorFx'] = {
  enabled: false, size: 1.4, clicks: true, smoothing: 0.5, style: 'system',
  color: '#ffffff', hideWhenIdle: false, emoji: '👆', motionBlur: 0.6, tilt: 0.5
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

// Jitter-smooth the captured cursor path with a ZERO-PHASE, ADAPTIVE filter:
// the One Euro filter (Casiez et al.) run FORWARD then BACKWARD. Two properties
// matter for a recorded (non-real-time) path:
//  • Adaptive — at high speed the cutoff rises so fast moves are barely
//    smoothed (the cursor stays on the real path), while slow movement is
//    de-jittered. A fixed filter can't do both; it either lags fast moves or
//    leaves jitter.
//  • Zero-phase — the forward pass's lag is cancelled by the backward pass, so
//    the smoothed cursor doesn't trail the real one (a single causal pass, like
//    we used before, always does). The editor has the whole path, so we can.
// Paired with the centripetal Catmull-Rom interpolation in the compositor for
// smooth motion between the sparse samples — the approach pro recorders use.
const EURO_MIN_CUTOFF = 1.0; // Hz — jitter smoothing when slow/at rest
const EURO_BETA = 1.2;       // speed coupling — higher keeps fast moves sharper
const EURO_D_CUTOFF = 1.0;
function euroAlpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}
function smoothCursor(samples: CursorSample[]): CursorSample[] {
  const n = samples.length;
  if (n < 3) return samples.slice();
  const ts = samples.map((s) => s.t);
  // One One-Euro pass over the given index order; writes results back in the
  // original index positions so a forward and a backward pass compose cleanly.
  const pass = (xin: number[], yin: number[], order: number[]): [number[], number[]] => {
    const xo = new Array<number>(n);
    const yo = new Array<number>(n);
    let xh = 0, yh = 0, dxh = 0, dyh = 0, xPrev = 0, yPrev = 0, tPrev = 0, first = true;
    for (const i of order) {
      if (first) {
        xh = xin[i]; yh = yin[i]; xPrev = xin[i]; yPrev = yin[i]; tPrev = ts[i];
        xo[i] = xh; yo[i] = yh; first = false; continue;
      }
      const dt = Math.max(1, Math.abs(ts[i] - tPrev)) / 1000;
      const aD = euroAlpha(EURO_D_CUTOFF, dt);
      dxh += aD * ((xin[i] - xPrev) / dt - dxh);
      dyh += aD * ((yin[i] - yPrev) / dt - dyh);
      const aX = euroAlpha(EURO_MIN_CUTOFF + EURO_BETA * Math.abs(dxh), dt);
      const aY = euroAlpha(EURO_MIN_CUTOFF + EURO_BETA * Math.abs(dyh), dt);
      xh += aX * (xin[i] - xh);
      yh += aY * (yin[i] - yh);
      xo[i] = xh; yo[i] = yh; xPrev = xin[i]; yPrev = yin[i]; tPrev = ts[i];
    }
    return [xo, yo];
  };
  const order = [...Array(n).keys()];
  const [xf, yf] = pass(samples.map((s) => s.x), samples.map((s) => s.y), order);
  const [xb, yb] = pass(xf, yf, order.slice().reverse());
  return samples.map((s, i) => ({ t: s.t, x: xb[i], y: yb[i] }));
}

// Extract the serializable document (everything undo/redo and save care about)
// from a store state. serialize(), the history-capture subscription, and
// undo/redo all go through this so they agree on exactly which fields make up
// "the project" — transient state (playhead, playing, selection) is excluded.
function docOf(s: EditorState): SerializedProject {
  return {
    aspect: s.aspect,
    cropRegion: s.cropRegion,
    background: s.background,
    webcam: s.webcam,
    layoutPreset: s.layoutPreset,
    polish: s.polish,
    showAdvanced: s.showAdvanced,
    effects: s.effects,
    zoomStyle: s.zoomStyle,
    exportFormat: s.exportFormat,
    exportQuality: s.exportQuality,
    items: s.items,
    cursorFx: s.cursorFx
  };
}

// Where to park the playhead to preview a timeline item: a little past its
// start so time-based effects are already visible (zoom is fully eased in after
// ~450ms), clamped to the item. Trims jump to just their start (the frame right
// before the cut) since their interior is removed.
function previewPointFor(item: { kind: LaneKind; startMs: number; endMs: number }): number {
  if (item.kind === 'trim') return item.startMs;
  return Math.min(item.endMs, item.startMs + 500);
}

// Numeric width/height ratio for an AspectRatio enum value. 'auto' maps to
// the fallback so callers that need a concrete number for layout math (e.g.
// webcam corner snapping) don't have to special-case it.
function aspectToRatio(a: AspectRatio, fallback: number): number {
  if (a === '16:9') return 16 / 9;
  if (a === '9:16') return 9 / 16;
  if (a === '4:3') return 4 / 3;
  if (a === '1:1') return 1;
  return fallback;
}

const presetEffects: Record<PolishPreset, EditorState['effects']> = {
  subtle: { roundnessPx: 6, paddingPct: 25, shadowPct: 6, motionBlur: 0, blurBg: false, cursorSpotlight: 0, cursorMagnifier: 0 },
  soft: { roundnessPx: 14, paddingPct: 50, shadowPct: 16, motionBlur: 0, blurBg: false, cursorSpotlight: 0, cursorMagnifier: 0 },
  dramatic: { roundnessPx: 22, paddingPct: 70, shadowPct: 32, motionBlur: 0.5, blurBg: true, cursorSpotlight: 0, cursorMagnifier: 0 }
};

export const useEditor = create<EditorState>((set, get) => ({
  recording: null,
  fileUrl: null,
  webcamFileUrl: null,
  durationMs: 0,
  currentMs: 0,
  playing: false,
  videoIntrinsicSize: null,
  mainVideoEl: null,

  aspect: '16:9',

  cropRegion: DEFAULT_CROP_REGION,
  // Default look: the first bundled wallpaper (not a gradient) and a
  // rectangular webcam — the combination that reads best out of the box.
  background: { mode: 'image', value: wallpaper01Url },
  // x,y are top-left position normalized to the stage (0..1).
  // size is the webcam's diameter as a fraction of stage HEIGHT — guarantees
  // it stays square AND fits inside any landscape aspect.
  // Default 0.25 = 25% of stage height. Corner position math:
  // x = 1 - size*9/16 - 0.04, y = 1 - size - 0.04.
  // Square by default, and big. Measured off the reference demos: a 340x340
  // bubble on a 1280x720 frame is 0.47 of the frame HEIGHT, bottom-left with a
  // ~3% left / ~5% bottom margin. A 16:9 bubble at 0.2 reads as a video-call
  // inset; this reads as a presenter.
  // x/y are the box's TOP-LEFT, so a bottom-left park is y = 1 - size - margin.
  // Uses the app's own WEBCAM_EDGE_MARGIN so the default and the corner-snap
  // agree; the reference's margin is 36px (0.028 of width, 0.05 of height),
  // which 0.04 sits between.
  webcam: { x: WEBCAM_EDGE_MARGIN, y: 1 - 0.47 - WEBCAM_EDGE_MARGIN, size: 0.47, enabled: false, shape: 'square', zoomFollow: 1 },
  layoutPreset: 'pip-bottom-right',

  polish: 'soft',
  showAdvanced: false,
  effects: presetEffects.soft,
  // Cinematic by default: the slow-settling ease-out is what makes a zoom read
  // as a camera move rather than a cut. Existing projects load their own saved
  // value, so nothing already made changes feel.
  zoomStyle: 'cinematic',

  exportFormat: 'mp4',
  exportQuality: 'medium',

  videoVolume: 1,
  videoMuted: false,

  currentProjectPath: null,
  lastSavedAt: null,

  items: [],
  selectedItemId: null,
  editingAnnotationId: null,
  pixelsPerSecond: 60,
  cursorSamples: [],
  cursorSamplesSmooth: [],
  cursorClicks: [],
  cursorFx: { ...DEFAULT_CURSOR_FX },

  past: [],
  future: [],
  _applyingHistory: false,

  setCurrentProjectPath: (p) => set({ currentProjectPath: p }),
  setLastSavedAt: (t) => set({ lastSavedAt: t }),

  setRecording: (r, fileUrl, webcamFileUrl) =>
    set((s) => ({
      recording: r,
      fileUrl,
      webcamFileUrl: webcamFileUrl ?? null,
      durationMs: r.durationMs,
      // Fresh recording → fresh undo history.
      past: [],
      future: [],
      // Auto-enable webcam in editor if a webcam file came with the recording
      // and the user hasn't explicitly turned it on/off in this session.
      webcam: webcamFileUrl ? { ...s.webcam, enabled: true } : s.webcam,
      // If the recording was captured with a region selection, pre-fill the
      // editor's crop to match. The region is already stored as normalized
      // 0..1 fractions, which is exactly the cropRegion shape.
      cropRegion: r.region
        ? {
            x: clamp01(r.region.x),
            y: clamp01(r.region.y),
            width: Math.max(0.05, Math.min(1 - clamp01(r.region.x), r.region.width)),
            height: Math.max(0.05, Math.min(1 - clamp01(r.region.y), r.region.height))
          }
        : DEFAULT_CROP_REGION
    })),
  setVideoIntrinsicSize: (size) => set({ videoIntrinsicSize: size }),
  setMainVideoEl: (el) => set({ mainVideoEl: el }),
  setCurrent: (ms) => set((s) => {
    // Snap the playhead out of any trim region — when scrubbing or clicking
    // into a cut, jump to whichever edge of the cut is closest (midpoint
    // split). Keeps the preview from flashing trimmed content during a drag
    // and matches the way playback already skips trims at runtime. Snap is a
    // no-op when ms lands outside every trim region, so call sites that
    // already handled trim (e.g. Preview's onTime which sets ms to endMs+1)
    // pass through unchanged.
    const trim = s.items.find(
      (it) => it.kind === 'trim' && ms > it.startMs && ms < it.endMs
    );
    if (trim) {
      const midpoint = (trim.startMs + trim.endMs) / 2;
      return { currentMs: ms < midpoint ? trim.startMs : trim.endMs };
    }
    return { currentMs: ms };
  }),
  setPlaying: (p) => set({ playing: p }),
  setAspect: (a) => set({ aspect: a }),
  setBackground: (b) => set({ background: b }),
  setCropRegion: (r) => set({
    cropRegion: {
      x: clamp01(r.x),
      y: clamp01(r.y),
      // Min crop size of 5% — prevents the user from accidentally collapsing
      // the crop to zero via numeric inputs and matches openscreen's floor.
      width: Math.max(0.05, Math.min(1 - clamp01(r.x), r.width)),
      height: Math.max(0.05, Math.min(1 - clamp01(r.y), r.height))
    }
  }),
  setWebcam: (w) => set((s) => {
    const next = { ...s.webcam, ...w };
    // When the shape changes the box's aspect (and therefore its width)
    // changes too, so the saved x/y no longer corresponds to a corner. Snap
    // back to the same logical corner (right/left, bottom/top) using the new
    // shape's aspect so e.g. switching square → rectangle doesn't leave the
    // box hugging the edge with no margin.
    if (w.shape && w.shape !== s.webcam.shape) {
      const aspect = w.shape === 'rectangle' ? 16 / 9 : 1;
      const projectAspect = aspectToRatio(s.aspect, 16 / 9);
      const widthFrac = (next.size * aspect) / projectAspect;
      const margin = WEBCAM_EDGE_MARGIN;
      // Anchor by the side the box is closer to. Compare midpoint vs 0.5 so
      // the snap feels right whether the user dragged a tiny bit off the
      // corner or kept the default.
      const isRight = s.webcam.x + (s.webcam.size / projectAspect) / 2 >= 0.5;
      const isBottom = s.webcam.y + s.webcam.size / 2 >= 0.5;
      next.x = isRight ? Math.max(0, 1 - widthFrac - margin) : margin;
      next.y = isBottom ? Math.max(0, 1 - next.size - margin) : margin;
    }
    return { webcam: next };
  }),
  setLayoutPreset: (p) => {
    // Corner positions follow the project + webcam aspect. Width fraction =
    // size * webcamAspect / projectAspect; user can fine-tune by dragging.
    set((s) => {
      const sz = s.webcam.size;
      const webcamAspect = s.webcam.shape === 'rectangle' ? 16 / 9 : 1;
      const projectAspect = aspectToRatio(s.aspect, 16 / 9);
      const widthFrac = (sz * webcamAspect) / projectAspect;
      const margin = WEBCAM_EDGE_MARGIN;
      const right = 1 - widthFrac - margin;
      const bottom = 1 - sz - margin;
      const left = margin;
      const top = margin;
      const map: Record<EditorState['layoutPreset'], { x: number; y: number }> = {
        'pip-bottom-right': { x: right, y: bottom },
        'pip-bottom-left': { x: left, y: bottom },
        'pip-top-right': { x: right, y: top },
        'pip-top-left': { x: left, y: top },
        'side-by-side': { x: 0.5, y: 0.5 }
      };
      return { layoutPreset: p, webcam: { ...s.webcam, ...map[p] } };
    });
  },
  setPolish: (p) => set({ polish: p, effects: presetEffects[p] }),
  setShowAdvanced: (v) => set({ showAdvanced: v }),
  setEffect: (key, value) => set((s) => ({ effects: { ...s.effects, [key]: value } })),
  setZoomStyle: (z) => set({ zoomStyle: z }),
  setExportFormat: (f) => set({ exportFormat: f }),
  setExportQuality: (q) => set({ exportQuality: q }),
  setVideoVolume: (v) => set({ videoVolume: Math.max(0, Math.min(1, v)) }),
  setVideoMuted: (m) => set({ videoMuted: m }),
  addItem: (kind, atMs) => {
    const dur = get().durationMs || 1000;
    const len = Math.min(2000, Math.max(200, dur - atMs));
    const item: LaneItem = {
      id: crypto.randomUUID(),
      kind,
      startMs: atMs,
      endMs: Math.min(dur, atMs + len),
      ...(kind === 'zoom' ? { zoomLevel: 1.5, zoomTargetX: 0.5, zoomTargetY: 0.5 } : {}),
      ...(kind === 'speed' ? { speed: 1.5 } : {}),
      // New cursor effects follow the recorded cursor by default.
      ...(kind === 'magnify' || kind === 'spotlight' ? { track: 'cursor' as const } : {}),
      ...(kind === 'annotation' ? { text: '' } : {}),
      // A new rotation starts with a visible lean so it reads immediately.
      ...(kind === 'rotation' ? { tiltX: 0, tiltY: 20, spinZ: 0 } : {}),
      // A new scene starts on Orbit so something moves immediately.
      ...(kind === 'scene' ? { scene: 'orbit' } : {}),
      ...(kind === 'blur'
        ? { rectX: 0.34, rectY: 0.4, rectW: 0.32, rectH: 0.14, blurStyle: 'blur' as const, blurStrength: 0.5 }
        : {})
    };
    // Jump the preview straight to the new item and pause, so the user sees it
    // immediately instead of having to manually seek to where they added it.
    set((s) => ({ items: [...s.items, item], selectedItemId: item.id, currentMs: previewPointFor(item), playing: false }));
  },
  addWholeVideoEffect: (kind) => {
    const dur = get().durationMs || 1000;
    const item: LaneItem = { id: crypto.randomUUID(), kind, startMs: 0, endMs: dur, track: 'cursor' };
    // "Whole video" means exactly one region of this kind covering everything —
    // drop any existing same-kind regions so they don't stack underneath it.
    set((s) => ({
      items: [...s.items.filter((it) => it.kind !== kind), item],
      selectedItemId: item.id,
      editingAnnotationId: null,
      playing: false
    }));
  },
  applyEffectWholeVideo: (id) =>
    set((s) => {
      const target = s.items.find((it) => it.id === id);
      if (!target) return {};
      const dur = s.durationMs || target.endMs;
      // Stretch this region to the whole video and remove the other same-kind
      // regions, leaving a single full-span effect (matches "apply to whole
      // video" intent for both spotlight and magnify).
      return {
        items: s.items
          .filter((it) => it.id === id || it.kind !== target.kind)
          .map((it) => (it.id === id ? { ...it, startMs: 0, endMs: dur } : it)),
        selectedItemId: id
      };
    }),
  updateItem: (id, patch) =>
    set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })),
  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((it) => it.id !== id),
      selectedItemId: s.selectedItemId === id ? null : s.selectedItemId
    })),
  selectItem: (id) => set((s) => {
    // Changing selection always leaves any on-canvas text edit.
    if (!id) return { selectedItemId: id, editingAnnotationId: null };
    const it = s.items.find((i) => i.id === id);
    // Selecting an item parks the preview on it (and pauses) so its effect is
    // visible — but only when the playhead isn't already within it, so editing
    // an item you're already viewing doesn't yank the playhead around.
    if (it && (s.currentMs < it.startMs || s.currentMs > it.endMs)) {
      return { selectedItemId: id, editingAnnotationId: null, currentMs: previewPointFor(it), playing: false };
    }
    return { selectedItemId: id, editingAnnotationId: null };
  }),
  // Enter/leave on-canvas annotation text editing. Entering also ensures the
  // annotation is the selected item (so the sidebar editor stays in sync).
  setEditingAnnotation: (id) =>
    set((s) => (id ? { editingAnnotationId: id, selectedItemId: id } : { editingAnnotationId: null, selectedItemId: s.selectedItemId })),
  setPixelsPerSecond: (pps) => set({ pixelsPerSecond: Math.max(10, Math.min(800, pps)) }),
  setCursorSamples: (s) => set({ cursorSamples: s, cursorSamplesSmooth: smoothCursor(s) }),
  setCursorClicks: (c) => set({ cursorClicks: c }),
  setCursorFx: (patch) => set((st) => ({ cursorFx: { ...st.cursorFx, ...patch } })),
  suggestZooms: () => {
    const s = get();
    const suggestions = suggestZoomsFromActivity(s.cursorSamples, s.cursorClicks, s.durationMs);
    const zooms: LaneItem[] = suggestions.map((z) => ({
      id: crypto.randomUUID(),
      kind: 'zoom',
      startMs: z.startMs,
      endMs: z.endMs,
      zoomLevel: z.zoomLevel,
      zoomTargetX: z.zoomTargetX,
      zoomTargetY: z.zoomTargetY
    }));
    // Replace any existing zoom items with the fresh suggestions; leave other
    // lanes (trim/annotation/speed) untouched.
    set((st) => ({
      items: [...st.items.filter((it) => it.kind !== 'zoom'), ...zooms],
      selectedItemId: null
    }));
    return zooms.length;
  },
  serialize: () => docOf(get()),
  hydrate: (data) =>
    set({
      aspect: data.aspect,
      cropRegion: data.cropRegion ?? DEFAULT_CROP_REGION,
      background: data.background,
      // Migrate legacy 'rounded' shape — kept the square aspect so 'square'
      // (which now rounds its corners by default) is the closest match.
      webcam: {
        ...data.webcam,
        shape: (data.webcam.shape as string) === 'rounded' ? 'square' : data.webcam.shape,
        zoomFollow: data.webcam.zoomFollow ?? 0 // pre-existing projects keep a fixed-size bubble
      },
      layoutPreset: data.layoutPreset,
      polish: data.polish,
      showAdvanced: data.showAdvanced,
      effects: data.effects,
      // A project saved before zoom styles existed keeps the feel it was made
      // with, rather than silently becoming cinematic.
      zoomStyle: data.zoomStyle ?? 'snappy',
      exportFormat: data.exportFormat,
      exportQuality: data.exportQuality,
      items: data.items,
      cursorFx: { ...DEFAULT_CURSOR_FX, ...(data.cursorFx ?? {}) },
      selectedItemId: null,
      // Loading a project is a fresh document → reset undo history.
      past: [],
      future: []
    }),

  // ---- Undo / redo -------------------------------------------------------
  // Restore a document snapshot without touching transient state (playhead,
  // selection beyond validity). Used by undo/redo and never recorded itself.
  applyDoc: (snap) =>
    set((s) => ({
      aspect: snap.aspect,
      cropRegion: snap.cropRegion ?? DEFAULT_CROP_REGION,
      background: snap.background,
      webcam: snap.webcam,
      layoutPreset: snap.layoutPreset,
      polish: snap.polish,
      showAdvanced: snap.showAdvanced,
      effects: snap.effects,
      zoomStyle: snap.zoomStyle ?? s.zoomStyle,
      exportFormat: snap.exportFormat,
      exportQuality: snap.exportQuality,
      items: snap.items,
      cursorFx: snap.cursorFx ?? s.cursorFx,
      selectedItemId: snap.items.some((it) => it.id === s.selectedItemId) ? s.selectedItemId : null
    })),
  // Push a pre-change snapshot onto the past stack (called by the debounced
  // capture subscription) and drop any redo future. Cap depth at 100.
  historyCommit: (snapshot) => set((s) => ({ past: [...s.past, snapshot].slice(-100), future: [] })),
  undo: () => {
    const s = get();
    if (s.past.length === 0) return;
    const target = s.past[s.past.length - 1];
    const current = docOf(s);
    set({ _applyingHistory: true });
    get().applyDoc(target);
    set((st) => ({ past: st.past.slice(0, -1), future: [...st.future, current], _applyingHistory: false }));
  },
  redo: () => {
    const s = get();
    if (s.future.length === 0) return;
    const target = s.future[s.future.length - 1];
    const current = docOf(s);
    set({ _applyingHistory: true });
    get().applyDoc(target);
    set((st) => ({ future: st.future.slice(0, -1), past: [...st.past, current], _applyingHistory: false }));
  }
}));
