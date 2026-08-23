// The update window's IPC surface, exposed by electron/preload.ts.
type UpdateInfoPayload = {
  current: string;
  latest: string;
  notes: string[];
  notesUrl: string;
  mode: 'silent' | 'download';
  required: boolean;
  state: 'available' | 'downloading' | 'ready' | 'error';
  progress?: number;
  error?: string;
};

interface Window {
  updateApi: {
    ready: () => void;
    onInfo: (cb: (info: UpdateInfoPayload) => void) => () => void;
    download: () => void;
    install: () => void;
    openDownloadPage: () => void;
    openExternal: (url: string) => void;
    later: () => void;
  };
}
