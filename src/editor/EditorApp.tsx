import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Maximize2, Minimize2, Volume2, VolumeX, Undo2, Redo2 } from 'lucide-react';
import { Preview } from './Preview';
import { Sidebar } from './Sidebar';
import { Timeline } from './Timeline';
import { useEditor, type SerializedProject } from './store';
import type { ProjectFile } from '@shared/ipc';
import wordmarkUrl from '../../assets/logo-wordmark-transparent.png';
import { useT } from '../i18n';
import { LanguageSelector } from '../i18n/LanguageSelector';

declare global {
  interface Window {
    apiEvents: {
      onRecordingOpened: (cb: (r: import('@shared/ipc').RecordingMeta) => void) => () => void;
      onProjectOpened: (
        cb: (p: { state: unknown; path: string; recording: import('@shared/ipc').RecordingMeta }) => void
      ) => () => void;
    };
  }
}

export function EditorApp() {
  const setRecording = useEditor((s) => s.setRecording);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const currentMs = useEditor((s) => s.currentMs);
  const durationMs = useEditor((s) => s.durationMs);
  const t = useT();
  const aspect = useEditor((s) => s.aspect);
  const setAspect = useEditor((s) => s.setAspect);
  const videoVolume = useEditor((s) => s.videoVolume);
  const videoMuted = useEditor((s) => s.videoMuted);
  const setVideoVolume = useEditor((s) => s.setVideoVolume);
  const setVideoMuted = useEditor((s) => s.setVideoMuted);
  const currentProjectPath = useEditor((s) => s.currentProjectPath);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  // Load recording on first mount + listen for new recordings & opened
  // projects. Also kick off the auto-save lifecycle: every fresh recording
  // gets a unique project file in the user's Projects folder, written
  // synchronously now so it exists from edit #0 (no orphans on immediate close).
  useEffect(() => {
    let cancelled = false;

    // Load the recording's cursor sidecar (if any) so "Suggest Zooms" works.
    async function loadCursor(rec: import('@shared/ipc').RecordingMeta) {
      const samples = rec.cursorFilePath ? await window.api.getCursorData(rec.cursorFilePath) : null;
      if (!cancelled) useEditor.getState().setCursorSamples(samples ?? []);
    }

    async function hydrateForRecording(rec: import('@shared/ipc').RecordingMeta) {
      const url = await window.api.getRecordingFileUrl(rec.filePath);
      const webcamUrl = rec.webcamFilePath ? await window.api.getRecordingFileUrl(rec.webcamFilePath) : null;
      if (cancelled) return;
      setRecording(rec, url, webcamUrl);
      void loadCursor(rec);

      // Initial project file for a freshly-captured recording.
      const projectPath = await window.api.initialProjectPath(rec.startedAt);
      if (cancelled) return;
      useEditor.getState().setCurrentProjectPath(projectPath);
      const initialProject: ProjectFile = {
        version: 1,
        recording: rec,
        state: useEditor.getState().serialize()
      };
      const res = await window.api.autoSaveProject(projectPath, initialProject);
      if (res.saved) useEditor.getState().setLastSavedAt(Date.now());
    }

    async function hydrateForProject(p: { state: unknown; path: string; recording: import('@shared/ipc').RecordingMeta }) {
      useEditor.getState().hydrate(p.state as SerializedProject);
      const url = await window.api.getRecordingFileUrl(p.recording.filePath);
      const webcamUrl = p.recording.webcamFilePath ? await window.api.getRecordingFileUrl(p.recording.webcamFilePath) : null;
      if (cancelled) return;
      setRecording(p.recording, url, webcamUrl);
      void loadCursor(p.recording);
      useEditor.getState().setCurrentProjectPath(p.path);
    }

    async function init() {
      // Prefer a project parked by the HUD's "Open Project" picker; fall back
      // to the lastRecording (fresh capture) if no project was loaded.
      const parked = await window.api.getLastLoadedProject();
      if (parked) {
        await hydrateForProject(parked);
        return;
      }
      const rec = await window.api.getRecordingMeta();
      if (rec) await hydrateForRecording(rec);
    }
    init();
    const offRec = window.apiEvents.onRecordingOpened(hydrateForRecording);
    const offProj = window.apiEvents.onProjectOpened(hydrateForProject);
    return () => {
      cancelled = true;
      offRec();
      offProj();
    };
  }, [setRecording]);

  // Debounced auto-save on every state change. Subscribing to the whole store
  // is intentional — every edit touches the store, so any change triggers a
  // save. 500 ms is short enough to feel "live" but coalesces rapid edits
  // (e.g. dragging a slider) into a single write.
  useEffect(() => {
    let timer: number | null = null;
    let lastJson = '';
    const unsubscribe = useEditor.subscribe((s) => {
      const projectPath = s.currentProjectPath;
      const recording = s.recording;
      if (!projectPath || !recording) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const project: ProjectFile = {
          version: 1,
          recording,
          state: useEditor.getState().serialize()
        };
        const json = JSON.stringify(project);
        // Skip the write if nothing material changed (e.g. only `playing` or
        // `currentMs` ticked, which are part of state but not in serialize()).
        if (json === lastJson) return;
        lastJson = json;
        window.api.autoSaveProject(projectPath, project).then((res) => {
          if (res.saved) useEditor.getState().setLastSavedAt(Date.now());
        });
      }, 500);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // Undo/redo history capture. Snapshot the document on every change, but
  // coalesce bursts (slider drags, chip resize) into ONE entry via a 400 ms
  // debounce. The baseline is keyed off currentProjectPath: when a project
  // loads (path changes) we re-baseline instead of recording the load as an
  // undo step — so this works regardless of which load path ran. We also skip
  // while an undo/redo is being applied (_applyingHistory). We push the
  // PRE-burst snapshot so undo returns to the state before the burst began.
  useEffect(() => {
    let burstStart: SerializedProject | null = null;
    let timer: number | null = null;
    let key: string | null = null;
    let prevDoc = '';
    const unsub = useEditor.subscribe((s) => {
      if (s._applyingHistory) {
        prevDoc = JSON.stringify(useEditor.getState().serialize());
        return;
      }
      const path = s.currentProjectPath;
      if (!path) return; // nothing loaded yet
      const nowDoc = JSON.stringify(useEditor.getState().serialize());
      if (path !== key) {
        // A project just loaded → baseline here; don't record the load itself.
        key = path;
        prevDoc = nowDoc;
        burstStart = null;
        if (timer) {
          window.clearTimeout(timer);
          timer = null;
        }
        return;
      }
      if (nowDoc === prevDoc) return; // only transient state (playhead/etc.) moved
      if (burstStart == null) burstStart = JSON.parse(prevDoc) as SerializedProject;
      prevDoc = nowDoc;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (burstStart) useEditor.getState().historyCommit(burstStart);
        burstStart = null;
        timer = null;
      }, 400);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, []);

  // Spacebar play/pause + undo/redo shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT');
      const mod = e.ctrlKey || e.metaKey;
      // Undo / redo — skip while typing so the browser's native text undo works.
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (typing) return;
        e.preventDefault();
        useEditor.getState().redo();
        return;
      }
      if (typing) return;
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
    const result = await window.api.loadProject();
    if (!result || !result.state) return;
    useEditor.getState().hydrate(result.state as SerializedProject);
    if (result.recording) {
      const rec = result.recording;
      const url = await window.api.getRecordingFileUrl(rec.filePath);
      const webcamUrl = rec.webcamFilePath ? await window.api.getRecordingFileUrl(rec.webcamFilePath) : null;
      useEditor.getState().setRecording(rec, url, webcamUrl);
    }
    // Auto-save now continues to write into the file the user just opened.
    useEditor.getState().setCurrentProjectPath(result._path);
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
          <img
            src={wordmarkUrl}
            alt="Reframe"
            className="h-7 object-contain [filter:brightness(0)_invert(1)]"
          />
          <Divider />
          <FileMenu onSave={handleSaveProject} onLoad={handleLoadProject} />
          <Divider />
          <div className="flex items-center gap-1">
            <button
              onClick={() => useEditor.getState().undo()}
              disabled={!canUndo}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={t('editor.undo')}
              title={`${t('editor.undo')} (Ctrl+Z)`}
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={() => useEditor.getState().redo()}
              disabled={!canRedo}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={t('editor.redo')}
              title={`${t('editor.redo')} (Ctrl+Shift+Z)`}
            >
              <Redo2 size={14} />
            </button>
          </div>
          {currentProjectPath && (
            <>
              <Divider />
              <ProjectNameField path={currentProjectPath} />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <LanguageSelector />
          <Divider />
          <label className="text-xs text-white/60">{t('editor.aspect')}</label>
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
          <button onClick={handleLoadProject} className="rounded-md border border-white/10 px-3 py-1 text-xs hover:bg-white/5">{t('editor.loadProject')}</button>
          <button onClick={handleSaveProject} className="rounded-md border border-white/10 px-3 py-1 text-xs hover:bg-white/5">{t('editor.saveProjectBtn')}</button>
        </div>
      </div>

      {/* main — three card panels (preview, timeline, sidebar) inset on the
          page background so the gaps between them read as gutters, openscreen-
          style. Padding / gap collapse to 0 while previewWrap is fullscreened
          so the rounded corners don't show on a 100vw element. */}
      <div className="flex flex-1 gap-2 overflow-hidden p-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            ref={previewWrapRef}
            className="flex flex-1 flex-col overflow-hidden rounded-xl border border-white/5 bg-[#0e0f12]"
          >
            <div className="flex-1 overflow-hidden">
              <Preview />
            </div>
            {/* playback strip — kept inside the fullscreen wrapper so play /
                scrub / exit remain reachable when the preview is fullscreened. */}
            <div className="flex h-10 shrink-0 items-center gap-3 border-t border-white/5 bg-[#0e0f12] px-4 text-xs">
              <button
                onClick={() => setPlaying(!playing)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                aria-label={playing ? t('editor.pause') : t('editor.play')}
                title={playing ? t('editor.pause') : t('editor.play')}
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
                aria-label={t('editor.scrubber')}
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setVideoMuted(!videoMuted)}
                  className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10"
                  aria-label={videoMuted ? t('editor.unmute') : t('editor.mute')}
                  title={videoMuted ? t('editor.unmuteHint') : t('editor.muteHint')}
                >
                  {videoMuted || videoVolume === 0 ? (
                    <VolumeX size={14} className="text-white/60" />
                  ) : (
                    <Volume2 size={14} />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((videoMuted ? 0 : videoVolume) * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    setVideoVolume(v);
                    if (v > 0 && videoMuted) setVideoMuted(false);
                    if (v === 0 && !videoMuted) setVideoMuted(true);
                  }}
                  className="h-1 w-20 cursor-pointer accent-emerald-500"
                  aria-label={t('editor.volume')}
                  title={t('editor.volume')}
                />
              </div>
              <button
                onClick={handleFullscreen}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10"
                aria-label={isFullscreen ? t('editor.exitFullscreen') : t('editor.fullscreen')}
                title={isFullscreen ? 'Exit fullscreen (Esc)' : t('editor.fullscreen')}
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
  const t = useT();
  return (
    <div className="flex items-center gap-3 text-white/60">
      <MenuItem
        label={t('editor.file')}
        items={[
          { label: t('editor.openProject'), onClick: onLoad, shortcut: 'Ctrl+O' },
          { label: t('editor.saveProject'), onClick: onSave, shortcut: 'Ctrl+S' }
        ]}
      />
      <MenuItem
        label={t('editor.edit')}
        items={[
          { label: t('editor.undo'), onClick: () => useEditor.getState().undo(), shortcut: 'Ctrl+Z' },
          { label: t('editor.redo'), onClick: () => useEditor.getState().redo(), shortcut: 'Ctrl+Shift+Z' },
          { label: t('editor.deleteSelected'), onClick: () => {
              const id = useEditor.getState().selectedItemId;
              if (id) useEditor.getState().removeItem(id);
            }, shortcut: 'Del' }
        ]}
      />
      <MenuItem
        label={t('editor.view')}
        items={[
          { label: t('editor.toggleMute'), onClick: () => {
              const s = useEditor.getState();
              s.setVideoMuted(!s.videoMuted);
            }, shortcut: 'M' }
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

function projectDisplayName(filePath: string) {
  // Take just the basename and strip the .reframe.json suffix so the toolbar
  // shows "Untitled-2026-05-18-203021" rather than the full absolute path.
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.reframe\.json$/i, '');
}

function formatSavedAgo(savedAt: number | null, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (!savedAt) return 'auto-save pending';
  const seconds = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
  if (seconds < 5) return t('editor.savedJustNow');
  if (seconds < 60) return t('editor.savedAgo', { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `saved ${minutes}m ago`;
  // Anything older falls back to a wall-clock time so it doesn't keep ticking.
  const d = new Date(savedAt);
  return `saved at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ProjectNameField({ path }: { path: string }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setCurrentProjectPath = useEditor((s) => s.setCurrentProjectPath);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);

  // The "saved 5s ago" label needs to re-render as time passes even when the
  // store hasn't changed. Tick a local counter every 10 s so the relative-time
  // string stays fresh without spamming renders.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  function enterEdit() {
    setDraft(projectDisplayName(path));
    setError(null);
    setEditing(true);
    // Focus + select on next paint, after the input renders.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  async function commit() {
    const next = draft.trim();
    if (!next || next === projectDisplayName(path)) {
      setEditing(false);
      setError(null);
      return;
    }
    const res = await window.api.renameProject(path, next);
    if (res.ok && res.path) {
      setCurrentProjectPath(res.path);
      setEditing(false);
      setError(null);
    } else {
      setError(res.error ?? 'Rename failed');
    }
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <button
        onClick={enterEdit}
        title={`${path}\n\n${t('editor.clickToRename')}`}
        className="group flex max-w-[360px] items-center gap-2 truncate rounded px-1.5 py-0.5 text-xs text-white/55 hover:bg-white/[0.06] hover:text-white/80"
      >
        <span className="truncate">{projectDisplayName(path)}</span>
        <span className="shrink-0 text-emerald-400/70">· {formatSavedAgo(lastSavedAt, t)}</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        className="w-[280px] rounded border border-emerald-400/40 bg-black/40 px-2 py-0.5 text-xs text-white outline-none focus:border-emerald-400/70"
      />
      {error && <span className="text-xs text-red-400" title={error}>!</span>}
    </div>
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
