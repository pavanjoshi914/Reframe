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
  MdDragIndicator,
  MdKeyboardArrowUp,
  MdCheck
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
  // Device selection — `undefined` means "system default". Persisted to
  // localStorage so the user doesn't have to re-pick each session. The values
  // are deviceIds reported by `navigator.mediaDevices.enumerateDevices()`.
  const [selectedMicId, setSelectedMicId] = useState<string | undefined>(
    () => localStorage.getItem('reframe.micId') || undefined
  );
  const [selectedCamId, setSelectedCamId] = useState<string | undefined>(
    () => localStorage.getItem('reframe.camId') || undefined
  );
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  // Which device menu is currently open (or null). Lifted to HudApp so only
  // one can be open at a time AND so we can grow the HUD window upward when
  // a menu opens (the popover doesn't fit in the 56px-tall pill).
  const [openMenu, setOpenMenu] = useState<'mic' | 'cam' | null>(null);
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

  // Enumerate audio/video input devices so the user can pick which mic/cam to
  // record from. Labels are only populated once getUserMedia has been granted
  // once for that device kind, so the lists may show empty labels on first
  // launch — re-enumerated on `devicechange`, which also fires after a
  // permission grant.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const audio = devices.filter((d) => d.kind === 'audioinput');
        const video = devices.filter((d) => d.kind === 'videoinput');
        setAudioInputs(audio);
        setVideoInputs(video);
        // If a previously-selected device has been unplugged, drop the saved
        // selection so `getUserMedia` doesn't fail on a stale deviceId. The
        // UI shows "System default" again until the user picks something.
        setSelectedMicId((current) =>
          current && !audio.some((d) => d.deviceId === current) ? undefined : current
        );
        setSelectedCamId((current) =>
          current && !video.some((d) => d.deviceId === current) ? undefined : current
        );
      } catch (err) {
        console.warn('enumerateDevices failed', err);
      }
    }
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, []);

  // Persist device choices.
  useEffect(() => {
    if (selectedMicId) localStorage.setItem('reframe.micId', selectedMicId);
    else localStorage.removeItem('reframe.micId');
  }, [selectedMicId]);
  useEffect(() => {
    if (selectedCamId) localStorage.setItem('reframe.camId', selectedCamId);
    else localStorage.removeItem('reframe.camId');
  }, [selectedCamId]);

  // Grow/shrink the HUD window so device menus have headroom to open upward
  // without the window having to permanently take up that space (which would
  // block desktop clicks behind it).
  useEffect(() => {
    window.api.setHudExpanded(openMenu !== null);
  }, [openMenu]);

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
  // before the user hits record. Also re-opens the stream when the user
  // picks a different camera from the device menu.
  useEffect(() => {
    let cancelled = false;

    function closeCurrent() {
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }

    if (cam) {
      // If we already have a stream and it's from the desired device, leave it.
      const current = camStreamRef.current;
      const currentId = current?.getVideoTracks()[0]?.getSettings().deviceId;
      const desiredId = selectedCamId || undefined;
      if (current && currentId === desiredId) return;

      // Different device (or first open) — close any existing then open new.
      // Don't yank the stream mid-recording even if the device changed; we'd
      // tear the recorder's data source out from under it.
      if (current && phase === 'recording') return;
      closeCurrent();

      navigator.mediaDevices
        .getUserMedia({
          video: {
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 30, max: 30 },
            ...(selectedCamId ? { deviceId: { exact: selectedCamId } } : {})
          },
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
    } else if (camStreamRef.current && phase !== 'recording') {
      closeCurrent();
    }
    return () => {
      cancelled = true;
    };
  }, [cam, phase, selectedCamId]);

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
        micDeviceId: selectedMicId,
        camDeviceId: selectedCamId,
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
    // Outer wrap is `items-end` so the pill sits at the bottom of the window.
    // The HUD window grows upward on demand (when a device menu opens) so the
    // popover has room without the window having to permanently block desktop
    // clicks behind it — see `window.api.setHudExpanded`.
    <div className="flex h-screen w-screen items-end justify-center px-1 pb-0.5">
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

        {/* Capture toggles. System audio is a single toggle (no per-device
            choice — desktopCapturer takes the system default). Mic and Cam get
            a split-button with a chevron that opens a device picker. */}
        <ToggleBtn active={sysAudio} onClick={() => setSysAudio((v) => !v)} title="System audio">
          {sysAudio ? <MdVolumeUp size={18} /> : <MdVolumeOff size={18} />}
        </ToggleBtn>
        <ToggleWithMenu
          active={mic}
          onToggle={() => setMic((v) => !v)}
          title="Microphone"
          icon={<MdMic size={18} />}
          iconOff={<MdMicOff size={18} />}
          devices={audioInputs}
          selectedId={selectedMicId}
          onSelectDevice={setSelectedMicId}
          menuLabel="Microphone"
          fallbackDeviceLabel="Microphone"
          menuOpen={openMenu === 'mic'}
          onMenuOpenChange={(o) => setOpenMenu(o ? 'mic' : null)}
        />
        <ToggleWithMenu
          active={cam}
          onToggle={() => setCam((v) => !v)}
          title="Webcam"
          icon={<MdVideocam size={18} />}
          iconOff={<MdVideocamOff size={18} />}
          devices={videoInputs}
          selectedId={selectedCamId}
          onSelectDevice={setSelectedCamId}
          menuLabel="Camera"
          fallbackDeviceLabel="Camera"
          menuOpen={openMenu === 'cam'}
          onMenuOpenChange={(o) => setOpenMenu(o ? 'cam' : null)}
        />

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

// Toggle + dropdown: the icon toggles capture on/off, the small chevron next
// to it opens a popover device picker. Used for mic and cam — system audio
// doesn't get one because desktopCapturer takes the system default.
function ToggleWithMenu({
  active,
  onToggle,
  title,
  icon,
  iconOff,
  devices,
  selectedId,
  onSelectDevice,
  menuLabel,
  fallbackDeviceLabel,
  menuOpen,
  onMenuOpenChange
}: {
  active: boolean;
  onToggle: () => void;
  title: string;
  icon: React.ReactNode;
  iconOff: React.ReactNode;
  devices: MediaDeviceInfo[];
  selectedId: string | undefined;
  onSelectDevice: (id: string | undefined) => void;
  menuLabel: string;
  fallbackDeviceLabel: string;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const open = menuOpen;
  const setOpen = onMenuOpenChange;
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, setOpen]);

  // Visually treat both halves as one chip — same active styling, just split
  // into a square left half (toggle) and a thin right half (chevron). When
  // either the toggle is on OR the menu is open, the chip shows the active
  // emerald tint.
  const activeChip = active || open;
  const chipBase = activeChip
    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 shadow-[inset_0_0_0_1px_rgba(110,231,183,0.10)]'
    : 'text-hud-icon hover:bg-white/[0.06]';

  return (
    <div ref={wrapRef} className="no-drag relative flex h-9 items-center">
      <button
        title={title}
        onClick={onToggle}
        className={'flex h-9 w-9 items-center justify-center rounded-l-full transition ' + chipBase}
      >
        {active ? icon : iconOff}
      </button>
      <button
        title={`${menuLabel} device`}
        onClick={() => setOpen(!open)}
        className={
          'flex h-9 w-4 items-center justify-center rounded-r-full border-l border-black/20 transition ' +
          chipBase
        }
      >
        <MdKeyboardArrowUp size={12} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <DeviceMenu
          label={menuLabel}
          devices={devices}
          selectedId={selectedId}
          fallbackLabel={fallbackDeviceLabel}
          onSelect={(id) => {
            onSelectDevice(id);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DeviceMenu({
  label,
  devices,
  selectedId,
  fallbackLabel,
  onSelect
}: {
  label: string;
  devices: MediaDeviceInfo[];
  selectedId: string | undefined;
  fallbackLabel: string;
  onSelect: (id: string | undefined) => void;
}) {
  return (
    <div
      className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 overflow-hidden rounded-lg border border-white/10 bg-[#15171c] shadow-2xl shadow-black/60 ring-1 ring-black/40"
      style={{ backdropFilter: 'blur(12px)' }}
    >
      <div className="border-b border-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        <DeviceMenuItem
          label="System default"
          active={!selectedId}
          onClick={() => onSelect(undefined)}
        />
        {devices.length === 0 && (
          <div className="px-3 py-2 text-xs text-white/40">No devices detected</div>
        )}
        {devices.map((d, i) => (
          <DeviceMenuItem
            key={d.deviceId || `i-${i}`}
            label={d.label || `${fallbackLabel} ${i + 1}`}
            active={selectedId === d.deviceId}
            onClick={() => onSelect(d.deviceId || undefined)}
          />
        ))}
      </div>
    </div>
  );
}

function DeviceMenuItem({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition ' +
        (active ? 'bg-emerald-500/10 text-emerald-200' : 'text-white/80 hover:bg-white/5')
      }
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {active && <MdCheck size={14} className="text-emerald-400" />}
      </span>
      <span className="truncate">{label}</span>
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
