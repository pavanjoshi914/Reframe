import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Repeat, X, Check, Music2, Scissors } from 'lucide-react';
import { useT } from '../i18n';

export type AudioTrimModalProps = {
  open: boolean;
  onClose: () => void;
  trackName: string;
  genre?: string;
  url: string;
  initialStartSec: number;
  initialEndSec: number | null;
  initialVolume: number;
  initialLoop: boolean;
  onApply: (params: {
    startSec: number;
    endSec: number;
    volume: number;
    loop: boolean;
    duration: number;
  }) => void;
};

const NUM_BARS = 100;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

function formatMinutesSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AudioTrimModal({
  open,
  onClose,
  trackName,
  genre,
  url,
  initialStartSec,
  initialEndSec,
  initialVolume,
  initialLoop,
  onApply
}: AudioTrimModalProps) {
  const t = useT();

  const [duration, setDuration] = useState<number>(0);
  const [startSec, setStartSec] = useState<number>(initialStartSec || 0);
  const [endSec, setEndSec] = useState<number>(initialEndSec || 0);
  const [volume, setVolume] = useState<number>(initialVolume ?? 0.4);
  const [muted, setMuted] = useState<boolean>(false);
  const [loop, setLoop] = useState<boolean>(initialLoop ?? true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(initialStartSec || 0);
  const [wavePeaks, setWavePeaks] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'scrub' | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformWrapRef = useRef<HTMLDivElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Initialize state when modal opens or url/track changes
  useEffect(() => {
    if (!open) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
      return;
    }

    setStartSec(initialStartSec || 0);
    setVolume(initialVolume ?? 0.4);
    setLoop(initialLoop ?? true);
    setIsPlaying(false);

    // Audio pre-load to determine duration
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.volume = muted ? 0 : volume;

    const onLoadedMetadata = () => {
      const dur = audio.duration || 60;
      setDuration(dur);
      const effectiveEnd = initialEndSec != null && initialEndSec > 0 && initialEndSec <= dur
        ? initialEndSec
        : dur;
      setEndSec(effectiveEnd);
      setCurrentTime(initialStartSec || 0);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    // Extract or compute waveform peaks
    let cancelled = false;
    const computePeaks = async () => {
      try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const decoded = await audioCtx.decodeAudioData(buffer);
        if (cancelled) return;

        const rawData = decoded.getChannelData(0);
        const step = Math.floor(rawData.length / NUM_BARS);
        const peaks: number[] = [];

        for (let i = 0; i < NUM_BARS; i++) {
          let max = 0;
          const start = i * step;
          const end = Math.min(start + step, rawData.length);
          for (let j = start; j < end; j += 4) {
            const val = Math.abs(rawData[j]);
            if (val > max) max = val;
          }
          peaks.push(max);
        }

        // Normalize peaks
        const maxPeak = Math.max(...peaks, 0.05);
        setWavePeaks(peaks.map(p => Math.max(0.12, Math.min(1.0, p / maxPeak))));
      } catch {
        if (cancelled) return;
        // Fallback: pleasant stylized pseudo-waveform
        const fakePeaks: number[] = [];
        for (let i = 0; i < NUM_BARS; i++) {
          const tNorm = i / NUM_BARS;
          const env = Math.sin(tNorm * Math.PI);
          const noise = 0.3 + 0.7 * Math.abs(Math.sin(i * 12.3) * Math.cos(i * 3.7));
          fakePeaks.push(Math.max(0.15, Math.min(0.95, env * noise)));
        }
        setWavePeaks(fakePeaks);
      }
    };

    void computePeaks();

    return () => {
      cancelled = true;
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [open, url, initialStartSec, initialEndSec, initialVolume, initialLoop]);

  // Sync volume with audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  // Animation frame loop for playback progress tracking
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const checkPlayback = () => {
      if (!audioRef.current) return;
      const cur = audioRef.current.currentTime;
      setCurrentTime(cur);

      if (cur >= endSec) {
        if (loop) {
          audioRef.current.currentTime = startSec;
          void audioRef.current.play();
        } else {
          audioRef.current.pause();
          audioRef.current.currentTime = startSec;
          setIsPlaying(false);
          setCurrentTime(startSec);
          return;
        }
      }

      animFrameRef.current = requestAnimationFrame(checkPlayback);
    };

    animFrameRef.current = requestAnimationFrame(checkPlayback);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, startSec, endSec, loop]);

  // Spacebar hotkey to toggle playback
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isPlaying, startSec, endSec]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Ensure audio starts within [startSec, endSec]
      if (audioRef.current.currentTime < startSec || audioRef.current.currentTime >= endSec) {
        audioRef.current.currentTime = startSec;
      }
      void audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying, startSec, endSec]);

  const seekTo = (targetSec: number) => {
    const clamped = Math.max(startSec, Math.min(endSec, targetSec));
    setCurrentTime(clamped);
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
    }
  };

  const jumpToStart = () => {
    seekTo(startSec);
  };

  const resetTrim = () => {
    setStartSec(0);
    setEndSec(duration);
    seekTo(0);
  };

  // Convert client X to seconds along the waveform track
  const getTimeFromPointer = useCallback((clientX: number): number => {
    if (!waveformWrapRef.current || duration <= 0) return 0;
    const rect = waveformWrapRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  // Pointer dragging handler for Start and End handles
  const handlePointerDown = (type: 'start' | 'end' | 'scrub', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(type);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const clickedSec = getTimeFromPointer(e.clientX);
    if (type === 'scrub') {
      seekTo(clickedSec);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || duration <= 0) return;
    const targetSec = getTimeFromPointer(e.clientX);

    if (isDragging === 'start') {
      const maxStart = Math.max(0, endSec - 0.5);
      const clamped = Math.max(0, Math.min(maxStart, targetSec));
      setStartSec(clamped);
      if (currentTime < clamped) {
        seekTo(clamped);
      }
    } else if (isDragging === 'end') {
      const minEnd = Math.min(duration, startSec + 0.5);
      const clamped = Math.max(minEnd, Math.min(duration, targetSec));
      setEndSec(clamped);
      if (currentTime > clamped) {
        seekTo(clamped);
      }
    } else if (isDragging === 'scrub') {
      seekTo(targetSec);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // pointer capture already released
      }
      setIsDragging(null);
    }
  };

  const handleApply = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    onApply({
      startSec,
      endSec: endSec > 0 ? endSec : duration,
      volume,
      loop,
      duration
    });
    onClose();
  };

  if (!open) return null;

  const totalDur = duration || 60;
  const startPct = Math.max(0, Math.min(100, (startSec / totalDur) * 100));
  const endPct = Math.max(0, Math.min(100, (endSec / totalDur) * 100));
  const currentPct = Math.max(0, Math.min(100, (currentTime / totalDur) * 100));
  const selectionDuration = Math.max(0, endSec - startSec);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          if (audioRef.current) audioRef.current.pause();
          onClose();
        }
      }}
    >
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-dim)] text-[var(--accent)]">
              <Scissors size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[var(--text)]">{trackName}</h2>
                {genre && (
                  <span className="rounded-full bg-[var(--fill)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
                    {genre}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)]">
                {t('side.dragToTrim') || 'Drag the handles to choose your starting and ending timestamps.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetTrim}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--panel-3)] hover:text-[var(--text)]"
              title={t('side.audioResetTrim')}
            >
              <RotateCcw size={12} />
              <span>{t('side.audioResetTrim')}</span>
            </button>
            <button
              onClick={() => {
                if (audioRef.current) audioRef.current.pause();
                onClose();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--panel-3)] hover:text-[var(--text)]"
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex flex-col gap-6 p-6">
          {/* Duration info pills */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[var(--muted)]">Start:</span>
              <span className="font-mono font-semibold text-[var(--text)]">{formatTime(startSec)}</span>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-[var(--accent-dim)] px-3 py-1 text-[var(--accent)] font-medium">
              <Scissors size={12} />
              <span>Selection: {formatTime(selectionDuration)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--muted)]">End:</span>
              <span className="font-mono font-semibold text-[var(--text)]">{formatTime(endSec)}</span>
            </div>
          </div>

          {/* Interactive Waveform / Scrub Bar */}
          <div
            ref={waveformWrapRef}
            className="relative h-28 w-full select-none overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-2)] cursor-pointer"
            onPointerDown={(e) => handlePointerDown('scrub', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Waveform Bars */}
            <div className="absolute inset-0 flex items-center justify-between px-2 gap-[2px] opacity-70 pointer-events-none">
              {wavePeaks.length > 0 ? (
                wavePeaks.map((peak, idx) => (
                  <div
                    key={idx}
                    className="flex-1 rounded-full bg-white/40 transition-all"
                    style={{
                      height: `${Math.max(8, peak * 85)}%`,
                      backgroundColor:
                        (idx / NUM_BARS) * 100 >= startPct && (idx / NUM_BARS) * 100 <= endPct
                          ? 'var(--accent)'
                          : 'rgba(255,255,255,0.2)'
                    }}
                  />
                ))
              ) : (
                <div className="flex w-full items-center justify-center text-xs text-[var(--muted)]">
                  Loading waveform...
                </div>
              )}
            </div>

            {/* Inactive Left Overlay (Darkened) */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-black/60 backdrop-brightness-75 pointer-events-none"
              style={{ width: `${startPct}%` }}
            />

            {/* Inactive Right Overlay (Darkened) */}
            <div
              className="absolute top-0 bottom-0 right-0 bg-black/60 backdrop-brightness-75 pointer-events-none"
              style={{ width: `${100 - endPct}%` }}
            />

            {/* Active Selection Region Highlight Border */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none border-y-2 border-[var(--accent)] bg-[var(--accent)]/10"
              style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
            />

            {/* Playhead Indicator */}
            {isPlaying && (
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_white] pointer-events-none transition-all duration-75"
                style={{ left: `${currentPct}%` }}
              >
                <div className="absolute -top-1 -left-[5px] h-3 w-3 rounded-full bg-white" />
              </div>
            )}

            {/* Start Handle (Draggable) */}
            <div
              className="absolute top-0 bottom-0 z-20 flex w-5 -translate-x-1/2 cursor-ew-resize items-center justify-center group"
              style={{ left: `${startPct}%` }}
              onPointerDown={(e) => handlePointerDown('start', e)}
            >
              <div className="h-full w-1 rounded bg-[var(--accent)] shadow-md group-hover:w-1.5 transition-all" />
              <div className="absolute -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-[var(--accent)] text-white shadow-lg">
                <span className="text-[9px] font-bold">▶</span>
              </div>
              <div className="absolute -bottom-6 rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                {formatTime(startSec)}
              </div>
            </div>

            {/* End Handle (Draggable) */}
            <div
              className="absolute top-0 bottom-0 z-20 flex w-5 -translate-x-1/2 cursor-ew-resize items-center justify-center group"
              style={{ left: `${endPct}%` }}
              onPointerDown={(e) => handlePointerDown('end', e)}
            >
              <div className="h-full w-1 rounded bg-[var(--accent)] shadow-md group-hover:w-1.5 transition-all" />
              <div className="absolute -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-[var(--accent)] text-white shadow-lg">
                <span className="text-[9px] font-bold">■</span>
              </div>
              <div className="absolute -bottom-6 rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                {formatTime(endSec)}
              </div>
            </div>
          </div>

          {/* Audition Player & Sound Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4">
            {/* Play/Pause & Scrub Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-md hover:brightness-110 active:scale-95 transition-all"
                title={isPlaying ? 'Pause (Space)' : 'Audition Selection (Space)'}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-0.5" />}
              </button>
              <button
                onClick={jumpToStart}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--panel-3)] hover:text-[var(--text)] transition-colors"
                title="Jump to Start"
              >
                <RotateCcw size={15} />
              </button>
              <div className="flex flex-col">
                <span className="font-mono text-sm font-semibold text-[var(--text)]">
                  {formatMinutesSeconds(currentTime)} / {formatMinutesSeconds(totalDur)}
                </span>
                <span className="text-[11px] text-[var(--muted)]">Auditioning trim</span>
              </div>
            </div>

            {/* Loop Toggle & Volume */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setLoop(!loop)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                  loop
                    ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                    : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                }`}
                title={t('side.loopMusic')}
              >
                <Repeat size={13} />
                <span>Loop</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMuted(!muted)}
                  className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    setVolume(parseFloat(e.target.value));
                    setMuted(false);
                  }}
                  className="h-1.5 w-20 cursor-pointer accent-[var(--accent)]"
                  title="Audition volume"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 bg-[var(--panel-2)] px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <Music2 size={14} className="text-[var(--accent)]" />
            <span>Audio will seamlessly loop within the trimmed window in your video</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (audioRef.current) audioRef.current.pause();
                onClose();
              }}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-xs font-medium text-[var(--text)] hover:bg-[var(--panel-3)] transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white shadow-md hover:brightness-110 active:scale-95 transition-all"
            >
              <Check size={14} />
              <span>{t('side.applyAudio') || 'Apply to Video'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
