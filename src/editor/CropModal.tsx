import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Lock, Unlock } from 'lucide-react';
import { useEditor, DEFAULT_CROP_REGION, type CropRegion } from './store';
import { useT } from '../i18n';

// Aspect-ratio presets in the dropdown. Numeric value or null for Free. The
// labels match the openscreen reference modal so users coming from there
// see the same options.
const ASPECT_PRESETS: { label: string; value: number | null }[] = [
  { label: 'Free', value: null },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '1:1', value: 1 },
  { label: '21:9', value: 21 / 9 }
];

const MIN_NORM = 0.05; // 5% minimum on each axis — matches the store clamp.

type Handle = 'top' | 'right' | 'bottom' | 'left' | 'move';

export function CropModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const storeCrop = useEditor((s) => s.cropRegion);
  const setCropRegion = useEditor((s) => s.setCropRegion);
  // Live reference to the editor's already-primed <video> element. We draw
  // its current frame into our canvas every animation frame instead of
  // creating a second video element — that path was unreliable because the
  // element wasn't being decoded into until after we'd already taken the
  // screenshot the user was complaining about.
  const mainVideo = useEditor((s) => s.mainVideoEl);

  // Modal-local working copy. Cancel = throw away; Done = commit. Aspect-lock
  // is intentionally not persisted — it's a transient editing aid, not part
  // of the project's saved state.
  const [crop, setCrop] = useState<CropRegion>(storeCrop);
  const [aspectLocked, setAspectLocked] = useState(false);
  const [aspectValue, setAspectValue] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [intrinsic, setIntrinsic] = useState<{ w: number; h: number } | null>(null);

  // Drive the preview canvas at rAF cadence from the editor's main video.
  // ctx.drawImage on an HTMLVideoElement reads whatever frame the element
  // currently has, so this picks up scrubs, pauses, and play seamlessly.
  useEffect(() => {
    if (!mainVideo) return;
    let raf = 0;
    const draw = () => {
      const c = canvasRef.current;
      const v = mainVideo;
      if (c && v.videoWidth > 0) {
        if (c.width !== v.videoWidth) c.width = v.videoWidth;
        if (c.height !== v.videoHeight) c.height = v.videoHeight;
        const ctx = c.getContext('2d');
        if (ctx) {
          try { ctx.drawImage(v, 0, 0); } catch { /* black frame OK */ }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    if (mainVideo.videoWidth > 0) {
      setIntrinsic({ w: mainVideo.videoWidth, h: mainVideo.videoHeight });
    } else {
      const onMeta = () => setIntrinsic({ w: mainVideo.videoWidth, h: mainVideo.videoHeight });
      mainVideo.addEventListener('loadedmetadata', onMeta, { once: true });
      return () => {
        cancelAnimationFrame(raf);
        mainVideo.removeEventListener('loadedmetadata', onMeta);
      };
    }
    return () => cancelAnimationFrame(raf);
  }, [mainVideo]);

  // Esc-to-close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCommit = () => {
    setCropRegion(crop);
    onClose();
  };

  // Container aspect ratio mirrors the source video so handle math maps 1:1
  // between displayed pixels and normalized coords.
  const videoAspect = intrinsic ? intrinsic.w / intrinsic.h : 16 / 9;

  // ---- drag handling ----
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    startCrop: CropRegion;
    rect: DOMRect;
  } | null>(null);

  function onPointerDown(handle: Handle, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const cont = containerRef.current;
    if (!cont) return;
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: crop,
      rect: cont.getBoundingClientRect()
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dxNorm = (e.clientX - d.startX) / d.rect.width;
    const dyNorm = (e.clientY - d.startY) / d.rect.height;
    let { x, y, width, height } = d.startCrop;
    switch (d.handle) {
      case 'left': {
        const nx = Math.max(0, Math.min(d.startCrop.x + d.startCrop.width - MIN_NORM, d.startCrop.x + dxNorm));
        width = d.startCrop.width + (d.startCrop.x - nx);
        x = nx;
        break;
      }
      case 'right': {
        const nw = Math.max(MIN_NORM, Math.min(1 - d.startCrop.x, d.startCrop.width + dxNorm));
        width = nw;
        break;
      }
      case 'top': {
        const ny = Math.max(0, Math.min(d.startCrop.y + d.startCrop.height - MIN_NORM, d.startCrop.y + dyNorm));
        height = d.startCrop.height + (d.startCrop.y - ny);
        y = ny;
        break;
      }
      case 'bottom': {
        const nh = Math.max(MIN_NORM, Math.min(1 - d.startCrop.y, d.startCrop.height + dyNorm));
        height = nh;
        break;
      }
      case 'move': {
        x = Math.max(0, Math.min(1 - d.startCrop.width, d.startCrop.x + dxNorm));
        y = Math.max(0, Math.min(1 - d.startCrop.height, d.startCrop.y + dyNorm));
        break;
      }
    }
    setCrop({ x, y, width, height });
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  // ---- aspect-ratio enforcement ----
  // When the user picks a preset, derive height from the current width;
  // fall back to deriving width from height if that overflows. Mirrors
  // openscreen's `applyCropAspectPreset`.
  function applyAspectPreset(ratio: number | null) {
    setAspectValue(ratio);
    setAspectLocked(ratio !== null);
    if (ratio == null || !intrinsic) return;
    // ratio is width/height in OUTPUT space. Source pixels: cropPxW/cropPxH = ratio * (sh/sw)
    // Working in normalized space: width_norm/height_norm * (sw/sh) = ratio
    // → width_norm = height_norm * ratio * (sh/sw)
    const sourceAspect = intrinsic.w / intrinsic.h;
    const wOverH = ratio / sourceAspect; // normalized w/h
    let nw = crop.width;
    let nh = nw / wOverH;
    if (crop.y + nh > 1) {
      nh = crop.height;
      nw = nh * wOverH;
    }
    nw = Math.min(1 - crop.x, Math.max(MIN_NORM, nw));
    nh = Math.min(1 - crop.y, Math.max(MIN_NORM, nh));
    setCrop({ ...crop, width: nw, height: nh });
  }

  // Pixel display values for the X/Y/W/H inputs.
  const px = useMemo(() => {
    if (!intrinsic) return { x: 0, y: 0, w: 0, h: 0 };
    return {
      x: Math.round(crop.x * intrinsic.w),
      y: Math.round(crop.y * intrinsic.h),
      w: Math.round(crop.width * intrinsic.w),
      h: Math.round(crop.height * intrinsic.h)
    };
  }, [crop, intrinsic]);

  function handleNumericChange(field: 'x' | 'y' | 'w' | 'h', pixelValue: number) {
    if (!intrinsic) return;
    const next = { ...crop };
    if (field === 'x') {
      next.x = Math.max(0, Math.min(1 - MIN_NORM, pixelValue / intrinsic.w));
      next.width = Math.min(next.width, 1 - next.x);
    } else if (field === 'y') {
      next.y = Math.max(0, Math.min(1 - MIN_NORM, pixelValue / intrinsic.h));
      next.height = Math.min(next.height, 1 - next.y);
    } else if (field === 'w') {
      next.width = Math.max(MIN_NORM, Math.min(1 - next.x, pixelValue / intrinsic.w));
      if (aspectLocked && aspectValue != null) {
        const sourceAspect = intrinsic.w / intrinsic.h;
        const nh = next.width / (aspectValue / sourceAspect);
        if (next.y + nh <= 1) next.height = nh;
      }
    } else {
      next.height = Math.max(MIN_NORM, Math.min(1 - next.y, pixelValue / intrinsic.h));
      if (aspectLocked && aspectValue != null) {
        const sourceAspect = intrinsic.w / intrinsic.h;
        const nw = next.height * (aspectValue / sourceAspect);
        if (next.x + nw <= 1) next.width = nw;
      }
    }
    setCrop(next);
  }

  // Inset values for the dimming SVG mask (% from each side).
  const insetTop = `${crop.y * 100}%`;
  const insetLeft = `${crop.x * 100}%`;
  const insetW = `${crop.width * 100}%`;
  const insetH = `${crop.height * 100}%`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0e0f12] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-white/5 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">{t('side.cropVideo')}</h2>
            <p className="mt-0.5 text-xs text-white/50">{t('crop.dragHint')}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Preview area */}
        <div className="flex flex-1 items-center justify-center overflow-auto p-6">
          <div
            ref={containerRef}
            className="relative w-full select-none rounded-md bg-black shadow-xl"
            style={{ aspectRatio: String(videoAspect), maxHeight: '60vh' }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full rounded-md object-contain"
            />

            {/* Dim overlay outside crop */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <defs>
                <mask id="crop-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={insetLeft} y={insetTop} width={insetW} height={insetH} fill="black" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="black" fillOpacity="0.55" mask="url(#crop-mask)" />
              <rect
                x={insetLeft}
                y={insetTop}
                width={insetW}
                height={insetH}
                fill="none"
                stroke="rgba(52,178,123,0.9)"
                strokeWidth="2"
              />
            </svg>

            {/* Move overlay (whole crop region) */}
            <div
              className="absolute cursor-move"
              style={{ left: insetLeft, top: insetTop, width: insetW, height: insetH }}
              onPointerDown={(e) => onPointerDown('move', e)}
            />

            {/* Edge handles */}
            <div
              className="absolute h-2 cursor-ns-resize bg-emerald-400/0 hover:bg-emerald-400/30"
              style={{ left: insetLeft, top: `calc(${insetTop} - 4px)`, width: insetW }}
              onPointerDown={(e) => onPointerDown('top', e)}
            />
            <div
              className="absolute h-2 cursor-ns-resize bg-emerald-400/0 hover:bg-emerald-400/30"
              style={{ left: insetLeft, top: `calc(${insetTop} + ${insetH} - 4px)`, width: insetW }}
              onPointerDown={(e) => onPointerDown('bottom', e)}
            />
            <div
              className="absolute w-2 cursor-ew-resize bg-emerald-400/0 hover:bg-emerald-400/30"
              style={{ top: insetTop, left: `calc(${insetLeft} - 4px)`, height: insetH }}
              onPointerDown={(e) => onPointerDown('left', e)}
            />
            <div
              className="absolute w-2 cursor-ew-resize bg-emerald-400/0 hover:bg-emerald-400/30"
              style={{ top: insetTop, left: `calc(${insetLeft} + ${insetW} - 4px)`, height: insetH }}
              onPointerDown={(e) => onPointerDown('right', e)}
            />
          </div>
        </div>

        {/* Numeric inputs + aspect-ratio + actions */}
        <div className="shrink-0 border-t border-white/5 bg-[#0a0b0e] px-6 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <NumericField label="X" value={px.x} onChange={(v) => handleNumericChange('x', v)} disabled={!intrinsic} />
            <NumericField label="Y" value={px.y} onChange={(v) => handleNumericChange('y', v)} disabled={!intrinsic} />
            <NumericField label="W" value={px.w} onChange={(v) => handleNumericChange('w', v)} disabled={!intrinsic} />
            <NumericField label="H" value={px.h} onChange={(v) => handleNumericChange('h', v)} disabled={!intrinsic} />

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-white/50">{t('crop.aspect')}</span>
              <select
                value={aspectValue == null ? '' : String(aspectValue)}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  applyAspectPreset(v);
                }}
                className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
              >
                {ASPECT_PRESETS.map((p) => (
                  <option key={p.label} value={p.value == null ? '' : String(p.value)}>{p.value == null ? t('crop.free') : p.label}</option>
                ))}
              </select>
            </label>

            <button
              onClick={() => setAspectLocked((v) => !v)}
              disabled={aspectValue == null}
              className={
                'flex h-9 items-center justify-center rounded-md border px-2 text-xs ' +
                (aspectLocked
                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10') +
                ' disabled:opacity-40 disabled:cursor-not-allowed'
              }
              title={aspectLocked ? t('crop.aspectLocked') : t('crop.aspectUnlocked')}
              aria-label={aspectLocked ? t('crop.unlockAspect') : t('crop.lockAspect')}
            >
              {aspectLocked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>

            <div className="ml-auto text-xs text-white/40">
              {intrinsic ? `${intrinsic.w} × ${intrinsic.h}px source` : ''}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => { setCrop(DEFAULT_CROP_REGION); setAspectLocked(false); setAspectValue(null); }}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              {t('common.reset')}
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleCommit}
              className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-medium text-black hover:bg-emerald-400"
            >
              {t('common.done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumericField({
  label,
  value,
  onChange,
  disabled
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-white/50">{label}</span>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(0, v));
        }}
        className="w-20 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white/90 focus:border-emerald-400/60 focus:outline-none disabled:opacity-40"
      />
    </label>
  );
}
