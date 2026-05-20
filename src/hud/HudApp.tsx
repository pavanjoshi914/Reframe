import { useEffect, useRef, useState } from 'react';
// Material-Design filled icons (via react-icons) — chunkier, solid silhouettes
// that read as "weighted" against the dark HUD pill. Lucide's outline strokes
// felt flat in side-by-side comparison with similar tools.
import {
  MdMonitor,
  MdVolumeUp,
  MdVolumeOff,
  MdMic,
  MdMicOff,
  MdVideocam,
  MdVideocamOff,
  MdInsertDriveFile,
  MdFolderOpen,
  MdRemove,
  MdClose,
  MdRefresh,
  MdDragIndicator
} from 'react-icons/md';
import type { DesktopSource, Region } from '@shared/ipc';
import { startRecording, type RecordingHandle } from './recording';

type Phase = 'idle' | 'recording';

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function HudApp() {
  const [source, setSource] = useState<DesktopSource | null>(null);
  // Optional region for the next recording. Cleared whenever the user picks a
  // different source via the screens/windows tabs.
  const [region, setRegion] = useState<Region | null>(null);
  const [sysAudio, setSysAudio] = useState(false);
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<RecordingHandle | null>(null);
  const startTsRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  // Live webcam preview stream — opened the instant the user toggles the cam
  // icon (so the camera LED comes on immediately) and reused as the recording
  // source when they hit record. Lives in a ref because it's an imperative
  // resource we own across renders, not part of React's reactive tree.
  const camStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const offSource = window.api.onSourceSelected((s) => {
      setSource(s);
      // A plain source pick (Screens/Windows tab) implies no region crop.
      setRegion(null);
    });
    const offRegion = window.api.onRegionSelected(({ source: s, region: r }) => {
      setSource(s);
      setRegion(r);
    });
    return () => {
      offSource();
      offRegion();
    };
  }, []);

  // Global Ctrl+Shift+0 → stop recording (only fires when recording).
  useEffect(() => {
    const off = window.api.onStopShortcut(() => {
      if (recorderRef.current) handleStop();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cam toggle → open/close the webcam preview stream. Doing this here
  // (rather than at recording start) is the whole point: the camera's
  // hardware LED tracks the existence of an active media track, so opening
  // the stream when the icon is clicked is what makes the light come on
  // before the user hits record.
  useEffect(() => {
    let cancelled = false;
    if (cam && !camStreamRef.current) {
      navigator.mediaDevices
        .getUserMedia({
          video: { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 30, max: 30 } },
          audio: false
        })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          camStreamRef.current = stream;
        })
        .catch((err) => {
          console.warn('webcam preview failed', err);
          if (!cancelled) setCam(false);
        });
    } else if (!cam && camStreamRef.current && phase !== 'recording') {
      // Don't yank the stream mid-recording — the recorder is reading it.
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
    return () => {
      cancelled = true;
    };
  }, [cam, phase]);

  // Final cleanup when the HUD unmounts (window close).
  useEffect(() => {
    return () => {
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    };
  }, []);

  async function handlePickSource() {
    await window.api.openSourcePicker();
  }

  async function handleRecord() {
    if (!source) {
      await handlePickSource();
      return;
    }
    try {
      const handle = await startRecording({
        sourceId: source.id,
        withSystemAudio: sysAudio,
        withMic: mic,
        withCam: cam,
        camStream: camStreamRef.current
      });
      recorderRef.current = handle;
      startTsRef.current = Date.now();
      setPhase('recording');
      // Tell main: hide the HUD on Linux + setContentProtection elsewhere.
      window.api.setRecordingState(true);
      tickRef.current = window.setInterval(() => {
        setElapsed(Date.now() - startTsRef.current);
      }, 250);
    } catch (err) {
      console.error('record start failed', err);
      alert('Failed to start recording: ' + (err as Error).message);
    }
  }

  async function handleStop() {
    const handle = recorderRef.current;
    if (!handle) return;
    if (tickRef.current) window.clearInterval(tickRef.current);
    const result = await handle.stop();
    recorderRef.current = null;
    setPhase('idle');
    setElapsed(0);
    // Bring HUD back / drop content protection state.
    window.api.setRecordingState(false);

    const buf = await result.blob.arrayBuffer();
    const webcamBuf = result.webcamBlob ? await result.webcamBlob.arrayBuffer() : undefined;
    const meta = await window.api.saveRecording(buf, {
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
      startedAt: result.startedAt,
      webcamData: webcamBuf,
      region: region ?? undefined
    });
    await window.api.openEditor(meta);
  }

  async function handleRestart() {
    if (phase !== 'recording') return;
    await handleStop();
    setTimeout(() => handleRecord(), 200);
  }

  const sourceLabel = region
    ? 'Area'
    : source
    ? truncate(source.name, 18)
    : 'Screen';

  const recording = phase === 'recording';

  return (
    <div className="flex h-screen w-screen items-center justify-center px-1 py-0.5">
      <div
        className="draggable relative flex h-12 items-center gap-0.5 rounded-full px-2"
        title="Drag to move"
        style={{
          background:
            'linear-gradient(180deg, rgba(32,34,40,0.94) 0%, rgba(20,22,26,0.94) 60%, rgba(14,15,18,0.94) 100%)',
          boxShadow:
            'inset 0 1px 0 0 rgba(255,255,255,0.08), 0 1px 0 0 rgba(0,0,0,0.6), 0 12px 28px -8px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
          WebkitBackdropFilter: 'blur(14px)',
          backdropFilter: 'blur(14px)'
        }}
      >
        {/* Subtle glossy highlight at the very top of the pill */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-3 top-0 h-1/2 rounded-t-full opacity-40"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0))' }}
        />

        {/* Drag grip */}
        <span className="relative mr-1 flex h-9 w-4 items-center justify-center text-hud-icon/40">
          <MdDragIndicator size={16} />
        </span>

        {/* Source chip */}
        <button
          onClick={handlePickSource}
          disabled={recording}
          className="no-drag relative flex h-8 items-center gap-1.5 rounded-full bg-white/[0.04] px-3 text-xs font-medium text-hud-icon ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:ring-white/15 disabled:opacity-50"
          title="Pick source"
        >
          <MdMonitor size={14} className="text-hud-icon/80" />
          <span className="max-w-[120px] truncate">{sourceLabel}</span>
        </button>

        <Divider />

        {/* Capture toggles */}
        <ToggleBtn active={sysAudio} onClick={() => setSysAudio((v) => !v)} title="System audio">
          {sysAudio ? <MdVolumeUp size={18} /> : <MdVolumeOff size={18} />}
        </ToggleBtn>
        <ToggleBtn active={mic} onClick={() => setMic((v) => !v)} title="Microphone">
          {mic ? <MdMic size={18} /> : <MdMicOff size={18} />}
        </ToggleBtn>
        <ToggleBtn active={cam} onClick={() => setCam((v) => !v)} title="Webcam">
          {cam ? <MdVideocam size={18} /> : <MdVideocamOff size={18} />}
        </ToggleBtn>

        <Divider />

        {/* Record / stop */}
        {!recording ? (
          <RecordButton onClick={handleRecord} />
        ) : (
          <>
            <StopButton onClick={handleStop} />
            <IconBtn onClick={handleRestart} title="Restart recording">
              <MdRefresh size={16} />
            </IconBtn>
            <RecordingTimer ms={elapsed} />
          </>
        )}

        <Divider />

        <IconBtn onClick={() => window.api.openProjectFromPicker()} title="Open project">
          <MdInsertDriveFile size={18} />
        </IconBtn>
        <IconBtn onClick={() => window.api.openExportsFolder()} title="Open Recordings folder (exports)">
          <MdFolderOpen size={18} />
        </IconBtn>

        <Divider />

        <IconBtn onClick={() => window.api.minimizeHud()} title="Minimize">
          <MdRemove size={18} />
        </IconBtn>
        <IconBtn onClick={() => window.api.closeHud()} title="Close">
          <MdClose size={18} />
        </IconBtn>
      </div>
    </div>
  );
}

function RecordButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Start recording"
      className="no-drag group flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/10 transition hover:scale-105 hover:bg-white/[0.07] hover:ring-red-400/30 active:scale-95"
    >
      <span className="block h-3.5 w-3.5 rounded-full bg-[#ef4444] shadow-[0_0_8px_2px_rgba(239,68,68,0.45)] transition group-hover:shadow-[0_0_14px_3px_rgba(239,68,68,0.65)]" />
    </button>
  );
}

