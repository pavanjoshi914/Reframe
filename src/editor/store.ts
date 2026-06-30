import { create } from 'zustand';
import type { RecordingMeta, CursorSample, ClickSample } from '@shared/ipc';
import { suggestZoomsFromCursor } from './autoZoom';

export type AspectRatio = '16:9' | '4:3' | '1:1' | '9:16' | 'auto';
export type LaneKind = 'zoom' | 'trim' | 'annotation' | 'speed' | 'magnify' | 'spotlight';

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
  text?: string;
  speed?: number;
  // Spotlight / magnify: how the lens is positioned over its time range.
  // 'cursor' (default) follows the recorded cursor; 'manual' stays put at
  // posX/posY (fractions of the output frame), which the user drags on the
  // preview. Whole-video application is just a region spanning 0..durationMs.
  track?: 'cursor' | 'manual';
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
  webcam: { x: number; y: number; size: number; enabled: boolean; shape: WebcamShape }; // x,y in 0..1 (normalized)
  layoutPreset: 'pip-bottom-right' | 'pip-bottom-left' | 'pip-top-right' | 'pip-top-left' | 'side-by-side';

  // Style
  polish: PolishPreset;
  showAdvanced: boolean;
  effects: { roundnessPx: number; paddingPct: number; shadowPct: number; motionBlur: number; blurBg: boolean; cursorSpotlight: number; cursorMagnifier: number };

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
  cursorFx: { enabled: boolean; size: number; clicks: boolean };

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
  exportFormat: EditorState['exportFormat'];
  exportQuality: EditorState['exportQuality'];
  items: LaneItem[];
  cursorFx?: EditorState['cursorFx'];
};

const DEFAULT_CURSOR_FX: EditorState['cursorFx'] = { enabled: false, size: 1.4, clicks: true };

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

// Jitter-smooth the captured cursor path with a symmetric moving average. A
// window of ±win samples (~40ms each) rounds off the shaky hand motion into a
// smooth glide while keeping near-zero net lag (symmetric, unlike an EMA). The
// rounded corners are exactly the "buttery" look these demo tools are known for.
function smoothCursor(samples: CursorSample[], win = 4): CursorSample[] {
  if (samples.length < 3) return samples.slice();
  const out: CursorSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    let sx = 0, sy = 0, n = 0;
    const lo = Math.max(0, i - win);
    const hi = Math.min(samples.length - 1, i + win);
    for (let j = lo; j <= hi; j++) { sx += samples[j].x; sy += samples[j].y; n++; }
    out.push({ t: samples[i].t, x: sx / n, y: sy / n });
  }
  return out;
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
  background: { mode: 'gradient', value: 'linear-gradient(135deg,#fb923c,#ec4899)' },
  // x,y are top-left position normalized to the stage (0..1).
  // size is the webcam's diameter as a fraction of stage HEIGHT — guarantees
  // it stays square AND fits inside any landscape aspect.
  // Default 0.25 = 25% of stage height. Corner position math:
  // x = 1 - size*9/16 - 0.04, y = 1 - size - 0.04.
  webcam: { x: 0.85, y: 0.76, size: 0.2, enabled: false, shape: 'circle' },
  layoutPreset: 'pip-bottom-right',

  polish: 'soft',
  showAdvanced: false,
  effects: presetEffects.soft,

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
  cursorFx: { enabled: false, size: 1.4, clicks: true },

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
      const margin = 0.04;
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
      const margin = 0.04;
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
      ...(kind === 'annotation' ? { text: '' } : {})
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
    const suggestions = suggestZoomsFromCursor(s.cursorSamples, s.durationMs);
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
        shape: (data.webcam.shape as string) === 'rounded' ? 'square' : data.webcam.shape
      },
      layoutPreset: data.layoutPreset,
      polish: data.polish,
      showAdvanced: data.showAdvanced,
      effects: data.effects,
      exportFormat: data.exportFormat,
      exportQuality: data.exportQuality,
      items: data.items,
      cursorFx: data.cursorFx ?? DEFAULT_CURSOR_FX,
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
