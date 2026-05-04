import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Maximize2, Minimize2 } from 'lucide-react';
import { Preview } from './Preview';
import { Sidebar } from './Sidebar';
import { Timeline } from './Timeline';
import { useEditor, type SerializedProject } from './store';
import type { ProjectFile } from '@shared/ipc';

declare global {
  interface Window {
    apiEvents: {
      onRecordingOpened: (cb: (r: import('@shared/ipc').RecordingMeta) => void) => () => void;
    };
  }
}

export function EditorApp() {
  const setRecording = useEditor((s) => s.setRecording);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const currentMs = useEditor((s) => s.currentMs);
  const durationMs = useEditor((s) => s.durationMs);
  const aspect = useEditor((s) => s.aspect);
  const setAspect = useEditor((s) => s.setAspect);

  // Load recording on first mount + listen for new recordings
  useEffect(() => {
    let cancelled = false;
    async function loadFor(rec: import('@shared/ipc').RecordingMeta) {
      const url = await window.api.getRecordingFileUrl(rec.filePath);
      const webcamUrl = rec.webcamFilePath ? await window.api.getRecordingFileUrl(rec.webcamFilePath) : null;
      if (!cancelled) setRecording(rec, url, webcamUrl);
    }
    async function init() {
      const rec = await window.api.getRecordingMeta();
      if (rec) await loadFor(rec);
    }
    init();
    const off = window.apiEvents.onRecordingOpened(loadFor);
    return () => {
      cancelled = true;
      off();
    };
  }, [setRecording]);

  // Spacebar play/pause
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying(!useEditor.getState().playing);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPlaying]);

  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === previewWrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  async function handleSaveProject() {
    const project: ProjectFile = {
      version: 1,
      recording: useEditor.getState().recording,
      state: useEditor.getState().serialize()
    };
    const res = await window.api.saveProject(project);
    if (!res.saved) return;
    console.log('[editor] project saved to', res.path);
  }

  async function handleLoadProject() {
    const project = await window.api.loadProject();
    if (!project || !project.state) return;
    useEditor.getState().hydrate(project.state as SerializedProject);
    if (project.recording) {
      const rec = project.recording;
      const url = await window.api.getRecordingFileUrl(rec.filePath);
      const webcamUrl = rec.webcamFilePath ? await window.api.getRecordingFileUrl(rec.webcamFilePath) : null;
      useEditor.getState().setRecording(rec, url, webcamUrl);
    }
  }

  function handleFullscreen() {
    const el = previewWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0a0b0e]">
      {/* top toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/5 bg-[#0e0f12] px-4">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold tracking-wide text-emerald-400">Reframe</span>
          <Divider />
          <FileMenu onSave={handleSaveProject} onLoad={handleLoadProject} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-white/60">Aspect</label>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as any)}
            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
          >
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="1:1">1:1</option>
            <option value="9:16">9:16</option>
            <option value="auto">Auto</option>
          </select>
          <Divider />
          <button onClick={handleLoadProject} className="rounded-md border border-white/10 px-3 py-1 text-xs hover:bg-white/5">Load Project</button>
          <button onClick={handleSaveProject} className="rounded-md border border-white/10 px-3 py-1 text-xs hover:bg-white/5">Save Project</button>
        </div>
      </div>

      {/* main */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          <div ref={previewWrapRef} className="flex flex-1 flex-col overflow-hidden bg-[#0a0b0e]">
            <div className="flex-1 overflow-hidden">
              <Preview />
            </div>
            {/* playback strip — kept inside the fullscreen wrapper so play /
                scrub / exit remain reachable when the preview is fullscreened. */}
            <div className="flex h-10 shrink-0 items-center gap-3 border-t border-white/5 bg-[#0e0f12] px-4 text-xs">
              <button
                onClick={() => setPlaying(!playing)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span className="font-mono text-white/60">
                {fmt(currentMs)} / {fmt(durationMs)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(1, durationMs)}
                value={currentMs}
                onChange={(e) => useEditor.getState().setCurrent(Number(e.target.value))}
                className="flex-1 accent-emerald-500"
                aria-label="Scrubber"
              />
              <button
                onClick={handleFullscreen}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10"
                aria-label={isFullscreen ? 'Exit fullscreen preview' : 'Toggle fullscreen preview'}
                title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Toggle fullscreen preview'}
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>
          <Timeline />
        </div>
        <Sidebar />
      </div>
    </div>
  );
}

function FileMenu({ onSave, onLoad }: { onSave: () => void; onLoad: () => void }) {
  return (
    <div className="flex items-center gap-3 text-white/60">
      <MenuItem
        label="File"
        items={[
          { label: 'Open Project…', onClick: onLoad, shortcut: 'Ctrl+O' },
          { label: 'Save Project…', onClick: onSave, shortcut: 'Ctrl+S' },
          {
            label: 'Open Recordings Folder',
            onClick: () => window.api.openRecordingsFolder()
          }
        ]}
      />
      <MenuItem
        label="Edit"
        items={[
          { label: 'Delete Selected Item', onClick: () => {
              const id = useEditor.getState().selectedItemId;
              if (id) useEditor.getState().removeItem(id);
            }, shortcut: 'Del' }
        ]}
      />
      <MenuItem
        label="View"
        items={[
          { label: 'Toggle Advanced Style', onClick: () => useEditor.getState().setShowAdvanced(!useEditor.getState().showAdvanced) }
        ]}
      />
    </div>
  );
}

function MenuItem({
  label,
  items
}: {
  label: string;
  items: { label: string; onClick: () => void; shortcut?: string }[];
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none select-none text-white/60 hover:text-white">{label}</summary>
      <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-white/10 bg-[#16181d] p-1 shadow-2xl">
        {items.map((it) => (
          <button
            key={it.label}
            onClick={(e) => {
              it.onClick();
              (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
            }}
            className="flex w-full items-center justify-between gap-4 rounded px-2 py-1.5 text-left text-sm text-white/80 hover:bg-white/10"
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="text-[10px] text-white/40">{it.shortcut}</span>}
          </button>
        ))}
      </div>
    </details>
  );
}

function Divider() {
  return <span className="h-4 w-px bg-white/10" />;
}

function fmt(ms: number) {
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