function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Stop recording"
      className="no-drag relative flex h-9 w-9 items-center justify-center rounded-full bg-red-500/[0.18] ring-1 ring-red-400/40 transition hover:scale-105 hover:bg-red-500/25 active:scale-95"
    >
      {/* Outer pulsing halo */}
      <span aria-hidden className="absolute inset-0 animate-pulse rounded-full ring-2 ring-red-400/30" />
      <span className="block h-3 w-3 rounded-[3px] bg-[#ef4444] shadow-[0_0_8px_2px_rgba(239,68,68,0.45)]" />
    </button>
  );
}

function RecordingTimer({ ms }: { ms: number }) {
  return (
    <span
      className="no-drag flex h-8 items-center gap-1.5 rounded-full bg-red-500/[0.14] px-2.5 text-xs font-medium tabular-nums text-red-200 ring-1 ring-red-400/25"
    >
      <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
      <span className="font-mono">{fmt(ms)}</span>
    </span>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      className="mx-0.5 h-4 w-px"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.14) 50%, rgba(255,255,255,0.02))'
      }}
    />
  );
}

// Plain icon button: no active state, just a hover wash.
function IconBtn({
  children,
  onClick,
  title
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="no-drag flex h-9 w-9 items-center justify-center rounded-full text-hud-icon transition hover:bg-white/[0.06]"
    >
      {children}
    </button>
  );
}

// Toggle button: shows a chip (emerald-tinted) when active, plain icon when not.
function ToggleBtn({
  children,
  onClick,
  active,
  title
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={
        'no-drag flex h-9 w-9 items-center justify-center rounded-full transition ' +
        (active
          ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 shadow-[inset_0_0_0_1px_rgba(110,231,183,0.10)]'
          : 'text-hud-icon hover:bg-white/[0.06]')
      }
    >
      {children}
    </button>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
