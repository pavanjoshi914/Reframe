import { useEffect, useRef, useState, useCallback } from 'react';
import type { Region } from '@shared/ipc';

type Phase = 'idle' | 'drawing' | 'editing';

// Rectangle in CSS pixels of the overlay window. Translated to normalized
// 0..1 fractions only at confirmation time.
type Rect = { x: number; y: number; width: number; height: number };

// Minimum selection (CSS pixels). Anything smaller is too tiny to record from
// and likely an accidental click; the Record button stays disabled below this.
const MIN_PX = 32;

// Which part of the rect the user is currently dragging. 'move' translates the
// whole rect; 'nw'..'e' are the eight resize handles (corners + edge midpoints).
type Handle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function RegionApp() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [rect, setRect] = useState<Rect | null>(null);
  const dragRef = useRef<
    | { kind: 'draw'; startX: number; startY: number }
    | { kind: 'edit'; handle: Handle; startX: number; startY: number; startRect: Rect }
    | null
  >(null);

  const confirm = useCallback(() => {
    if (!rect) return;
    if (rect.width < MIN_PX || rect.height < MIN_PX) return;
    const region: Region = {
      x: rect.x / window.innerWidth,
      y: rect.y / window.innerHeight,
      width: rect.width / window.innerWidth,
      height: rect.height / window.innerHeight
    };
    window.api.selectRegion(region);
  }, [rect]);

  const cancel = useCallback(() => {
    window.api.cancelRegionSelector();
  }, []);

  // Esc cancels at any time; Enter confirms once we have an editable rect.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && phase === 'editing') {
        e.preventDefault();
        confirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, confirm, cancel]);

  function onBackdropMouseDown(e: React.MouseEvent) {
    // Only start a new drag if the user clicked the dim backdrop (not the rect
    // or its controls). A fresh drag scraps any prior selection.
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    dragRef.current = { kind: 'draw', startX: e.clientX, startY: e.clientY };
    setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
    setPhase('drawing');
  }

  function onHandleMouseDown(handle: Handle) {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!rect) return;
      dragRef.current = {
        kind: 'edit',
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startRect: rect
      };
    };
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'draw') {
        const x = Math.min(drag.startX, e.clientX);
        const y = Math.min(drag.startY, e.clientY);
        const width = Math.abs(e.clientX - drag.startX);
        const height = Math.abs(e.clientY - drag.startY);
        setRect({ x, y, width, height });
      } else {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        const { startRect, handle } = drag;
        setRect(applyDrag(startRect, handle, dx, dy));
      }
    }
    function onUp() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.kind === 'draw') {
        setPhase('editing');
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const valid = !!rect && rect.width >= MIN_PX && rect.height >= MIN_PX;

  return (
    <div
      onMouseDown={onBackdropMouseDown}
      className="relative h-screen w-screen select-none"
      style={{
        cursor: phase === 'idle' ? 'crosshair' : 'default',
        background: phase === 'idle' || !rect ? 'rgba(0,0,0,0.45)' : 'transparent'
      }}
    >
      {/* Dim mask outside the rect via four covering panels — gives the
          rect a fully-clear interior while the surroundings stay dimmed. */}
      {rect && phase !== 'idle' && (
        <>
          <Dim style={{ left: 0, top: 0, right: 0, height: rect.y }} />
          <Dim style={{ left: 0, top: rect.y + rect.height, right: 0, bottom: 0 }} />
          <Dim style={{ left: 0, top: rect.y, width: rect.x, height: rect.height }} />
          <Dim style={{ left: rect.x + rect.width, top: rect.y, right: 0, height: rect.height }} />
        </>
      )}

      {rect && (
        <div
          className="pointer-events-none absolute border-2 border-emerald-400"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px transparent'
          }}
        />
      )}

      {rect && phase === 'editing' && (
        <>
          {/* Move-by-drag interior */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              dragRef.current = {
                kind: 'edit',
                handle: 'move',
                startX: e.clientX,
                startY: e.clientY,
                startRect: rect
              };
            }}
            className="absolute"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              cursor: 'move'
            }}
          />
          {/* Eight resize handles */}
          {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Handle[]).map((h) => (
            <ResizeHandle
              key={h}
              handle={h}
              rect={rect}
              onMouseDown={onHandleMouseDown(h)}
            />
          ))}

          {/* Dimensions chip + select / cancel */}
          <Toolbar rect={rect} valid={valid} onConfirm={confirm} onCancel={cancel} />
        </>
      )}

      {rect && phase === 'drawing' && <DimensionsChip rect={rect} />}

      {phase === 'idle' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/70 px-4 py-2 text-sm text-white/90 ring-1 ring-white/10">
            Click and drag to select a region · <kbd className="font-mono">Esc</kbd> to cancel
          </div>
        </div>
      )}
    </div>
  );
}

