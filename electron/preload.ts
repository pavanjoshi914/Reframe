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
  openEditor: (recording) => ipcRenderer.invoke('editor:open', recording),
  getRecordingMeta: () => ipcRenderer.invoke('recording:meta'),
  getRecordingFileUrl: (filePath) => ipcRenderer.invoke('recording:fileUrl', filePath),
  minimizeHud: () => ipcRenderer.invoke('hud:minimize'),
  closeHud: () => ipcRenderer.invoke('hud:close'),
  openRecordingsFolder: () => ipcRenderer.invoke('recordings:openFolder'),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  loadProject: () => ipcRenderer.invoke('project:load'),
  pickImageFile: () => ipcRenderer.invoke('image:pick'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  saveExport: (req) => ipcRenderer.invoke('export:save', req),
  setRecordingState: (recording) => ipcRenderer.invoke('hud:setRecording', recording),
  onStopShortcut: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('hud:stop-shortcut', handler);
    return () => ipcRenderer.off('hud:stop-shortcut', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);

// allow editor to listen for recording opened
contextBridge.exposeInMainWorld('apiEvents', {
  onRecordingOpened: (cb: (r: RecordingMeta) => void) => {
    const handler = (_e: unknown, r: RecordingMeta) => cb(r);
    ipcRenderer.on('recording:opened', handler);
    return () => ipcRenderer.off('recording:opened', handler);
  }
});
