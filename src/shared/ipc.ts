export type DesktopSource = {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  type: 'screen' | 'window';
};

// Normalized region (0..1) inside the source frame. The overlay reports
// fractions of its own window size; this matches the editor's cropRegion
// shape exactly, so the editor can pre-fill its crop without any conversion.
export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplayInfo = {
  id: string;
  name: string;
  // Logical bounds (CSS pixels) as reported by electron.screen.
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  // The desktopCapturer screen source id that captures this display.
  sourceId: string;
  thumbnailDataUrl: string;
};

export type RecordingMeta = {
  filePath: string;
  webcamFilePath?: string;
  durationMs: number;
  width: number;
  height: number;
  startedAt: number;
  // When the recording was captured with a region selection, this stores the
  // chosen rectangle as normalized fractions (0..1) of the captured frame.
  // The editor uses it directly to pre-fill cropRegion.
  region?: Region;
};

export type SaveRecordingMeta = Omit<RecordingMeta, 'filePath' | 'webcamFilePath'> & {
  webcamData?: ArrayBuffer;
};

// Sent from main → HUD when the user confirms a region selection.
export type RegionSelection = {
  source: DesktopSource;
  region: Region;
};

export type ProjectFile = {
  version: 1;
  recording: RecordingMeta | null;
  state: unknown;
};

export type ExportRequest = {
  defaultName: string;
  data: ArrayBuffer;
  format: 'mp4' | 'gif' | 'webm';
};

export type Api = {
  getSources: () => Promise<DesktopSource[]>;
  getDisplays: () => Promise<DisplayInfo[]>;
  openSourcePicker: () => Promise<void>;
  selectSource: (source: DesktopSource) => Promise<void>;
  cancelSourcePicker: () => Promise<void>;
  onSourceSelected: (cb: (source: DesktopSource) => void) => () => void;
  // Region selection (drag-to-select overlay)
  openRegionSelector: (displayId: string) => Promise<void>;
  selectRegion: (region: Region) => Promise<void>;
  cancelRegionSelector: () => Promise<void>;
  onRegionSelected: (cb: (selection: RegionSelection) => void) => () => void;
  saveRecording: (data: ArrayBuffer, meta: SaveRecordingMeta) => Promise<RecordingMeta>;
  openEditor: (recording: RecordingMeta) => Promise<void>;
  getRecordingMeta: () => Promise<RecordingMeta | null>;
  getRecordingFileUrl: (filePath: string) => Promise<string>;
  minimizeHud: () => Promise<void>;
  closeHud: () => Promise<void>;
  // "Save As" dialog — used for an explicit copy. Auto-save is the normal flow.
  saveProject: (project: ProjectFile) => Promise<{ saved: boolean; path?: string }>;
  // Returns the loaded project plus the on-disk path so the editor knows where
  // to continue auto-saving to. `_path` is added by main, not stored in the file.
  loadProject: () => Promise<(ProjectFile & { _path: string }) | null>;
  // Auto-save helpers — initialPath generates the unique "Untitled-<ts>.reframe.json"
  // path the moment a recording loads; autoSaveProject writes to that path
  // silently (no dialog) on every state change.
  initialProjectPath: (startedAt: number) => Promise<string>;
  autoSaveProject: (filePath: string, project: ProjectFile) => Promise<{ saved: boolean; path?: string }>;
  // Open the .reframe.json picker dialog (defaults to Projects folder) and,
  // on selection, route the project into the editor (creating one if needed).
  openProjectFromPicker: () => Promise<{ opened: boolean; path?: string }>;
  // Rename the project on disk (basename only; stays in Projects folder).
  renameProject: (oldPath: string, newName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  // Fetch a project parked by openProjectFromPicker — consumed by the editor
  // on first mount to hydrate state. Single-use.
  getLastLoadedProject: () => Promise<{ state: unknown; path: string; recording: RecordingMeta } | null>;
  // Browse exports (user-visible MP4/GIF/WebM files).
  openExportsFolder: () => Promise<void>;
  pickImageFile: () => Promise<{ dataUrl: string; name: string } | null>;
  openExternal: (url: string) => Promise<void>;
  saveExport: (req: ExportRequest) => Promise<{ saved: boolean; path?: string }>;
  setRecordingState: (recording: boolean) => Promise<void>;
  onStopShortcut: (cb: () => void) => () => void;
};

declare global {
  interface Window {
    api: Api;
  }
}
