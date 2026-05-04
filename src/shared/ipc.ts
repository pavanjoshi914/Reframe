export type DesktopSource = {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  type: 'screen' | 'window';
};

export type RecordingMeta = {
  filePath: string;
  webcamFilePath?: string;
  durationMs: number;
  width: number;
  height: number;
  startedAt: number;
};

export type SaveRecordingMeta = Omit<RecordingMeta, 'filePath' | 'webcamFilePath'> & {
  webcamData?: ArrayBuffer;
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
  openSourcePicker: () => Promise<void>;
  selectSource: (source: DesktopSource) => Promise<void>;
  cancelSourcePicker: () => Promise<void>;
  onSourceSelected: (cb: (source: DesktopSource) => void) => () => void;
  saveRecording: (data: ArrayBuffer, meta: SaveRecordingMeta) => Promise<RecordingMeta>;
  openEditor: (recording: RecordingMeta) => Promise<void>;
  getRecordingMeta: () => Promise<RecordingMeta | null>;
  getRecordingFileUrl: (filePath: string) => Promise<string>;
  minimizeHud: () => Promise<void>;
  closeHud: () => Promise<void>;
  openRecordingsFolder: () => Promise<void>;
  saveProject: (project: ProjectFile) => Promise<{ saved: boolean; path?: string }>;
  loadProject: () => Promise<ProjectFile | null>;
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
