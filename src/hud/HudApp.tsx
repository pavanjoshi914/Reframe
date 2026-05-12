import { useEffect, useRef, useState } from 'react';
import {
  Monitor,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Circle,
  Square,
  FileText,
  Folder,
  Minus,
  X,
  RefreshCw,
  GripVertical
} from 'lucide-react';
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

  return (
    <div className="flex h-screen w-screen items-center justify-center px-1 py-0.5">
      <div
        className="draggable flex h-12 items-center gap-1 rounded-full border border-hud-border bg-hud-bg px-2 shadow-2xl backdrop-blur-md"
        style={{ WebkitBackdropFilter: 'blur(12px)' }}
        title="Drag to move"
      >
        {/* Drag grip — visual affordance that the pill is draggable. */}
        <span className="flex h-9 w-4 items-center justify-center text-hud-icon/50">
          <GripVertical size={14} />
        </span>

        {/* Source label */}
        <button
          onClick={handlePickSource}
          disabled={phase === 'recording'}
          className="no-drag flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-hud-icon hover:bg-white/5 disabled:opacity-50"
          title="Pick source"
        >
          <Monitor size={14} />
          <span className="max-w-[120px] truncate">{sourceLabel}</span>
        </button>

        <Divider />

        {/* Audio toggles */}
        <IconBtn active={sysAudio} onClick={() => setSysAudio((v) => !v)} title="System audio">
          {sysAudio ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </IconBtn>
        <IconBtn active={mic} onClick={() => setMic((v) => !v)} title="Microphone">
          {mic ? <Mic size={16} /> : <MicOff size={16} />}
        </IconBtn>
        <IconBtn active={cam} onClick={() => setCam((v) => !v)} title="Webcam">
          {cam ? <Video size={16} /> : <VideoOff size={16} />}
        </IconBtn>

        <Divider />

        {/* Record / stop */}
        {phase === 'idle' ? (
          <button
            onClick={handleRecord}
            className="no-drag flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/5"
            title="Start recording"
          >
            <Circle size={18} fill="#ef4444" stroke="#ef4444" />
          </button>
        ) : (
          <>
            <button
              onClick={handleStop}
              className="no-drag flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/5"
              title="Stop recording"
            >
              <Square size={14} fill="#ef4444" stroke="#ef4444" />
            </button>
            <button
              onClick={handleRestart}
              className="no-drag flex h-9 w-9 items-center justify-center rounded-full text-hud-icon hover:bg-white/5"
              title="Restart recording"
            >
              <RefreshCw size={14} />
            </button>
            <span className="no-drag font-mono text-xs tabular-nums text-hud-icon">{fmt(elapsed)}</span>
          </>
        )}

        <Divider />

        <IconBtn onClick={() => {/* load project — TODO v0.5 */}} title="Open project">
          <FileText size={16} />
        </IconBtn>
        <IconBtn onClick={() => window.api.openRecordingsFolder()} title="Open recordings folder">
          <Folder size={16} />
        </IconBtn>

        <Divider />

        <IconBtn onClick={() => window.api.minimizeHud()} title="Minimize">
          <Minus size={16} />
        </IconBtn>
        <IconBtn onClick={() => window.api.closeHud()} title="Close">
          <X size={16} />
        </IconBtn>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-white/10" />;
}

function IconBtn({
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
        'no-drag flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/5 ' +
        (active ? 'text-hud-icon-active' : 'text-hud-icon')
      }
    >
      {children}
    </button>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
