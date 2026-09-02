export type DesktopSource = {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  type: 'screen' | 'window';
  /** The owning app's icon (Chrome, VS Code, …), shown beside the window title
   *  in the picker. Absent for screens and for windows whose window manager
   *  doesn't supply one. */
  appIconDataUrl?: string;
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

// One sampled cursor position during a recording. `t` is ms since recording
// start; `x`/`y` are normalized 0..1 fractions of the captured frame. Used by
// the editor's "Suggest Zooms" to auto-place zoom regions where the user was
// pointing.
export type CursorSample = { t: number; x: number; y: number };
// A mouse click captured during recording (ms since start; normalized 0..1).
// Drives the editor's click-highlight ripples and click-aware auto-zoom.
export type ClickSample = { t: number; x: number; y: number };
// Which system cursor was showing, from `t` ms until the next entry. Captured
// live during recording by a small per-platform helper, because the shape isn't
// recoverable from the video or from the position samples. Absent for
// recordings made before this existed, and on platforms/sessions where it can't
// be read (Wayland) — the editor then keeps whatever fixed style is selected.
export type CursorKind = 'default' | 'text' | 'pointer' | 'grab' | 'crosshair' | 'wait';
export type CursorKindSample = { t: number; k: CursorKind };

// Parsed cursor sidecar: position samples + click events + cursor-shape
// timeline. The on-disk file may be a bare CursorSample[] (legacy),
// { samples, clicks }, or { samples, clicks, kinds } (current).
export type CursorData = { samples: CursorSample[]; clicks: ClickSample[]; kinds: CursorKindSample[] };

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
  // Path to the sidecar .cursor.json (array of CursorSample) captured during
  // recording, if cursor tracking produced any samples.
  cursorFilePath?: string;
  // True when captured with the OS cursor hidden (the PipeWire ScreenCast
  // helper on Linux, or getDisplayMedia cursor:'never' elsewhere). The video
  // has NO baked cursor, so the editor auto-enables the synthetic Smooth
  // cursor for this recording.
  hideCursor?: boolean;
};

export type SaveRecordingMeta = Omit<RecordingMeta, 'filePath' | 'webcamFilePath'> & {
  webcamData?: ArrayBuffer;
  // MediaRecorder mimeType each blob was actually encoded as. The container
  // varies by platform (H.264/MP4 where there's a hardware encoder, VP8/WebM
  // otherwise), and main writes the file extension from this — a wrong
  // extension makes the media:// handler serve the wrong MIME and <video>
  // reject the file. Absent on the PipeWire path, which hands over a real path.
  mimeType?: string;
  webcamMimeType?: string;
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
  // Save path for the cursor-hidden capture: the screen file already exists
  // on disk (the PipeWire helper wrote it), so we pass its path, not a blob.
  saveRecordingFromFile: (screenFilePath: string, meta: SaveRecordingMeta) => Promise<RecordingMeta>;
  openEditor: (recording: RecordingMeta) => Promise<void>;
  getRecordingMeta: () => Promise<RecordingMeta | null>;
  getRecordingFileUrl: (filePath: string) => Promise<string>;
  minimizeHud: () => Promise<void>;
  closeHud: () => Promise<void>;
  setHudExpanded: (expanded: boolean) => Promise<void>;
  // Report the pill's measured size so main can keep the HUD window exactly as
  // big as its contents — the pill's width changes with the source label and
  // with the recording controls, and a fixed-size window made the recording
  // layout overflow into scrollbars.
  setHudContentSize: (width: number, height: number) => Promise<void>;
  // "Save As" dialog — used for an explicit copy. Auto-save is the normal flow.
  saveProject: (project: ProjectFile) => Promise<{ saved: boolean; path?: string }>;
  // Returns the loaded project plus the on-disk path so the editor knows where
  // to continue auto-saving to. `_path` is added by main, not stored in the file.
  loadProject: () => Promise<(ProjectFile & { _path: string }) | null>;
  // Auto-save helpers. autoSaveProject writes to the known path silently (no
  // dialog) on every state change.
  // One project file per recording, forever. findProjectForRecording returns
  // the existing project for a recording (or null); initialProjectPath is the
  // deterministic path to create one at — derived from the recording's own
  // filename, so reopening the same recording never forks a new project.
  findProjectForRecording: (recordingPath: string) => Promise<string | null>;
  // Silently read a project by path (no dialog) — how the editor reopens the
  // existing project for a recording.
  loadProjectAt: (filePath: string) => Promise<(ProjectFile & { _path: string }) | null>;
  initialProjectPath: (recordingPath: string) => Promise<string>;
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
  // Alternate export encoder: composited frames are streamed to the bundled
  // ffmpeg (x264) instead of Chromium's WebCodecs. See the handlers in main.
  rawEncodeBegin: (req: { width: number; height: number; fps: number; bitrate: number }) => Promise<{ id: string }>;
  rawEncodeFrame: (id: string, data: ArrayBuffer) => Promise<{ ok: boolean }>;
  rawEncodeEnd: (id: string, wav?: ArrayBuffer) => Promise<{ ok: boolean; data?: ArrayBuffer }>;
  setRecordingState: (recording: boolean) => Promise<void>;
  // Tell main which desktopCapturer source the next getDisplayMedia call (used
  // for cursor-hidden capture) should resolve to.
  setPendingCaptureSource: (sourceId: string) => Promise<void>;
  // process.platform, exposed so the renderer can pick the Linux-only
  // cursor-hidden capture path (and its codec) without an async round-trip.
  platform: string;
  // Start/stop the PipeWire ScreenCast cursor-hidden screen capture (Linux only).
  // start returns { ok:false } when unavailable so the caller can fall back to
  // the normal Chromium capture; stop returns the finalized screen mp4 path.
  ffcapStart: (opts: { withSystemAudio: boolean; withMic: boolean }) => Promise<{
    ok: boolean;
    width: number;
    height: number;
    // Set by the Windows/macOS native capture path: ffmpeg cannot reach system
    // audio there, so the renderer records it and passes it to ffcapStop.
    audioFromRenderer?: boolean;
  }>;
  ffcapStop: (audio?: { data: ArrayBuffer; startedAt: number }) => Promise<{ filePath: string; width: number; height: number; durationMs: number } | null>;
  onStopShortcut: (cb: () => void) => () => void;
  // Load the sidecar cursor data (samples + clicks) for a recording. Returns
  // null if there's no sidecar. Normalizes the legacy bare-array format.
  getCursorData: (filePath: string) => Promise<CursorData | null>;
};

declare global {
  interface Window {
    api: Api;
  }
}
