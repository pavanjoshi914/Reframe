import { useEffect, useMemo, useRef } from 'react';
import { Plus, ZoomIn, Scissors, MessageSquare, Gauge, Trash2, type LucideIcon } from 'lucide-react';
import { useEditor, type LaneItem, type LaneKind } from './store';

const LANES: { kind: LaneKind; label: string; key: string; icon: LucideIcon; color: string; chip: string }[] = [
  { kind: 'zoom', label: 'Zoom', key: 'Z', icon: ZoomIn, color: 'border-emerald-400', chip: 'bg-emerald-500/30' },
  { kind: 'trim', label: 'Trim', key: 'T', icon: Scissors, color: 'border-rose-400', chip: 'bg-rose-500/30' },
  { kind: 'annotation', label: 'Annotation', key: 'A', icon: MessageSquare, color: 'border-amber-400', chip: 'bg-amber-500/30' },
  { kind: 'speed', label: 'Speed', key: 'S', icon: Gauge, color: 'border-sky-400', chip: 'bg-sky-500/30' }
];

const LANE_LABEL_W = 100;

function formatTime(ms: number) {
  const total = Math.max(0, ms / 1000);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Timeline() {
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

  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: Z/T/A/S add items, Delete removes selected
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      const map: Record<string, LaneKind> = { z: 'zoom', t: 'trim', a: 'annotation', s: 'speed' };
      const k = e.key.toLowerCase();
      if (map[k]) {
        e.preventDefault();
        addItem(map[k], currentMs);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedItemId) {
        e.preventDefault();
        removeItem(selectedItemId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentMs, addItem, selectedItemId, removeItem]);

  // Use the exact fractional duration so the track width matches the recording
  // and the ruler doesn't overrun. Math.ceil here previously rounded a 10.3s
  // recording up to 11s, producing a phantom 0:11 tick + empty trailing space.
  const totalSec = Math.max(1, durationMs / 1000);
  const trackWidth = totalSec * pixelsPerSecond;

  const ticks = useMemo(() => {
    const step = pixelsPerSecond < 30 ? 5 : pixelsPerSecond < 80 ? 1 : 0.5;
    const out: number[] = [];
    // Integer-step ticks up to (but not past) the real duration. The +0.001
    // epsilon lets a tick land exactly on the end when duration is integral.
    for (let s = 0; s <= totalSec + 0.001; s += step) {
      if (s <= totalSec + 0.001) out.push(s);
    }
    return out;
  }, [totalSec, pixelsPerSecond]);

  function msFromClientX(clientX: number) {
    const track = trackRef.current;
    if (!track) return 0;
    const r = track.getBoundingClientRect();
    const ratio = (clientX - r.left) / r.width;
    return Math.max(0, Math.min(durationMs, ratio * durationMs));
  }

  // Smooth scrubbing — pointer-down/move/up across the ruler or any empty
  // lane area. Captures the pointer so the playhead tracks the cursor even
  // when it leaves the original element.
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

  function handleWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return; // let normal scroll pan
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setPixelsPerSecond(pixelsPerSecond * factor);
  }

  const playheadPx = (currentMs / 1000) * pixelsPerSecond;

  return (
    <div className="flex flex-col border-t border-white/5 bg-[#0a0b0e]">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-xs text-white/50">
        <div className="flex items-center gap-3">
          <span className="font-mono text-white/80">{formatTime(currentMs)} / {formatTime(durationMs)}</span>
          <AspectSelector />
          <span className="text-[11px]">Press Z / T / A / S to add lane items</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span>Scroll</span>
          <span className="text-white/30">|</span>
          <span>Pan</span>
          <span className="text-white/30">|</span>
          <span>Ctrl+Scroll Zoom</span>
        </div>
      </div>

      <SelectedItemInspector />

      <div ref={scrollRef} className="overflow-x-auto" onWheel={handleWheel}>
        <div style={{ width: LANE_LABEL_W + trackWidth }}>
          {/* time ruler */}
          <div className="relative h-6 border-b border-white/5" style={{ paddingLeft: LANE_LABEL_W }}>
            <div
              ref={trackRef}
              className="relative h-full cursor-pointer touch-none select-none"
              onPointerDown={onScrubDown}
              onPointerMove={onScrubMove}
              onPointerUp={onScrubUp}
              onPointerCancel={onScrubUp}
              style={{ width: trackWidth }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full border-l border-white/10"
                  style={{ left: t * pixelsPerSecond }}
                >
                  <span className="ml-1 text-[10px] text-white/40">{formatTime(t * 1000)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* lanes */}
          <div className="relative">
            {LANES.map((lane) => {
              const laneItems = items.filter((it) => it.kind === lane.kind);
              return (
                <div key={lane.kind} className="flex h-12 items-stretch border-b border-white/5">
                  <div
                    className="sticky left-0 z-20 flex shrink-0 items-center justify-between border-r border-white/5 bg-[#0a0b0e] px-2 text-[11px] text-white/60"
                    style={{ width: LANE_LABEL_W }}
                  >
                    <span className="flex items-center gap-1.5">
                      <lane.icon size={12} />
                      {lane.label}
                    </span>
                    <button
                      onClick={() => addItem(lane.kind, currentMs)}
                      className="flex h-5 w-5 items-center justify-center rounded bg-white/5 hover:bg-white/15"
                      title={`Add ${lane.label} (${lane.key})`}
                      aria-label={`Add ${lane.label}`}
                    >
                      <Plus size={10} />
                    </button>
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
                      <div className="pointer-events-none flex h-full items-center pl-3 text-[11px] text-white/25">
                        Press {lane.key} to add {lane.label.toLowerCase()}
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
              className="pointer-events-none absolute inset-y-0 w-px bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
              style={{ left: LANE_LABEL_W + playheadPx }}
            >
              <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-emerald-400" />
            </div>
          </div>
        </div>
      </div>
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
  const updateItem = useEditor((s) => s.updateItem);
  const selectItem = useEditor((s) => s.selectItem);

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
    if (d.kind === 'move') {
      const len = d.endMs - d.startMs;
      nextStart = Math.max(0, Math.min(durationMs - len, d.startMs + dxMs));
      nextEnd = nextStart + len;
    } else if (d.kind === 'left') {
      nextStart = Math.max(0, Math.min(d.endMs - 100, d.startMs + dxMs));
    } else {
      nextEnd = Math.max(d.startMs + 100, Math.min(durationMs, d.endMs + dxMs));
    }
    updateItem(item.id, { startMs: nextStart, endMs: nextEnd });
  }

  function onDragEnd(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  const labelText =
    item.kind === 'zoom' ? `${item.zoomLevel?.toFixed(1)}×` :
    item.kind === 'speed' ? `${item.speed?.toFixed(2)}×` :
    item.kind === 'annotation' ? (item.text || 'note') :
    'cut';

  return (
    <div
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
      <div className="truncate px-1.5 pt-1 text-[10px] uppercase tracking-wide text-white/80">
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

function SelectedItemInspector() {
  const id = useEditor((s) => s.selectedItemId);
  const item = useEditor((s) => s.items.find((it) => it.id === id) ?? null);
  const updateItem = useEditor((s) => s.updateItem);
  const removeItem = useEditor((s) => s.removeItem);
  const selectItem = useEditor((s) => s.selectItem);

  if (!item) return null;

  // Zoom / Speed item editing lives in the right sidebar's Selection panel
  // (presets, custom value, focus crosshair). This inline strip keeps just the
  // identifying summary, annotation-text inline edit, and a delete shortcut.
  const showSidebarHint = item.kind === 'zoom' || item.kind === 'speed';

  return (
    <div className="flex items-center gap-3 border-b border-white/5 bg-[#0e0f12] px-3 py-1.5 text-xs">
      <span className="font-medium uppercase tracking-wide text-white/60">{item.kind}</span>
      <span className="font-mono text-white/40">
        {formatTime(item.startMs)} → {formatTime(item.endMs)}
      </span>

      {item.kind === 'annotation' && (
        <input
          value={item.text ?? ''}
          onChange={(e) => updateItem(item.id, { text: e.target.value })}
          placeholder="Annotation text"
          className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/80 placeholder:text-white/30"
        />
      )}

      {showSidebarHint && (
        <span className="text-[11px] text-white/40">Adjust level + focus in the right sidebar →</span>
      )}

      <div className="flex-1" />
      <button
        onClick={() => { removeItem(item.id); selectItem(null); }}
        className="flex items-center gap-1 rounded border border-white/10 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
        title="Delete (Del)"
      >
        <Trash2 size={11} /> Delete
      </button>
    </div>
  );
}

function AspectSelector() {
  const aspect = useEditor((s) => s.aspect);
  const setAspect = useEditor((s) => s.setAspect);
  return (
    <select
      value={aspect}
      onChange={(e) => setAspect(e.target.value as any)}
      className="rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-xs text-white/80"
      aria-label="Aspect ratio"
    >
      <option value="16:9">16:9</option>
      <option value="4:3">4:3</option>
      <option value="1:1">1:1</option>
      <option value="9:16">9:16</option>
      <option value="auto">Auto</option>
    </select>
  );
}