function Dim({ style }: { style: React.CSSProperties }) {
  // pointer-events-none so a mousedown on the dimmed surround falls through
  // to the root backdrop and starts a fresh drag-to-select.
  return <div className="pointer-events-none absolute bg-black/45" style={style} />;
}

function DimensionsChip({ rect }: { rect: Rect }) {
  const left = Math.min(window.innerWidth - 110, Math.max(8, rect.x));
  const top = rect.y + rect.height + 8;
  return (
    <div
      className="pointer-events-none absolute rounded-md bg-black/80 px-2 py-1 font-mono text-xs text-white tabular-nums ring-1 ring-white/15"
      style={{ left, top }}
    >
      {Math.round(rect.width)} × {Math.round(rect.height)}
    </div>
  );
}

function Toolbar({
  rect,
  valid,
  onConfirm,
  onCancel
}: {
  rect: Rect;
  valid: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Try to dock the toolbar just below the rect; fall back above it if there's
  // no room below (selection near the bottom edge of the display).
  const below = rect.y + rect.height + 12;
  const aboveFits = rect.y >= 56;
  const top = below + 56 > window.innerHeight && aboveFits ? rect.y - 52 : below;
  const left = Math.min(window.innerWidth - 260, Math.max(8, rect.x));
  return (
    <div
      className="absolute flex items-center gap-2 rounded-full bg-black/80 px-2 py-1 text-sm text-white shadow-2xl ring-1 ring-white/15"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="px-2 font-mono text-xs tabular-nums text-white/80">
        {Math.round(rect.width)} × {Math.round(rect.height)}
      </span>
      <button
        onClick={onCancel}
        className="rounded-full px-3 py-1 text-xs text-white/80 hover:bg-white/10"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={!valid}
        className={
          'rounded-full px-3 py-1 text-xs font-medium ' +
          (valid
            ? 'bg-emerald-500 text-black hover:bg-emerald-400'
            : 'cursor-not-allowed bg-white/10 text-white/30')
        }
      >
        Select area
      </button>
    </div>
  );
}

function ResizeHandle({
  handle,
  rect,
  onMouseDown
}: {
  handle: Handle;
  rect: Rect;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const pos = handlePosition(handle, rect);
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute h-3 w-3 rounded-sm border border-black/40 bg-emerald-400 shadow"
      style={{ left: pos.x - 6, top: pos.y - 6, cursor: handleCursor(handle) }}
    />
  );
}

function handlePosition(h: Handle, r: Rect) {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  switch (h) {
    case 'nw': return { x: r.x, y: r.y };
    case 'n':  return { x: cx,  y: r.y };
    case 'ne': return { x: r.x + r.width, y: r.y };
    case 'e':  return { x: r.x + r.width, y: cy };
    case 'se': return { x: r.x + r.width, y: r.y + r.height };
    case 's':  return { x: cx,  y: r.y + r.height };
    case 'sw': return { x: r.x, y: r.y + r.height };
    case 'w':  return { x: r.x, y: cy };
    default:   return { x: cx, y: cy };
  }
}

function handleCursor(h: Handle): string {
  switch (h) {
    case 'nw':
    case 'se': return 'nwse-resize';
    case 'ne':
    case 'sw': return 'nesw-resize';
    case 'n':
    case 's':  return 'ns-resize';
    case 'e':
    case 'w':  return 'ew-resize';
    default:   return 'move';
  }
}

function applyDrag(start: Rect, h: Handle, dx: number, dy: number): Rect {
  if (h === 'move') {
    const W = window.innerWidth;
    const H = window.innerHeight;
    return {
      x: clamp(start.x + dx, 0, W - start.width),
      y: clamp(start.y + dy, 0, H - start.height),
      width: start.width,
      height: start.height
    };
  }
  let x = start.x;
  let y = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (h.includes('n')) y = start.y + dy;
  if (h.includes('s')) bottom = start.y + start.height + dy;
  if (h.includes('w')) x = start.x + dx;
  if (h.includes('e')) right = start.x + start.width + dx;
  // Allow inverting through zero by normalizing afterward.
  const nx = Math.min(x, right);
  const ny = Math.min(y, bottom);
  const nw = Math.abs(right - x);
  const nh = Math.abs(bottom - y);
  return {
    x: clamp(nx, 0, window.innerWidth),
    y: clamp(ny, 0, window.innerHeight),
    width: Math.min(nw, window.innerWidth - nx),
    height: Math.min(nh, window.innerHeight - ny)
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
