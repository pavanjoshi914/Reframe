import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Maximize2, Minimize2, Volume2, VolumeX, Undo2, Redo2, Heart, Sun, Moon, ChevronUp, ChevronDown, Camera, Check, Crop, Copy, Image as ImageIcon } from 'lucide-react';
import { SPONSOR_URL } from '@shared/sponsor';
import { Preview } from './Preview';
import { Sidebar } from './Sidebar';
import { Timeline } from './Timeline';
import { CropModal } from './CropModal';
import { useEditor, type SerializedProject } from './store';
import { isTextEntry } from './textEntry';
import type { ProjectFile } from '@shared/ipc';
import { saveStillNow, copyImageToClipboardNow } from './export';
import wordmarkUrl from '../../assets/logo-wordmark-transparent.png';
import { useT } from '../i18n';
import { LanguageSelector } from '../i18n/LanguageSelector';

declare global {
  interface Window {
    apiEvents: {
      onRecordingOpened: (cb: (r: import('@shared/ipc').RecordingMeta) => void) => () => void;
      onProjectOpened: (
        cb: (p: { state: unknown; path: string; recording: import('@shared/ipc').RecordingMeta | null; image?: import('@shared/ipc').ImageMeta | null; mediaType?: 'video' | 'image' }) => void
      ) => () => void;
      onImageOpened?: (cb: (img: import('@shared/ipc').ImageMeta) => void) => () => void;
    };
  }
}

