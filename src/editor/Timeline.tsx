import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, Minus, ZoomIn, Scissors, MessageSquare, Gauge, Trash2, Maximize2, Sparkles, Search, Flashlight, EyeOff, type LucideIcon, Rotate3d, Film, Heading, Subtitles } from 'lucide-react';
import { useEditor, type LaneItem, type LaneKind, type CaptionCue } from './store';
import { isTextEntry } from './textEntry';
import { useT } from '../i18n';

const LANES: { kind: LaneKind; label: string; key: string; icon: LucideIcon; color: string; chip: string }[] = [
  { kind: 'titleCard', label: 'Scene Text', key: 'X', icon: Heading, color: 'border-indigo-400', chip: 'bg-indigo-500/30' },
  { kind: 'scene', label: 'Animations', key: 'D', icon: Film, color: 'border-teal-400', chip: 'bg-teal-500/30' },
  { kind: 'zoom', label: 'Zoom', key: 'Z', icon: ZoomIn, color: 'border-[var(--accent)]', chip: 'bg-[var(--accent)]/30' },
  { kind: 'trim', label: 'Trim', key: 'T', icon: Scissors, color: 'border-rose-400', chip: 'bg-rose-500/30' },
  { kind: 'annotation', label: 'Annotation', key: 'A', icon: MessageSquare, color: 'border-amber-400', chip: 'bg-amber-500/30' },
  { kind: 'speed', label: 'Speed', key: 'S', icon: Gauge, color: 'border-sky-400', chip: 'bg-sky-500/30' },
  { kind: 'magnify', label: 'Magnify', key: 'M', icon: Search, color: 'border-fuchsia-400', chip: 'bg-fuchsia-500/30' },
  { kind: 'spotlight', label: 'Spotlight', key: 'L', icon: Flashlight, color: 'border-violet-400', chip: 'bg-violet-500/30' },
  { kind: 'blur', label: 'Blur', key: 'B', icon: EyeOff, color: 'border-slate-300', chip: 'bg-slate-400/30' },
  { kind: 'rotation', label: 'Rotation', key: 'R', icon: Rotate3d, color: 'border-orange-400', chip: 'bg-orange-500/30' }
];

const LANE_LABEL_W = 136;
// Right-side breathing room past the last tick. The playhead line sits at
// trackWidth exactly when currentMs === durationMs, and its diamond marker
// extends ~5px on each side; this margin keeps both fully visible without
// triggering a horizontal scrollbar in fit mode.
const TRACK_END_PAD = 12;
const PPS_MIN = 10;
const PPS_MAX = 800;
const PPS_STEP = 1.25; // multiplicative step for +/- buttons

// Log-scale mapping so the slider feels even across the 80× range. The store
// clamps to [10, 800]; we mirror that here.
function ppsToSlider(pps: number) {
  const t = (Math.log(pps) - Math.log(PPS_MIN)) / (Math.log(PPS_MAX) - Math.log(PPS_MIN));
  return Math.max(0, Math.min(1, t));
}
function sliderToPps(t: number) {
  return Math.exp(Math.log(PPS_MIN) + t * (Math.log(PPS_MAX) - Math.log(PPS_MIN)));
}

