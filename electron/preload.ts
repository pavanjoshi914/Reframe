import { contextBridge, ipcRenderer } from 'electron';
import type { Api, DesktopSource, RecordingMeta, RegionSelection } from '../src/shared/ipc.js';

const api: Api = {
  getSources: () => ipcRenderer.invoke('sources:get'),
  getDisplays: () => ipcRenderer.invoke('displays:get'),
  openSourcePicker: () => ipcRenderer.invoke('picker:open'),
  selectSource: (source) => ipcRenderer.invoke('picker:select', source),
  cancelSourcePicker: () => ipcRenderer.invoke('picker:cancel'),
  onSourceSelected: (cb) => {
    const handler = (_e: unknown, source: DesktopSource) => cb(source);
    ipcRenderer.on('source:selected', handler);
    return () => ipcRenderer.off('source:selected', handler);
  },
  openRegionSelector: (displayId) => ipcRenderer.invoke('region:open', displayId),
  selectRegion: (region) => ipcRenderer.invoke('region:select', region),
  cancelRegionSelector: () => ipcRenderer.invoke('region:cancel'),
  onRegionSelected: (cb) => {
    const handler = (_e: unknown, selection: RegionSelection) => cb(selection);
    ipcRenderer.on('region:selected', handler);
    return () => ipcRenderer.off('region:selected', handler);
  },
  saveRecording: (data, meta) => ipcRenderer.invoke('recording:save', data, meta),
  saveRecordingFromFile: (screenFilePath, meta) => ipcRenderer.invoke('recording:saveFromFile', screenFilePath, meta),
  openEditor: (recording) => ipcRenderer.invoke('editor:open', recording),
  getRecordingMeta: () => ipcRenderer.invoke('recording:meta'),
  getRecordingFileUrl: (filePath) => ipcRenderer.invoke('recording:fileUrl', filePath),
  minimizeHud: () => ipcRenderer.invoke('hud:minimize'),
  closeHud: () => ipcRenderer.invoke('hud:close'),
  setHudExpanded: (expanded) => ipcRenderer.invoke('hud:setExpanded', expanded),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  loadProject: () => ipcRenderer.invoke('project:load'),
  initialProjectPath: (startedAt) => ipcRenderer.invoke('project:initialPath', startedAt),
  autoSaveProject: (filePath, project) => ipcRenderer.invoke('project:autoSave', filePath, project),
  openProjectFromPicker: () => ipcRenderer.invoke('project:openFromPicker'),
  renameProject: (oldPath, newName) => ipcRenderer.invoke('project:rename', oldPath, newName),
  getLastLoadedProject: () => ipcRenderer.invoke('project:lastLoaded'),
  openExportsFolder: () => ipcRenderer.invoke('exports:openFolder'),
  pickImageFile: () => ipcRenderer.invoke('image:pick'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  saveExport: (req) => ipcRenderer.invoke('export:save', req),
  setRecordingState: (recording) => ipcRenderer.invoke('hud:setRecording', recording),
  setPendingCaptureSource: (sourceId) => ipcRenderer.invoke('capture:setPendingSource', sourceId),
  platform: process.platform,
  ffcapStart: (opts) => ipcRenderer.invoke('ffcap:start', opts),
  ffcapStop: () => ipcRenderer.invoke('ffcap:stop'),
  getCursorData: (filePath) => ipcRenderer.invoke('cursor:load', filePath),
  onStopShortcut: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('hud:stop-shortcut', handler);
    return () => ipcRenderer.off('hud:stop-shortcut', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);

// allow editor to listen for recording opened + projects opened from HUD picker
contextBridge.exposeInMainWorld('apiEvents', {
  onRecordingOpened: (cb: (r: RecordingMeta) => void) => {
    const handler = (_e: unknown, r: RecordingMeta) => cb(r);
    ipcRenderer.on('recording:opened', handler);
    return () => ipcRenderer.off('recording:opened', handler);
  },
  onProjectOpened: (
    cb: (p: { state: unknown; path: string; recording: RecordingMeta }) => void
  ) => {
    const handler = (
      _e: unknown,
      p: { state: unknown; path: string; recording: RecordingMeta }
    ) => cb(p);
    ipcRenderer.on('project:opened', handler);
    return () => ipcRenderer.off('project:opened', handler);
  }
});
