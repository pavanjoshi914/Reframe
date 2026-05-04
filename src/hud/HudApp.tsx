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
import type { DesktopSource } from '@shared/ipc';
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
  const [sysAudio, setSysAudio] = useState(false);
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<RecordingHandle | null>(null);
  const startTsRef = useRef(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    const off = window.api.onSourceSelected((s) => setSource(s));
    return off;
  }, []);

  // Global Ctrl+Shift+0 → stop recording (only fires when recording).
  useEffect(() => {
    const off = window.api.onStopShortcut(() => {
      if (recorderRef.current) handleStop();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        withCam: cam
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
      webcamData: webcamBuf
    });
    await window.api.openEditor(meta);
  }

  async function handleRestart() {
    if (phase !== 'recording') return;
    await handleStop();
    setTimeout(() => handleRecord(), 200);
  }

  const sourceLabel = source ? truncate(source.name, 18) : 'Screen';

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