function formatTime(ms: number) {
  const total = Math.max(0, ms / 1000);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Tick labels include one decimal once the step drops below a second so
// adjacent ticks (e.g. 0.5s and 1.0s) don't both render as "0:00".
function formatTickLabel(sec: number, step: number) {
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  if (step >= 1) {
    return `${m}:${String(Math.round(s)).padStart(2, '0')}`;
  }
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function Timeline() {
  const t = useT();
  const durationMs = useEditor((s) => s.durationMs);
  const currentMs = useEditor((s) => s.currentMs);
  const setCurrent = useEditor((s) => s.setCurrent);
  const items = useEditor((s) => s.items);
  const addItem = useEditor((s) => s.addItem);
  const removeItem = useEditor((s) => s.removeItem);
  const selectItem = useEditor((s) => s.selectItem);
  const selectedItemId = useEditor((s) => s.selectedItemId);
  const pixelsPerSecond = useEditor((s) => s.pixelsPerSecond);
  const setPixelsPerSecond = useEditor((s) => s.setPixelsPerSecond);
  const cursorSamples = useEditor((s) => s.cursorSamples);
  const cursorClicks = useEditor((s) => s.cursorClicks);
  // Captions
  const captionCues = useEditor((s) => s.captionCues);
  const selectedCaptionId = useEditor((s) => s.selectedCaptionId);
  const addCaptionCue = useEditor((s) => s.addCaptionCue);
  // Auto-zoom now uses clicks as well as movement, so enable the button when
  // either was captured.
  const hasActivity = cursorSamples.length > 0 || cursorClicks.length > 0;
  const suggestZooms = useEditor((s) => s.suggestZooms);

  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fit-to-width is the default. Once the user manually zooms (Ctrl+scroll or
  // pinch), we leave their pps alone until they hit the Fit button. Long
  // videos may bottom out at the 10px/sec clamp in the store and overflow —
  // that's the standard NLE behavior.
  const [fitToWidth, setFitToWidth] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keyboard shortcuts: Z/T/A/S add items, C adds caption, Delete removes selected
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Stand down only for real TEXT entry. A range slider is an <input> too,
      // and the scrubber keeps focus after a drag — testing for the tag alone
      // killed every shortcut until you clicked away.
      if (isTextEntry(e.target) || useEditor.getState().editingAnnotationId) return;
      // Let modifier combos through (Ctrl+Z undo, Ctrl+S save, …) — only bare
      // letter keys add lane items.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const map: Record<string, LaneKind> = { z: 'zoom', t: 'trim', a: 'annotation', s: 'speed', m: 'magnify', l: 'spotlight', b: 'blur', r: 'rotation', d: 'scene', x: 'titleCard', h: 'titleCard' };
      const k = e.key.toLowerCase();
      // Shift+L / Shift+M apply a cursor-tracked spotlight/magnify to the WHOLE
      // video (bare L / M still drop a region on part of it).
      if (e.shiftKey && (k === 'l' || k === 'm')) {
        e.preventDefault();
        useEditor.getState().addWholeVideoEffect(k === 'l' ? 'spotlight' : 'magnify');
        return;
      }
      if (k === 'c') {
        e.preventDefault();
        useEditor.getState().addCaptionCue({ startMs: currentMs });
        return;
      }
      if (map[k]) {
        e.preventDefault();
        addItem(map[k], currentMs);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedItemId) {
          e.preventDefault();
          removeItem(selectedItemId);
        } else if (useEditor.getState().selectedCaptionId) {
          e.preventDefault();
          useEditor.getState().deleteCaptionCue(useEditor.getState().selectedCaptionId!);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentMs, addItem, selectedItemId, removeItem]);

  // Use the exact fractional duration so the track width matches the recording
  // and the ruler doesn't overrun. Math.ceil here previously rounded a 10.3s
  // recording up to 11s, producing a phantom 0:11 tick + empty trailing space.
  const totalSec = Math.max(1, durationMs / 1000);

  // When in fit mode, recompute pps to fill the available track area whenever
  // the container resizes or the duration changes.
  //
  // The threshold is on the resulting WIDTH, not on pps. Guarding pps instead
  // let an error of up to 0.5 px/sec stand, and the rendered track is
  // pps * duration — so on an 18s clip that was a track ~17px wider than its
  // container. Which is enough to raise a horizontal scrollbar, and the
  // scrollbar is ~10px tall, and the preview above it is aspect-ratio locked,
  // so it lost 10px of height and ~18px of width, which resized this container,
  // which changed the fit... a feedback loop that flipped the whole layout back
  // and forth every frame during playback. Comparing the quantity that actually
  // has to fit keeps the track inside its container and the loop cannot start.
  useEffect(() => {
    if (!fitToWidth) return;
    if (containerWidth <= 0 || totalSec <= 0) return;
    const trackArea = Math.max(0, containerWidth - LANE_LABEL_W - TRACK_END_PAD);
    if (trackArea <= 0) return;
    if (Math.abs(totalSec * pixelsPerSecond - trackArea) > 0.5) {
      setPixelsPerSecond(trackArea / totalSec);
    }
  }, [fitToWidth, containerWidth, totalSec, pixelsPerSecond, setPixelsPerSecond]);

  const trackWidth = totalSec * pixelsPerSecond;

  // Pick a tick step targeting ~70-100px between labels — same idea as a
  // standard NLE ruler. Drops below 1s once the zoom is high enough that
  // half-second ticks have room to breathe.
  const tickStep = useMemo(() => {
    if (pixelsPerSecond < 30) return 5;
    if (pixelsPerSecond < 80) return 1;
    if (pixelsPerSecond < 200) return 0.5;
    if (pixelsPerSecond < 400) return 0.25;
    return 0.1;
  }, [pixelsPerSecond]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    // Iterate in integer multiples of step to avoid float drift (e.g. 0.1
    // accumulating to 0.30000000000000004 across many additions).
    const count = Math.floor(totalSec / tickStep + 0.001);
    for (let i = 0; i <= count; i++) out.push(i * tickStep);
    return out;
  }, [totalSec, tickStep]);

  function msFromClientX(clientX: number) {
    const track = trackRef.current;
    if (!track) return 0;
    const r = track.getBoundingClientRect();
    const ratio = (clientX - r.left) / r.width;
    const rawMs = Math.max(0, Math.min(durationMs, ratio * durationMs));
    if (clientX - r.left < 20 || rawMs < 80) return 0;
    return rawMs;
  }

  // Smooth scrubbing — pointer-down/move/up across the ruler or any empty
  // lane area. Captures the pointer so the playhead tracks the cursor even
  // when it leaves the original element. Trim regions are skipped by the
  // store's setCurrent (see store.ts) — dropping a scrub inside a cut snaps
  // the playhead to whichever edge of the cut is closer.
  const scrubbingRef = useRef(false);
  function onScrubDown(e: React.PointerEvent) {
    e.preventDefault();
    scrubbingRef.current = true;
    selectItem(null);
    setCurrent(msFromClientX(e.clientX));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onScrubMove(e: React.PointerEvent) {
    if (!scrubbingRef.current) return;
    setCurrent(msFromClientX(e.clientX));
  }
  function onScrubUp(e: React.PointerEvent) {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function applyManualZoom(nextPps: number) {
    if (fitToWidth) setFitToWidth(false);
    setPixelsPerSecond(nextPps);
  }
  function handleWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return; // let normal scroll pan
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    applyManualZoom(pixelsPerSecond * factor);
  }

  const playheadPx = (currentMs / 1000) * pixelsPerSecond;

  // A lane only earns a row once it holds something. Nine always-on lanes cost
  // ~430px of mostly-empty "Press T to add trim" rows, which on a 1080p laptop
  // squeezes the video preview down to a thumbnail. Empty lanes collapse into
  // one compact add-strip instead, so the timeline is only as tall as the work
  // actually in it and the preview keeps the rest.
  const laneRows = LANES.map((lane) => ({ lane, laneItems: items.filter((it) => it.kind === lane.kind) }));
  const activeRows = laneRows.filter((r) => r.laneItems.length > 0);
  const emptyLanes = laneRows.filter((r) => r.laneItems.length === 0).map((r) => r.lane);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-[var(--strip-bg)] backdrop-blur-md px-3.5 py-2 text-xs text-[var(--muted)]">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-medium text-[var(--text)] px-2.5 py-0.5 rounded-lg bg-[var(--fill)] border border-[var(--stroke)]">
            {formatTime(currentMs)} / {formatTime(durationMs)}
          </span>
          <AspectSelector />
          <span className="text-[11px] text-[var(--faint)]">{t('tl.addHint')}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            onClick={() => applyManualZoom(pixelsPerSecond / PPS_STEP)}
            disabled={pixelsPerSecond <= PPS_MIN + 0.01}
            className="flex h-6 w-6 items-center justify-center rounded-lg border border-[var(--btn-squircle-border)] bg-[var(--btn-squircle)] text-[var(--muted)] hover:bg-[var(--btn-squircle-hover)] hover:text-[var(--text)] disabled:opacity-30 transition"
            title={t('tl.zoomOut')}
            aria-label={t('tl.zoomOut')}
          >
            <Minus size={12} />
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(ppsToSlider(pixelsPerSecond) * 1000)}
            onChange={(e) => applyManualZoom(sliderToPps(Number(e.target.value) / 1000))}
            className="h-1.5 w-28 cursor-pointer accent-[#0A84FF]"
            aria-label={t('tl.timelineZoom')}
            title={t('tl.timelineZoom')}
          />
          <button
            onClick={() => applyManualZoom(pixelsPerSecond * PPS_STEP)}
            disabled={pixelsPerSecond >= PPS_MAX - 0.01}
            className="flex h-6 w-6 items-center justify-center rounded-lg border border-[var(--btn-squircle-border)] bg-[var(--btn-squircle)] text-[var(--muted)] hover:bg-[var(--btn-squircle-hover)] hover:text-[var(--text)] disabled:opacity-30 transition"
            title={t('tl.zoomIn')}
            aria-label={t('tl.zoomIn')}
          >
            <Plus size={12} />
          </button>
          <button
            onClick={() => setFitToWidth(true)}
            disabled={fitToWidth}
            className={
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ' +
              (fitToWidth
                ? 'border-[#0A84FF]/40 bg-[#0A84FF]/20 text-[#0A84FF]'
                : 'border-[var(--btn-squircle-border)] bg-[var(--btn-squircle)] text-[var(--muted)] hover:bg-[var(--btn-squircle-hover)] hover:text-[var(--text)]')
            }
            title={t('tl.fitWidth')}
          >
            <Maximize2 size={12} />
            {t('tl.fit')}
          </button>
          <span className="text-[var(--faint)] opacity-40">|</span>
          <span className="text-[var(--faint)]">{t('tl.zoomHint')}</span>
        </div>
      </div>

      <SelectedItemInspector />

      {/* Vertical cap as well as horizontal: even a project that genuinely uses
          every lane can now only take 42vh before the lanes scroll, so the
          preview always keeps the majority of the window. The ruler is sticky
          so it stays put while the lanes scroll under it. */}
      <div ref={scrollRef} className="min-w-0 max-h-[42vh] overflow-auto" onWheel={handleWheel}>
        <div style={{ width: LANE_LABEL_W + trackWidth + TRACK_END_PAD }}>
          {/* time ruler */}
          <div className="sticky top-0 z-30 h-6 border-b border-white/5 bg-[var(--bg)]" style={{ paddingLeft: LANE_LABEL_W }}>
            <div
              ref={trackRef}
              // overflow-hidden matters for layout, not looks: each tick is an
              // absolutely-positioned label, so the LAST one hangs ~17px past
              // the end of the track. Left visible, that overflow reaches the
              // scroll container, which raises a horizontal scrollbar, which is
              // ~10px tall, which shortens the aspect-ratio-locked preview above
              // it, which resizes this container — and the whole layout flips
              // back and forth every frame while the video plays.
              className="relative h-full cursor-pointer touch-none select-none overflow-hidden"
              onPointerDown={onScrubDown}
              onPointerMove={onScrubMove}
              onPointerUp={onScrubUp}
              onPointerCancel={onScrubUp}
              style={{ width: trackWidth }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full border-l border-[var(--line)]"
                  style={{ left: t * pixelsPerSecond }}
                >
                  <span className="ml-1 text-[10px] text-[var(--faint)]">{formatTickLabel(t, tickStep)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* lanes */}
          <div className="relative">
            {/* captions lane */}
            <div className="flex h-11 items-stretch border-b border-white/5 bg-sky-950/[0.12]">
              <div
                className="sticky left-0 z-20 flex shrink-0 items-center justify-between border-r border-white/5 bg-[var(--bg)] px-2 text-[11px] text-[var(--muted)]"
                style={{ width: LANE_LABEL_W }}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-sky-400 font-medium" title="Captions">
                  <Subtitles size={12} className="shrink-0 text-sky-400" />
                  <span className="truncate">Captions</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => addCaptionCue({ startMs: currentMs })}
                    className="group flex h-5 items-center gap-1 rounded bg-[var(--panel-2)] px-1.5 text-sky-300 transition hover:bg-sky-500/20 hover:text-white"
                    title="Add Caption at Playhead (C)"
                    aria-label="Add Caption at Playhead (C)"
                  >
                    <Plus size={10} />
                    <kbd className="rounded bg-white/10 px-1 py-0.5 font-mono text-[9px] font-semibold leading-none text-sky-300 group-hover:text-white">
                      C
                    </kbd>
                  </button>
                </span>
              </div>
              <div
                className="relative cursor-pointer touch-none select-none"
                style={{ width: trackWidth }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) onScrubDown(e);
                }}
                onPointerMove={onScrubMove}
                onPointerUp={onScrubUp}
                onPointerCancel={onScrubUp}
              >
                {captionCues.length === 0 && (
                  <div className="pointer-events-none flex h-full items-center justify-center text-[10px] text-sky-400/30">
                    Press C to add caption or generate in Captions tab
                  </div>
                )}
                {captionCues.map((cue) => (
                  <CaptionChip
                    key={cue.id}
                    cue={cue}
                    pixelsPerSecond={pixelsPerSecond}
                    durationMs={durationMs}
                    selected={selectedCaptionId === cue.id}
                  />
                ))}
              </div>
            </div>

            {activeRows.map(({ lane, laneItems }) => {
              return (
                <div key={lane.kind} className="flex h-12 items-stretch border-b border-white/5">
                  <div
                    className="sticky left-0 z-20 flex shrink-0 items-center justify-between border-r border-white/5 bg-[var(--bg)] px-2 text-[11px] text-[var(--muted)]"
                    style={{ width: LANE_LABEL_W }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate" title={t('tl.' + lane.kind)}>
                      <lane.icon size={12} className="shrink-0 text-[var(--muted)]" />
                      <span className="truncate">{t('tl.' + lane.kind)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {lane.kind === 'zoom' && (
                        <button
                          data-testid="suggest-zooms"
                          onClick={() => suggestZooms()}
                          disabled={!hasActivity}
                          className="flex h-5 w-5 items-center justify-center rounded bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent-dim)] disabled:opacity-30"
                          title={hasActivity ? t('tl.suggestZooms') : t('tl.noCursorData')}
                          aria-label={t('tl.suggestZooms')}
                        >
                          <Sparkles size={10} />
                        </button>
                      )}
                      <button
                        onClick={() => addItem(lane.kind, currentMs)}
                        className="group flex h-5 items-center gap-1 rounded bg-[var(--panel-2)] px-1.5 text-[var(--muted)] transition hover:bg-white/15 hover:text-[var(--text)]"
                        title={`${t('tl.add', { label: t('tl.' + lane.kind) })} (${lane.key})`}
                        aria-label={`${t('tl.add', { label: t('tl.' + lane.kind) })} (${lane.key})`}
                      >
                        <Plus size={10} />
                        <kbd className="rounded bg-white/10 px-1 py-0.5 font-mono text-[9px] font-semibold leading-none text-[var(--muted)] group-hover:text-[var(--text)]">
                          {lane.key}
                        </kbd>
                      </button>
                    </span>
                  </div>
                  <div
                    className="relative cursor-pointer touch-none select-none"
                    style={{ width: trackWidth }}
                    onPointerDown={(e) => {
                      // Only start a scrub on empty-lane area, never on chips.
                      if (e.target === e.currentTarget) onScrubDown(e);
                    }}
                    onPointerMove={onScrubMove}
                    onPointerUp={onScrubUp}
                    onPointerCancel={onScrubUp}
                  >
                    {laneItems.length === 0 && (
                      <div className="pointer-events-none flex h-full items-center justify-center text-[11px] text-white/25">
                        {t('tl.pressToAdd', { key: lane.key, label: t('tl.' + lane.kind).toLowerCase() })}
                      </div>
                    )}
                    {laneItems.map((it) => (
                      <ItemChip
                        key={it.id}
                        item={it}
                        pixelsPerSecond={pixelsPerSecond}
                        durationMs={durationMs}
                        chipBg={lane.chip}
                        borderColor={lane.color}
                        selected={selectedItemId === it.id}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* playhead spans all lanes */}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-[var(--accent)] shadow-[0_0_8px_rgba(74,222,128,0.6)]"
              style={{ left: LANE_LABEL_W + playheadPx }}
            >
              <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-[var(--accent)]" />
            </div>
          </div>
        </div>
      </div>

      {emptyLanes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--card-border)] bg-[var(--strip-bg)] px-3 py-2">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('tl.addLane')}</span>
          {emptyLanes.map((lane) => (
            <span key={lane.kind} className="flex items-center">
              <button
                onClick={() => addItem(lane.kind, currentMs)}
                className="group flex items-center gap-1.5 rounded-xl border border-[var(--btn-squircle-border)] bg-[var(--btn-squircle)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--btn-squircle-hover)] transition shadow-sm"
                title={`${t('tl.add', { label: t('tl.' + lane.kind) })} (${lane.key})`}
              >
                <lane.icon size={12} className="text-[var(--muted)] group-hover:text-[var(--text)] transition" />
                <span>{t('tl.' + lane.kind)}</span>
                <kbd className="rounded-md bg-[var(--fill)] px-1.5 py-0.5 font-mono text-[9px] font-semibold leading-none text-[var(--faint)] group-hover:text-[var(--muted)]">{lane.key}</kbd>
              </button>
              {lane.kind === 'zoom' ? (
                <button
                  data-testid="suggest-zooms"
                  onClick={() => suggestZooms()}
                  disabled={!hasActivity}
                  className="ml-1.5 flex h-7 w-7 items-center justify-center rounded-xl border border-[#0A84FF]/30 bg-[#0A84FF]/15 text-[#0A84FF] hover:bg-[#0A84FF]/25 disabled:opacity-30 transition"
                  title={hasActivity ? t('tl.suggestZooms') : t('tl.noCursorData')}
                  aria-label={t('tl.suggestZooms')}
                >
                  <Sparkles size={12} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ItemChip({
  item,
  pixelsPerSecond,
  durationMs,
  chipBg,
  borderColor,
  selected
}: {
  item: LaneItem;
  pixelsPerSecond: number;
  durationMs: number;
  chipBg: string;
  borderColor: string;
  selected: boolean;
}) {
  const t = useT();
  const updateItem = useEditor((s) => s.updateItem);
  const selectItem = useEditor((s) => s.selectItem);

  const items = useEditor((s) => s.items);

  const left = (item.startMs / 1000) * pixelsPerSecond;
  const width = Math.max(8, ((item.endMs - item.startMs) / 1000) * pixelsPerSecond);

  const dragRef = useRef<{ kind: 'move' | 'left' | 'right'; startX: number; startMs: number; endMs: number } | null>(null);

  function onDragStart(kind: 'move' | 'left' | 'right', e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    selectItem(item.id);
    dragRef.current = { kind, startX: e.clientX, startMs: item.startMs, endMs: item.endMs };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDragMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dxMs = ((e.clientX - d.startX) / pixelsPerSecond) * 1000;
    let nextStart = d.startMs;
    let nextEnd = d.endMs;
    const snapThresholdMs = Math.max(400, (24 / pixelsPerSecond) * 1000);
    const otherItems = items.filter((it) => it.kind === item.kind && it.id !== item.id);

    if (d.kind === 'move') {
      const len = d.endMs - d.startMs;
      let rawStart = d.startMs + dxMs;

      let bestStart = rawStart;
      let minDiff = snapThresholdMs;

      if (Math.abs(rawStart) < minDiff) {
        bestStart = 0;
        minDiff = Math.abs(rawStart);
      }

      for (const other of otherItems) {
        // Snap this start to other's end
        const diffEnd = Math.abs(rawStart - other.endMs);
        if (diffEnd < minDiff) {
          bestStart = other.endMs;
          minDiff = diffEnd;
        }
        // Snap this end to other's start
        const diffStart = Math.abs((rawStart + len) - other.startMs);
        if (diffStart < minDiff) {
          bestStart = other.startMs - len;
          minDiff = diffStart;
        }
      }

      nextStart = Math.max(0, Math.min(durationMs - len, bestStart));
      nextEnd = nextStart + len;
    } else if (d.kind === 'left') {
      let rawStart = d.startMs + dxMs;
      let bestStart = rawStart;
      let minDiff = snapThresholdMs;

      if (Math.abs(rawStart) < minDiff) {
        bestStart = 0;
        minDiff = Math.abs(rawStart);
      }
      for (const other of otherItems) {
        const diff = Math.abs(rawStart - other.endMs);
        if (diff < minDiff) {
          bestStart = other.endMs;
          minDiff = diff;
        }
      }
      nextStart = Math.max(0, Math.min(d.endMs - 100, bestStart));
    } else {
      let rawEnd = item.kind === 'titleCard' ? d.endMs + dxMs : Math.min(durationMs, d.endMs + dxMs);
      let bestEnd = rawEnd;
      let minDiff = snapThresholdMs;

      for (const other of otherItems) {
        const diff = Math.abs(rawEnd - other.startMs);
        if (diff < minDiff) {
          bestEnd = other.startMs;
          minDiff = diff;
        }
      }
      nextEnd = Math.max(d.startMs + 100, bestEnd);
    }
    updateItem(item.id, { startMs: nextStart, endMs: nextEnd });
  }

  function onDragEnd(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  const labelText =
    item.kind === 'titleCard' ? `${item.pauseVideo === false ? '💬' : '🗂️'} ${item.title?.trim() || t('tl.titleCardPlaceholder')}` :
    item.kind === 'zoom' ? `${item.zoomLevel?.toFixed(1)}×` :
    item.kind === 'speed' ? `${item.speed?.toFixed(2)}×` :
    item.kind === 'magnify' ? t('tl.magnify') :
    item.kind === 'spotlight' ? t('tl.spotlight') :
    item.kind === 'blur' ? t('tl.blur') :
    item.kind === 'scene' ? `✨ ${t(`side.scene.${item.scene ?? 'heroFlyIn'}`)}` :
    item.kind === 'rotation' ? `⟳ ${[item.tiltX, item.tiltY, item.spinZ].map((d) => `${Math.round(d ?? 0)}°`).join(' ')}` :
    item.kind === 'annotation' ? (item.text?.trim() || t('tl.annotationPlaceholder')) :
    t('tl.cut');

  return (
    <div
      data-item-kind={item.kind}
      onClick={(e) => { e.stopPropagation(); selectItem(item.id); }}
      onPointerDown={(e) => onDragStart('move', e)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      className={
        'group absolute top-1.5 h-9 cursor-grab rounded border ' + borderColor + ' ' + chipBg + ' ' +
        (selected ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-[#0a0b0e]' : '')
      }
      style={{ left, width }}
      title="Drag to move; drag edges to resize; click to select"
    >
      <div className={'truncate px-1.5 pt-1 text-[10px] tracking-wide text-[var(--text)] ' + (item.kind === 'annotation' || item.kind === 'titleCard' ? 'normal-case' : 'uppercase')}>
        {labelText}
      </div>
      {/* resize handles */}
      <div
        onPointerDown={(e) => onDragStart('left', e)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
      />
      <div
        onPointerDown={(e) => onDragStart('right', e)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
      />
    </div>
  );
}

function CaptionChip({
  cue,
  pixelsPerSecond,
  durationMs,
  selected
}: {
  cue: CaptionCue;
  pixelsPerSecond: number;
  durationMs: number;
  selected: boolean;
}) {
  const updateCaptionCue = useEditor((s) => s.updateCaptionCue);
  const selectCaption = useEditor((s) => s.selectCaption);

  const left = (cue.startMs / 1000) * pixelsPerSecond;
  const width = Math.max(12, ((cue.endMs - cue.startMs) / 1000) * pixelsPerSecond);

  const dragRef = useRef<{ kind: 'move' | 'left' | 'right'; startX: number; startMs: number; endMs: number } | null>(null);

  function onDragStart(kind: 'move' | 'left' | 'right', e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    selectCaption(cue.id);
    dragRef.current = { kind, startX: e.clientX, startMs: cue.startMs, endMs: cue.endMs };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDragMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dxMs = ((e.clientX - d.startX) / pixelsPerSecond) * 1000;
    let nextStart = d.startMs;
    let nextEnd = d.endMs;

    if (d.kind === 'move') {
      const len = d.endMs - d.startMs;
      nextStart = Math.max(0, Math.min(durationMs - len, d.startMs + dxMs));
      nextEnd = nextStart + len;
    } else if (d.kind === 'left') {
      nextStart = Math.max(0, Math.min(d.endMs - 150, d.startMs + dxMs));
    } else if (d.kind === 'right') {
      nextEnd = Math.max(d.startMs + 150, Math.min(durationMs, d.endMs + dxMs));
    }

    updateCaptionCue(cue.id, { startMs: Math.round(nextStart), endMs: Math.round(nextEnd) });
  }

  function onDragEnd(e: React.PointerEvent) {
    if (!dragRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    dragRef.current = null;
  }

  return (
    <div
      className={`group absolute top-1 bottom-1 flex items-center overflow-hidden rounded-md border text-[11px] font-medium transition-shadow select-none ${
        selected ? 'border-sky-400 bg-sky-500/40 shadow-lg shadow-sky-500/20 ring-1 ring-sky-400' : 'border-sky-500/30 bg-sky-500/20 hover:border-sky-400/60'
      }`}
      style={{ left, width }}
      onPointerDown={(e) => onDragStart('move', e)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      title={cue.text}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-white/40"
        onPointerDown={(e) => onDragStart('left', e)}
      />
      <div className="flex-1 truncate px-2 text-sky-200">
        {cue.text}
      </div>
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-white/40"
        onPointerDown={(e) => onDragStart('right', e)}
      />
    </div>
  );
}

function SelectedItemInspector() {
  const t = useT();
  const id = useEditor((s) => s.selectedItemId);
  const item = useEditor((s) => s.items.find((it) => it.id === id) ?? null);
  const removeItem = useEditor((s) => s.removeItem);
  const selectItem = useEditor((s) => s.selectItem);

  if (!item) return null;

  // Zoom / Speed / Title Card item editing lives in the right sidebar's Selection panel
  // (presets, custom value, focus crosshair). This inline strip keeps just the
  // identifying summary and a delete shortcut; annotation text is edited on the
  // preview (double-click) or in the sidebar.
  const showSidebarHint = item.kind === 'zoom' || item.kind === 'speed' || item.kind === 'titleCard';

  return (
    <div className="flex items-center gap-3 border-b border-[var(--card-border)] bg-[var(--strip-bg)] px-3.5 py-2 text-xs">
      <span className="font-semibold uppercase tracking-wider text-[var(--text)] text-[11px]">{item.kind === 'titleCard' ? t('tl.titleCard') : item.kind}</span>
      <span className="font-mono text-[var(--muted)] text-[11px] px-2 py-0.5 rounded-lg bg-[var(--fill)] border border-[var(--stroke)]">
        {formatTime(item.startMs)} → {formatTime(item.endMs)}
      </span>

      {item.kind === 'annotation' && (
        <span className="truncate text-xs text-[var(--faint)]">{t('tl.annotationEditHint')}</span>
      )}

      {item.kind === 'titleCard' && (
        <span className="truncate text-xs text-[var(--faint)]">{t('tl.titleCardEditHint')}</span>
      )}

      {showSidebarHint && item.kind !== 'titleCard' && (
        <span className="text-xs text-[var(--faint)]">{t('tl.adjustHint')}</span>
      )}

      <div className="flex-1" />
      <button
        onClick={() => { removeItem(item.id); selectItem(null); }}
        className="flex items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition"
        title={t('tl.deleteDel')}
      >
        <Trash2 size={12} /> {t('common.delete')}
      </button>
    </div>
  );
}

function AspectSelector() {
  const t = useT();
  const aspect = useEditor((s) => s.aspect);
  const setAspect = useEditor((s) => s.setAspect);
  return (
    <select
      value={aspect}
      onChange={(e) => setAspect(e.target.value as any)}
      className="cursor-pointer rounded-xl border border-[var(--btn-squircle-border)] bg-[var(--btn-squircle)] px-2.5 py-1 text-xs font-medium text-[var(--text)] outline-none hover:bg-[var(--btn-squircle-hover)] transition"
      aria-label={t('editor.aspect')}
    >
      <option value="16:9" className="bg-[var(--panel)]">16:9</option>
      <option value="4:3" className="bg-[var(--panel)]">4:3</option>
      <option value="1:1" className="bg-[var(--panel)]">1:1</option>
      <option value="9:16" className="bg-[var(--panel)]">9:16</option>
      <option value="auto" className="bg-[var(--panel)]">Auto</option>
    </select>
  );
}
