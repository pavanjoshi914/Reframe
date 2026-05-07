import { create } from 'zustand';
import type { RecordingMeta } from '@shared/ipc';

export type AspectRatio = '16:9' | '4:3' | '1:1' | '9:16' | 'auto';
export type LaneKind = 'zoom' | 'trim' | 'annotation' | 'speed';

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
};

export type BackgroundMode = 'image' | 'color' | 'gradient';

export type PolishPreset = 'subtle' | 'soft' | 'dramatic';

export type WebcamShape = 'circle' | 'square' | 'rounded';

export type EditorState = {
  recording: RecordingMeta | null;
  fileUrl: string | null;
  webcamFileUrl: string | null;
  durationMs: number;
  currentMs: number;
  playing: boolean;
  videoIntrinsicSize: { width: number; height: number } | null;

  aspect: AspectRatio;

  // Composition
  background: { mode: BackgroundMode; value: string };
  webcam: { x: number; y: number; size: number; enabled: boolean; shape: WebcamShape }; // x,y in 0..1 (normalized)
  layoutPreset: 'pip-bottom-right' | 'pip-bottom-left' | 'pip-top-right' | 'pip-top-left' | 'side-by-side';

  // Style
  polish: PolishPreset;
  showAdvanced: boolean;
  effects: { roundnessPx: number; paddingPct: number; shadowPct: number; motionBlur: number; blurBg: boolean };

  // Audio — applies to preview playback AND to export. When muted, the export
  // pipeline drops the audio track entirely, so the saved file has no sound.
  videoVolume: number; // 0..1
  videoMuted: boolean;

  // Export
  exportFormat: 'mp4' | 'gif';
  exportQuality: 'low' | 'medium' | 'high';

  // Timeline
  items: LaneItem[];
  selectedItemId: string | null;
  pixelsPerSecond: number;

  // Actions
  setRecording: (r: RecordingMeta, fileUrl: string, webcamFileUrl?: string | null) => void;
  setVideoIntrinsicSize: (size: { width: number; height: number } | null) => void;
  setCurrent: (ms: number) => void;
  setPlaying: (p: boolean) => void;
  setAspect: (a: AspectRatio) => void;
  setBackground: (b: { mode: BackgroundMode; value: string }) => void;
  setWebcam: (w: Partial<EditorState['webcam']>) => void;
  setLayoutPreset: (p: EditorState['layoutPreset']) => void;
  setPolish: (p: PolishPreset) => void;
  setShowAdvanced: (v: boolean) => void;
  setEffect: <K extends keyof EditorState['effects']>(key: K, value: EditorState['effects'][K]) => void;
  setExportFormat: (f: 'mp4' | 'gif') => void;
  setExportQuality: (q: 'low' | 'medium' | 'high') => void;
  setVideoVolume: (v: number) => void;
  setVideoMuted: (m: boolean) => void;
  addItem: (kind: LaneKind, atMs: number) => void;
  updateItem: (id: string, patch: Partial<LaneItem>) => void;
  removeItem: (id: string) => void;
  selectItem: (id: string | null) => void;
  setPixelsPerSecond: (pps: number) => void;
  serialize: () => SerializedProject;
  hydrate: (data: SerializedProject) => void;
};

export type SerializedProject = {
  aspect: AspectRatio;
  background: EditorState['background'];
  webcam: EditorState['webcam'];
  layoutPreset: EditorState['layoutPreset'];
  polish: PolishPreset;
  showAdvanced: boolean;
  effects: EditorState['effects'];
  exportFormat: EditorState['exportFormat'];
  exportQuality: EditorState['exportQuality'];
  items: LaneItem[];
};

const presetEffects: Record<PolishPreset, EditorState['effects']> = {
  subtle: { roundnessPx: 6, paddingPct: 25, shadowPct: 6, motionBlur: 0, blurBg: false },
  soft: { roundnessPx: 14, paddingPct: 50, shadowPct: 16, motionBlur: 0, blurBg: false },
  dramatic: { roundnessPx: 22, paddingPct: 70, shadowPct: 32, motionBlur: 0.5, blurBg: true }
};

export const useEditor = create<EditorState>((set, get) => ({
  recording: null,
  fileUrl: null,
  webcamFileUrl: null,
  durationMs: 0,
  currentMs: 0,
  playing: false,
  videoIntrinsicSize: null,

  aspect: '16:9',

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

  items: [],
  selectedItemId: null,
  pixelsPerSecond: 60,

  setRecording: (r, fileUrl, webcamFileUrl) =>
    set((s) => ({
      recording: r,
      fileUrl,
      webcamFileUrl: webcamFileUrl ?? null,
      durationMs: r.durationMs,
      // Auto-enable webcam in editor if a webcam file came with the recording
      // and the user hasn't explicitly turned it on/off in this session.
      webcam: webcamFileUrl ? { ...s.webcam, enabled: true } : s.webcam
    })),
  setVideoIntrinsicSize: (size) => set({ videoIntrinsicSize: size }),
  setCurrent: (ms) => set({ currentMs: ms }),
  setPlaying: (p) => set({ playing: p }),
  setAspect: (a) => set({ aspect: a }),
  setBackground: (b) => set({ background: b }),
  setWebcam: (w) => set((s) => ({ webcam: { ...s.webcam, ...w } })),
  setLayoutPreset: (p) => {
    // Corner positions assume a 16:9 stage and the current webcam size; user
    // can fine-tune by dragging. side_in_W = size * 9/16, margin = 4%.
    set((s) => {
      const sz = s.webcam.size;
      const sideInW = sz * (9 / 16);
      const margin = 0.04;
      const right = 1 - sideInW - margin;
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
      ...(kind === 'annotation' ? { text: 'Note' } : {})
    };
    set((s) => ({ items: [...s.items, item], selectedItemId: item.id }));
  },
  updateItem: (id, patch) =>
    set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })),
  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((it) => it.id !== id),
      selectedItemId: s.selectedItemId === id ? null : s.selectedItemId
    })),
  selectItem: (id) => set({ selectedItemId: id }),
  setPixelsPerSecond: (pps) => set({ pixelsPerSecond: Math.max(10, Math.min(800, pps)) }),
  serialize: () => {
    const s = get();
    return {
      aspect: s.aspect,
      background: s.background,
      webcam: s.webcam,
      layoutPreset: s.layoutPreset,
      polish: s.polish,
      showAdvanced: s.showAdvanced,
      effects: s.effects,
      exportFormat: s.exportFormat,
      exportQuality: s.exportQuality,
      items: s.items
    };
  },
  hydrate: (data) =>
    set({
      aspect: data.aspect,
      background: data.background,
      webcam: data.webcam,
      layoutPreset: data.layoutPreset,
      polish: data.polish,
      showAdvanced: data.showAdvanced,
      effects: data.effects,
      exportFormat: data.exportFormat,
      exportQuality: data.exportQuality,
      items: data.items,
      selectedItemId: null
    })
}));