export function EditorApp() {
  const [shotFlash, setShotFlash] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const theme = useEditor((s) => s.theme);
  const setTheme = useEditor((s) => s.setTheme);
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
  const fileUrl = useEditor((s) => s.fileUrl);
  const cropRegion = useEditor((s) => s.cropRegion);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const isCropped =
    cropRegion.x !== 0 || cropRegion.y !== 0 || cropRegion.width !== 1 || cropRegion.height !== 1;

  async function hydrateForImage(img: import('@shared/ipc').ImageMeta) {
    if (!img) return;
    const fileUrl = img.filePath ? (await window.api.getRecordingFileUrl(img.filePath).catch(() => img.fileUrl)) : img.fileUrl;
    const resolved = { ...img, fileUrl: fileUrl || img.fileUrl };
    useEditor.getState().setImage(resolved);
    try {
      const existing = await window.api.findProjectForRecording(img.filePath);
      if (existing) {
        const loaded = await window.api.loadProjectAt(existing);
        if (loaded) {
          useEditor.getState().hydrate(loaded.state as SerializedProject);
          useEditor.getState().setCurrentProjectPath(existing);
          return;
        }
      }
      const projectPath = await window.api.initialProjectPath(img.filePath);
      useEditor.getState().setCurrentProjectPath(projectPath);
    } catch (err) {
      console.warn('[editor] failed to find project for image', err);
    }
  }

  // Load recording/image on first mount + listen for new recordings, opened
  // images & opened projects.
  useEffect(() => {
    // Load the recording's cursor sidecar (if any) so "Suggest Zooms" works.
    async function loadCursor(rec: import('@shared/ipc').RecordingMeta) {
      const data = rec.cursorFilePath ? await window.api.getCursorData(rec.cursorFilePath) : null;
      useEditor.getState().setCursorSamples(data?.samples ?? []);
      useEditor.getState().setCursorClicks(data?.clicks ?? []);
      useEditor.getState().setCursorKinds(data?.kinds ?? []);
    }

    async function hydrateForRecording(rec: import('@shared/ipc').RecordingMeta) {
      if (!rec) return;
      const url = await window.api.getRecordingFileUrl(rec.filePath);
      const webcamUrl = rec.webcamFilePath ? await window.api.getRecordingFileUrl(rec.webcamFilePath) : null;
      setRecording(rec, url, webcamUrl);
      if (rec.hideCursor) useEditor.getState().setCursorFx({ enabled: true });
      void loadCursor(rec);

      try {
        const existing = await window.api.findProjectForRecording(rec.filePath);
        if (existing) {
          const loaded = await window.api.loadProjectAt(existing);
          if (loaded) {
            useEditor.getState().hydrate(loaded.state as SerializedProject);
            useEditor.getState().setCurrentProjectPath(existing);
            return;
          }
        }
        const projectPath = await window.api.initialProjectPath(rec.filePath);
        useEditor.getState().setCurrentProjectPath(projectPath);
      } catch (err) {
        console.warn('[editor] failed to find project for recording', err);
      }
    }

    async function hydrateForProject(p: { state: unknown; path: string; recording: import('@shared/ipc').RecordingMeta | null; image?: import('@shared/ipc').ImageMeta | null; mediaType?: 'video' | 'image' }) {
      if (!p) return;
      const stateObj = p.state as SerializedProject | undefined;
      const img = p.image ?? stateObj?.imageMeta ?? null;
      const isImg = p.mediaType === 'image' || (!p.recording && !!img);
      if (isImg && img) {
        const fileUrl = img.filePath ? (await window.api.getRecordingFileUrl(img.filePath).catch(() => img.fileUrl)) : img.fileUrl;
        useEditor.getState().setImage({ ...img, fileUrl: fileUrl || img.fileUrl });
      } else if (p.recording) {
        const url = await window.api.getRecordingFileUrl(p.recording.filePath);
        const webcamUrl = p.recording.webcamFilePath ? await window.api.getRecordingFileUrl(p.recording.webcamFilePath) : null;
        setRecording(p.recording, url, webcamUrl);
        if (p.recording.hideCursor) useEditor.getState().setCursorFx({ enabled: true });
        void loadCursor(p.recording);
      }
      useEditor.getState().hydrate(p.state as SerializedProject);
      useEditor.getState().clearAutoTrimPending();
      useEditor.getState().setCurrentProjectPath(p.path);
    }

    async function init() {
      const parked = await window.api.getLastLoadedProject();
      if (parked && (parked.recording || parked.image || (parked.state as any)?.imageMeta)) {
        await hydrateForProject(parked);
        return;
      }
      const parkedImg = await window.api.getLastLoadedImage();
      if (parkedImg) {
        await hydrateForImage(parkedImg);
        return;
      }
      const rec = await window.api.getRecordingMeta();
      if (rec) await hydrateForRecording(rec);
    }
    init();
    const offRec = window.apiEvents.onRecordingOpened(hydrateForRecording);
    const offProj = window.apiEvents.onProjectOpened(hydrateForProject);
    const offImg = window.apiEvents.onImageOpened?.(hydrateForImage);
    return () => {
      offRec();
      offProj();
      offImg?.();
    };
  }, [setRecording]);

  // Drag and drop / paste images directly into the editor
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsDragOver(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDragOver(false);
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (file.type.startsWith('image/')) {
        const buf = await file.arrayBuffer();
        const imgMeta = await window.api.importImageBuffer(buf, file.name);
        if (imgMeta) {
          await hydrateForImage(imgMeta);
        }
      }
    };
    const onPaste = async (e: ClipboardEvent) => {
      if (isTextEntry(document.activeElement)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const buf = await file.arrayBuffer();
            const imgMeta = await window.api.importImageBuffer(buf, `pasted-${Date.now()}.png`);
            if (imgMeta) {
              await hydrateForImage(imgMeta);
            }
          }
          break;
        }
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  // Debounced auto-save on every state change.
  useEffect(() => {
    let timer: number | null = null;
    let lastJson = '';
    let lastPath: string | null = null;

    const flushSave = () => {
      const projectPath = useEditor.getState().currentProjectPath;
      const recording = useEditor.getState().recording;
      const image = useEditor.getState().imageMeta;
      const mediaType = useEditor.getState().mediaType;
      if (!projectPath || (!recording && !image)) return;
      const project: ProjectFile = {
        version: 1,
        recording,
        image,
        mediaType,
        state: useEditor.getState().serialize()
      };
      const json = JSON.stringify(project);
      if (json === lastJson) return;
      lastJson = json;
      window.api.autoSaveProject(projectPath, project).then((res) => {
        if (res.saved) useEditor.getState().setLastSavedAt(Date.now());
      });
    };

    const unsubscribe = useEditor.subscribe((s) => {
      const projectPath = s.currentProjectPath;
      const recording = s.recording;
      const image = s.imageMeta;
      const mediaType = s.mediaType;
      if (!projectPath || (!recording && !image)) return;
      if (projectPath !== lastPath) {
        lastPath = projectPath;
        lastJson = JSON.stringify({ version: 1, recording, image, mediaType, state: useEditor.getState().serialize() });
        return;
      }
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        flushSave();
      }, 500);
    });

    const onBeforeUnload = () => {
      flushSave();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('beforeunload', onBeforeUnload);
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
      // Only REAL text entry suppresses shortcuts — a focused range slider (the
      // scrubber, the volume, every sidebar slider) must not.
      const typing = isTextEntry(e.target) || !!useEditor.getState().editingAnnotationId;
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
      if (mod && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        void handleOpenImage();
        return;
      }
      if (typing) return;
      if ((e.key === 'c' || e.key === 'C') && !mod && !e.altKey) {
        e.preventDefault();
        if (useEditor.getState().fileUrl) setCropModalOpen((v) => !v);
        return;
      }
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

  async function handleOpenImage() {
    const img = await window.api.pickImageForEditing();
    if (img) {
      await hydrateForImage(img);
    }
  }

  async function handleSaveProject() {
    const project: ProjectFile = {
      version: 1,
      recording: useEditor.getState().recording,
      image: useEditor.getState().imageMeta,
      mediaType: useEditor.getState().mediaType,
      state: useEditor.getState().serialize()
    };
    const res = await window.api.saveProject(project);
    if (!res.saved) return;
    console.log('[editor] project saved to', res.path);
  }

  async function handleLoadProject() {
    const result = await window.api.loadProject();
    if (!result || !result.state) return;
    const stateObj = result.state as SerializedProject | undefined;
    const img = result.image ?? stateObj?.imageMeta ?? null;
    const isImg = result.mediaType === 'image' || (!result.recording && !!img);
    if (isImg && img) {
      const fileUrl = img.filePath ? (await window.api.getRecordingFileUrl(img.filePath).catch(() => img.fileUrl)) : img.fileUrl;
      useEditor.getState().setImage({ ...img, fileUrl: fileUrl || img.fileUrl });
    } else if (result.recording) {
      const rec = result.recording;
      const url = await window.api.getRecordingFileUrl(rec.filePath);
      const webcamUrl = rec.webcamFilePath ? await window.api.getRecordingFileUrl(rec.webcamFilePath) : null;
      useEditor.getState().setRecording(rec, url, webcamUrl);
    }
    useEditor.getState().hydrate(result.state as SerializedProject);
    useEditor.getState().clearAutoTrimPending();
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
    <div className="flex h-screen w-screen flex-col bg-[var(--bg)]">
      {/* top toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between bg-transparent px-4">
        <div className="flex items-center gap-3 text-sm">
          <img
            src={wordmarkUrl}
            alt="Reframe"
            className="h-7 object-contain"
            style={{ filter: 'var(--wordmark)' }}
          />
          <Divider />
          <FileMenu onSave={handleSaveProject} onLoad={handleLoadProject} onOpenImage={handleOpenImage} onCrop={() => setCropModalOpen(true)} />
          <Divider />
          <div className="flex items-center gap-1">
            <button
              onClick={() => useEditor.getState().undo()}
              disabled={!canUndo}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--fill)] hover:bg-[var(--fill-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-[var(--fill)]"
              aria-label={t('editor.undo')}
              title={`${t('editor.undo')} (Ctrl+Z)`}
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={() => useEditor.getState().redo()}
              disabled={!canRedo}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--fill)] hover:bg-[var(--fill-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-[var(--fill)]"
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
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--muted)] hover:bg-[var(--fill-hover)] hover:text-[var(--text)]"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <LanguageSelector />
          <Divider />
          <label className="text-xs text-[var(--muted)]">{t('editor.aspect')}</label>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as any)}
            className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1 text-xs"
          >
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="1:1">1:1</option>
            <option value="9:16">9:16</option>
            <option value="auto">Auto</option>
          </select>
          <Divider />
          <button onClick={handleOpenImage} className="rounded-full bg-[var(--fill)] px-3 py-1 text-xs font-medium hover:bg-[var(--fill-hover)]">{t('editor.openImage')}</button>
          <button onClick={handleLoadProject} className="rounded-full bg-[var(--fill)] px-3 py-1 text-xs font-medium hover:bg-[var(--fill-hover)]">{t('editor.loadProject')}</button>
          <button onClick={handleSaveProject} className="rounded-full bg-[var(--fill)] px-3 py-1 text-xs font-medium hover:bg-[var(--fill-hover)]">{t('editor.saveProjectBtn')}</button>
          <Divider />
          {/* Always-available way to support the project, so the post-export
              prompt can stay rare and dismissible. */}
          <button
            onClick={() => void window.api.openExternal(SPONSOR_URL)}
            title={t('editor.sponsorTitle')}
            aria-label={t('editor.sponsorTitle')}
            className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--muted)] transition hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300"
          >
            <Heart size={13} fill="currentColor" className="text-rose-400" />
            {t('editor.sponsor')}
          </button>
        </div>
      </div>

      {/* main — three card panels (preview, timeline, sidebar) inset on the
          page background so the gaps between them read as gutters, openscreen-
          style. Padding / gap collapse to 0 while previewWrap is fullscreened
          so the rounded corners don't show on a 100vw element. */}
      <div className="flex flex-1 gap-3 overflow-hidden p-3 pt-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div
            ref={previewWrapRef}
            className="flex flex-1 flex-col overflow-hidden rounded-xl bg-[var(--panel)]"
          >
            <div className="flex-1 overflow-hidden">
              <Preview />
            </div>
            {/* playback strip — kept inside the fullscreen wrapper so play /
                scrub / exit remain reachable when the preview is fullscreened. */}
            <div className="flex h-10 shrink-0 items-center gap-3 border-t border-[var(--line)] bg-[var(--panel)] px-4 text-xs">
              <button
                onClick={() => setPlaying(!playing)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--panel-3)] hover:bg-white/20"
                aria-label={playing ? t('editor.pause') : t('editor.play')}
                title={playing ? t('editor.pause') : t('editor.play')}
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span className="font-mono text-[var(--muted)]">
                {fmt(currentMs)} / {fmt(durationMs)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(1, durationMs)}
                value={currentMs}
                onChange={(e) => useEditor.getState().setCurrent(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
                aria-label={t('editor.scrubber')}
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setVideoMuted(!videoMuted)}
                  className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--panel-3)]"
                  aria-label={videoMuted ? t('editor.unmute') : t('editor.mute')}
                  title={videoMuted ? t('editor.unmuteHint') : t('editor.muteHint')}
                >
                  {videoMuted || videoVolume === 0 ? (
                    <VolumeX size={14} className="text-[var(--muted)]" />
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
                  className="h-1 w-20 cursor-pointer accent-[var(--accent)]"
                  aria-label={t('editor.volume')}
                  title={t('editor.volume')}
                />
              </div>
              <button
                onClick={handleFullscreen}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--panel-3)]"
                aria-label={isFullscreen ? t('editor.exitFullscreen') : t('editor.fullscreen')}
                title={isFullscreen ? 'Exit fullscreen (Esc)' : t('editor.fullscreen')}
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              {/* Crop tool */}
              <button
                onClick={() => setCropModalOpen(true)}
                disabled={!fileUrl}
                title={t('editor.cropShortcut')}
                aria-label={t('editor.crop')}
                className={
                  'relative flex h-7 w-7 items-center justify-center rounded-full transition ' +
                  (isCropped
                    ? 'bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]'
                    : 'bg-[var(--fill)] text-[var(--muted)] hover:bg-[var(--fill-hover)] hover:text-[var(--text)]') +
                  ' disabled:cursor-not-allowed disabled:opacity-30'
                }
              >
                <Crop size={14} />
                {isCropped && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--panel)]" />
                )}
              </button>
              {/* Capture the current frame as still image */}
              <button
                onClick={async () => {
                  const p = await saveStillNow();
                  if (p) { setShotFlash(true); window.setTimeout(() => setShotFlash(false), 1400); }
                }}
                title={t('side.captureFrameHint')}
                aria-label={t('side.captureFrame')}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--muted)] hover:bg-[var(--fill-hover)] hover:text-[var(--text)]"
              >
                {shotFlash ? <Check size={14} className="text-[var(--accent)]" /> : <Camera size={14} />}
              </button>
              {/* Quick copy frame to clipboard */}
              <button
                onClick={async () => {
                  const ok = await copyImageToClipboardNow();
                  if (ok) { setCopyFlash(true); window.setTimeout(() => setCopyFlash(false), 1400); }
                }}
                title={t('editor.copyImage')}
                aria-label={t('editor.copyImage')}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--muted)] hover:bg-[var(--fill-hover)] hover:text-[var(--text)]"
              >
                {copyFlash ? <Check size={14} className="text-[var(--accent)]" /> : <Copy size={14} />}
              </button>
              <button
                onClick={() => setTimelineCollapsed((v) => !v)}
                title={timelineCollapsed ? 'Show timeline' : 'Hide timeline'}
                aria-expanded={!timelineCollapsed}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--muted)] hover:bg-[var(--fill-hover)] hover:text-[var(--text)]"
              >
                {timelineCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>
          {!timelineCollapsed && <Timeline />}
        </div>
        <Sidebar />
      </div>
      {cropModalOpen && <CropModal onClose={() => setCropModalOpen(false)} />}
      {isDragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--accent)] bg-[var(--panel)] p-8 text-[var(--text)] shadow-2xl">
            <ImageIcon size={48} className="text-[var(--accent)] animate-bounce" />
            <span className="text-base font-semibold">{t('editor.dropImageHint')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FileMenu({
  onSave,
  onLoad,
  onOpenImage,
  onCrop
}: {
  onSave: () => void;
  onLoad: () => void;
  onOpenImage?: () => void;
  onCrop?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 text-[var(--muted)]">
      <MenuItem
        label={t('editor.file')}
        items={[
          ...(onOpenImage ? [{ label: t('editor.openImage'), onClick: onOpenImage, shortcut: 'Ctrl+I' }] : []),
          { label: t('editor.openProject'), onClick: onLoad, shortcut: 'Ctrl+O' },
          { label: t('editor.saveProject'), onClick: onSave, shortcut: 'Ctrl+S' }
        ]}
      />
      <MenuItem
        label={t('editor.edit')}
        items={[
          { label: t('editor.undo'), onClick: () => useEditor.getState().undo(), shortcut: 'Ctrl+Z' },
          { label: t('editor.redo'), onClick: () => useEditor.getState().redo(), shortcut: 'Ctrl+Shift+Z' },
          ...(onCrop ? [{ label: t('editor.crop'), onClick: onCrop, shortcut: 'C' }] : []),
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
    // Shared `name` makes these an exclusive accordion: opening one menu closes
    // the others, so the File/Edit/View dropdowns can't stack and overlap.
    <details name="editor-menu" className="relative">
      <summary className="cursor-pointer list-none select-none text-[var(--muted)] hover:text-[var(--text)]">{label}</summary>
      <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-[var(--line)] bg-[var(--panel-2)] p-1 shadow-2xl">
        {items.map((it) => (
          <button
            key={it.label}
            onClick={(e) => {
              it.onClick();
              (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
            }}
            className="flex w-full items-center justify-between gap-4 rounded px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--panel-3)]"
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="text-[10px] text-[var(--faint)]">{it.shortcut}</span>}
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
        className="group flex max-w-[360px] items-center gap-2 truncate rounded px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--text)]"
      >
        <span className="truncate">{projectDisplayName(path)}</span>
        <span className="shrink-0 text-[var(--accent)]/70">· {formatSavedAgo(lastSavedAt, t)}</span>
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
        className="w-[280px] rounded border border-[var(--accent)] bg-[var(--field)] px-2 py-0.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      {error && <span className="text-xs text-red-400" title={error}>!</span>}
    </div>
  );
}

function Divider() {
  return <span className="h-4 w-px bg-[var(--panel-3)]" />;
}

function fmt(ms: number) {
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
