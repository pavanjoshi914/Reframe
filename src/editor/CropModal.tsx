import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Lock, Unlock, RotateCcw } from 'lucide-react';
import { useEditor, DEFAULT_CROP_REGION, type CropRegion } from './store';
import { useT } from '../i18n';

// Aspect-ratio presets. Numeric value or null for Free.
const ASPECT_PRESETS: { label: string; value: number | null | 'original' }[] = [
  { label: 'Free', value: null },
  { label: 'Original', value: 'original' },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '1:1', value: 1 },
  { label: '21:9', value: 21 / 9 }
];

const MIN_NORM = 0.05; // 5% minimum on each axis — matches the store clamp.

type Handle =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'move';

export function CropModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const storeCrop = useEditor((s) => s.cropRegion);
  const setCropRegion = useEditor((s) => s.setCropRegion);

  // Live reference to the editor's already-primed media elements.
  const mediaType = useEditor((s) => s.mediaType);
  const mainVideo = useEditor((s) => s.mainVideoEl);
  const mainImage = useEditor((s) => s.mainImageEl);

  // Modal-local working copy. Cancel = throw away; Done = commit.
  const [crop, setCrop] = useState<CropRegion>(storeCrop);
  const [aspectLocked, setAspectLocked] = useState(false);
  const [aspectValue, setAspectValue] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<string>('Free');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const [intrinsic, setIntrinsic] = useState<{ w: number; h: number } | null>(null);

  // Drive the preview canvas from the editor's media (video or image).
  useEffect(() => {
    const isImg = mediaType === 'image';
    const media = isImg ? mainImage : mainVideo;
    if (!media) return;

    let raf = 0;
    const draw = () => {
      const c = canvasRef.current;
      const mw = isImg ? (media as HTMLImageElement).naturalWidth : (media as HTMLVideoElement).videoWidth;
      const mh = isImg ? (media as HTMLImageElement).naturalHeight : (media as HTMLVideoElement).videoHeight;
      if (c && mw > 0) {
        if (c.width !== mw) c.width = mw;
        if (c.height !== mh) c.height = mh;
        const ctx = c.getContext('2d');
        if (ctx) {
          try {
            ctx.drawImage(media, 0, 0);
          } catch {
            /* black frame OK */
          }
        }
      }
      if (!isImg) {
        raf = requestAnimationFrame(draw);
      }
    };

    if (isImg) {
      const img = media as HTMLImageElement;
      if (img.naturalWidth > 0) {
        setIntrinsic({ w: img.naturalWidth, h: img.naturalHeight });
        draw();
      } else {
        const onLoad = () => {
          setIntrinsic({ w: img.naturalWidth, h: img.naturalHeight });
          draw();
        };
        img.addEventListener('load', onLoad, { once: true });
        return () => img.removeEventListener('load', onLoad);
      }
    } else {
      raf = requestAnimationFrame(draw);
      const v = media as HTMLVideoElement;
      if (v.videoWidth > 0) {
        setIntrinsic({ w: v.videoWidth, h: v.videoHeight });
      } else {
        const onMeta = () => setIntrinsic({ w: v.videoWidth, h: v.videoHeight });
        v.addEventListener('loadedmetadata', onMeta, { once: true });
        return () => {
          cancelAnimationFrame(raf);
          v.removeEventListener('loadedmetadata', onMeta);
        };
      }
    }
    return () => cancelAnimationFrame(raf);
  }, [mediaType, mainVideo, mainImage]);

  const handleCommit = () => {
    setCropRegion(crop);
    onClose();
  };

  // Keyboard shortcuts: Esc to cancel, Enter to commit, Arrow keys to nudge
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault();
        handleCommit();
      } else if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
        (e.target as HTMLElement).tagName !== 'INPUT'
      ) {
        e.preventDefault();
        if (!intrinsic) return;
        const step = (e.shiftKey ? 10 : 1);
        const stepX = step / intrinsic.w;
        const stepY = step / intrinsic.h;
        setCrop((prev) => {
          let nx = prev.x;
          let ny = prev.y;
          if (e.key === 'ArrowLeft') nx = Math.max(0, prev.x - stepX);
          if (e.key === 'ArrowRight') nx = Math.min(1 - prev.width, prev.x + stepX);
          if (e.key === 'ArrowUp') ny = Math.max(0, prev.y - stepY);
          if (e.key === 'ArrowDown') ny = Math.min(1 - prev.height, prev.y + stepY);
          return { ...prev, x: nx, y: ny };
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, intrinsic, crop]);

  // Container aspect ratio mirrors the source video
  const videoAspect = intrinsic ? intrinsic.w / intrinsic.h : 16 / 9;

  // Keep the container box strictly matching the video's aspect ratio without
  // letterbox/pillarbox bars inside it, so crop handle percentages map 1:1 to video pixels.
  useEffect(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const availW = entry.contentRect.width;
      const availH = Math.min(entry.contentRect.height, window.innerHeight * 0.6);
      if (availW <= 0 || availH <= 0 || !videoAspect) return;

      let w = availW;
      let h = w / videoAspect;
      if (h > availH) {
        h = availH;
        w = h * videoAspect;
      }
      setContainerSize({ w: Math.max(10, Math.round(w)), h: Math.max(10, Math.round(h)) });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [videoAspect]);

  // ---- drag handling ----
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    startCrop: CropRegion;
    rect: DOMRect;
    shiftLockedRatio: number | null;
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
      rect: cont.getBoundingClientRect(),
      shiftLockedRatio: e.shiftKey && crop.height > 0 ? crop.width / crop.height : null
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !intrinsic) return;

    const dxNorm = (e.clientX - d.startX) / d.rect.width;
    const dyNorm = (e.clientY - d.startY) / d.rect.height;
    const { startCrop, handle } = d;

    // Determine if aspect constraint applies
    const sourceAspect = intrinsic.w / intrinsic.h;
    let targetWOverH: number | null = null;
    if (aspectLocked && aspectValue != null) {
      targetWOverH = aspectValue / sourceAspect;
    } else if (e.shiftKey) {
      targetWOverH = d.shiftLockedRatio ?? (startCrop.height > 0 ? startCrop.width / startCrop.height : null);
    }

    let { x, y, width, height } = startCrop;

    if (handle === 'move') {
      x = Math.max(0, Math.min(1 - startCrop.width, startCrop.x + dxNorm));
      y = Math.max(0, Math.min(1 - startCrop.height, startCrop.y + dyNorm));
      setCrop({ x, y, width, height });
      return;
    }

    if (!targetWOverH) {
      // Freeform dragging
      setActivePreset('Free');
      switch (handle) {
        case 'left': {
          const fixedRight = startCrop.x + startCrop.width;
          const nx = Math.max(0, Math.min(fixedRight - MIN_NORM, startCrop.x + dxNorm));
          x = nx;
          width = fixedRight - nx;
          break;
        }
        case 'right': {
          width = Math.max(MIN_NORM, Math.min(1 - startCrop.x, startCrop.width + dxNorm));
          break;
        }
        case 'top': {
          const fixedBottom = startCrop.y + startCrop.height;
          const ny = Math.max(0, Math.min(fixedBottom - MIN_NORM, startCrop.y + dyNorm));
          y = ny;
          height = fixedBottom - ny;
          break;
        }
        case 'bottom': {
          height = Math.max(MIN_NORM, Math.min(1 - startCrop.y, startCrop.height + dyNorm));
          break;
        }
        case 'top-left': {
          const fixedRight = startCrop.x + startCrop.width;
          const fixedBottom = startCrop.y + startCrop.height;
          x = Math.max(0, Math.min(fixedRight - MIN_NORM, startCrop.x + dxNorm));
          y = Math.max(0, Math.min(fixedBottom - MIN_NORM, startCrop.y + dyNorm));
          width = fixedRight - x;
          height = fixedBottom - y;
          break;
        }
        case 'top-right': {
          const fixedLeft = startCrop.x;
          const fixedBottom = startCrop.y + startCrop.height;
          y = Math.max(0, Math.min(fixedBottom - MIN_NORM, startCrop.y + dyNorm));
          width = Math.max(MIN_NORM, Math.min(1 - fixedLeft, startCrop.width + dxNorm));
          height = fixedBottom - y;
          break;
        }
        case 'bottom-left': {
          const fixedRight = startCrop.x + startCrop.width;
          const fixedTop = startCrop.y;
          x = Math.max(0, Math.min(fixedRight - MIN_NORM, startCrop.x + dxNorm));
          width = fixedRight - x;
          height = Math.max(MIN_NORM, Math.min(1 - fixedTop, startCrop.height + dyNorm));
          break;
        }
        case 'bottom-right': {
          width = Math.max(MIN_NORM, Math.min(1 - startCrop.x, startCrop.width + dxNorm));
          height = Math.max(MIN_NORM, Math.min(1 - startCrop.y, startCrop.height + dyNorm));
          break;
        }
      }
    } else {
      // Aspect-constrained dragging
      const ratio = targetWOverH;

      switch (handle) {
        case 'bottom-right': {
          const candW = startCrop.width + dxNorm;
          const candH = startCrop.height + dyNorm;
          let nw: number;
          let nh: number;
          if (Math.abs(dxNorm) >= Math.abs(dyNorm * ratio)) {
            nw = Math.max(MIN_NORM, Math.min(1 - startCrop.x, candW));
            nh = nw / ratio;
            if (startCrop.y + nh > 1) {
              nh = 1 - startCrop.y;
              nw = nh * ratio;
            }
          } else {
            nh = Math.max(MIN_NORM, Math.min(1 - startCrop.y, candH));
            nw = nh * ratio;
            if (startCrop.x + nw > 1) {
              nw = 1 - startCrop.x;
              nh = nw / ratio;
            }
          }
          width = Math.max(MIN_NORM, nw);
          height = Math.max(MIN_NORM, nh);
          break;
        }
        case 'top-left': {
          const fixedRight = startCrop.x + startCrop.width;
          const fixedBottom = startCrop.y + startCrop.height;
          const candW = fixedRight - (startCrop.x + dxNorm);
          const candH = fixedBottom - (startCrop.y + dyNorm);
          let nw: number;
          let nh: number;
          if (Math.abs(dxNorm) >= Math.abs(dyNorm * ratio)) {
            nw = Math.max(MIN_NORM, Math.min(fixedRight, candW));
            nh = nw / ratio;
            if (nh > fixedBottom) {
              nh = fixedBottom;
              nw = nh * ratio;
            }
          } else {
            nh = Math.max(MIN_NORM, Math.min(fixedBottom, candH));
            nw = nh * ratio;
            if (nw > fixedRight) {
              nw = fixedRight;
              nh = nw / ratio;
            }
          }
          width = Math.max(MIN_NORM, nw);
          height = Math.max(MIN_NORM, nh);
          x = fixedRight - width;
          y = fixedBottom - height;
          break;
        }
        case 'top-right': {
          const fixedLeft = startCrop.x;
          const fixedBottom = startCrop.y + startCrop.height;
          const candW = startCrop.width + dxNorm;
          const candH = fixedBottom - (startCrop.y + dyNorm);
          let nw: number;
          let nh: number;
          if (Math.abs(dxNorm) >= Math.abs(dyNorm * ratio)) {
            nw = Math.max(MIN_NORM, Math.min(1 - fixedLeft, candW));
            nh = nw / ratio;
            if (nh > fixedBottom) {
              nh = fixedBottom;
              nw = nh * ratio;
            }
          } else {
            nh = Math.max(MIN_NORM, Math.min(fixedBottom, candH));
            nw = nh * ratio;
            if (nw > 1 - fixedLeft) {
              nw = 1 - fixedLeft;
              nh = nw / ratio;
            }
          }
          width = Math.max(MIN_NORM, nw);
          height = Math.max(MIN_NORM, nh);
          x = fixedLeft;
          y = fixedBottom - height;
          break;
        }
        case 'bottom-left': {
          const fixedRight = startCrop.x + startCrop.width;
          const fixedTop = startCrop.y;
          const candW = fixedRight - (startCrop.x + dxNorm);
          const candH = startCrop.height + dyNorm;
          let nw: number;
          let nh: number;
          if (Math.abs(dxNorm) >= Math.abs(dyNorm * ratio)) {
            nw = Math.max(MIN_NORM, Math.min(fixedRight, candW));
            nh = nw / ratio;
            if (nh > 1 - fixedTop) {
              nh = 1 - fixedTop;
              nw = nh * ratio;
            }
          } else {
            nh = Math.max(MIN_NORM, Math.min(1 - fixedTop, candH));
            nw = nh * ratio;
            if (nw > fixedRight) {
              nw = fixedRight;
              nh = nw / ratio;
            }
          }
          width = Math.max(MIN_NORM, nw);
          height = Math.max(MIN_NORM, nh);
          x = fixedRight - width;
          y = fixedTop;
          break;
        }
        case 'right': {
          let nw = Math.max(MIN_NORM, Math.min(1 - startCrop.x, startCrop.width + dxNorm));
          let nh = nw / ratio;
          const centerY = startCrop.y + startCrop.height / 2;
          let ny = centerY - nh / 2;
          if (ny < 0) ny = 0;
          if (ny + nh > 1) ny = 1 - nh;
          if (nh > 1) {
            nh = 1;
            ny = 0;
            nw = nh * ratio;
          }
          width = nw;
          height = nh;
          y = Math.max(0, ny);
          break;
        }
        case 'left': {
          const fixedRight = startCrop.x + startCrop.width;
          let nw = Math.max(MIN_NORM, Math.min(fixedRight, startCrop.width - dxNorm));
          let nh = nw / ratio;
          const centerY = startCrop.y + startCrop.height / 2;
          let ny = centerY - nh / 2;
          if (ny < 0) ny = 0;
          if (ny + nh > 1) ny = 1 - nh;
          if (nh > 1) {
            nh = 1;
            ny = 0;
            nw = nh * ratio;
          }
          width = nw;
          height = nh;
          x = fixedRight - nw;
          y = Math.max(0, ny);
          break;
        }
        case 'bottom': {
          let nh = Math.max(MIN_NORM, Math.min(1 - startCrop.y, startCrop.height + dyNorm));
          let nw = nh * ratio;
          const centerX = startCrop.x + startCrop.width / 2;
          let nx = centerX - nw / 2;
          if (nx < 0) nx = 0;
          if (nx + nw > 1) nx = 1 - nw;
          if (nw > 1) {
            nw = 1;
            nx = 0;
            nh = nw / ratio;
          }
          width = nw;
          height = nh;
          x = Math.max(0, nx);
          break;
        }
        case 'top': {
          const fixedBottom = startCrop.y + startCrop.height;
          let nh = Math.max(MIN_NORM, Math.min(fixedBottom, startCrop.height - dyNorm));
          let nw = nh * ratio;
          const centerX = startCrop.x + startCrop.width / 2;
          let nx = centerX - nw / 2;
          if (nx < 0) nx = 0;
          if (nx + nw > 1) nx = 1 - nw;
          if (nw > 1) {
            nw = 1;
            nx = 0;
            nh = nw / ratio;
          }
          width = nw;
          height = nh;
          x = Math.max(0, nx);
          y = fixedBottom - nh;
          break;
        }
      }
    }

    setCrop({
      x: Math.max(0, Math.min(1 - MIN_NORM, x)),
      y: Math.max(0, Math.min(1 - MIN_NORM, y)),
      width: Math.max(MIN_NORM, Math.min(1 - x, width)),
      height: Math.max(MIN_NORM, Math.min(1 - y, height))
    });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // ---- aspect-ratio preset application ----
  function applyAspectPreset(label: string, ratio: number | null | 'original') {
    setActivePreset(label);
    if (ratio === null) {
      setAspectLocked(false);
      setAspectValue(null);
      return;
    }

    if (ratio === 'original') {
      if (!intrinsic) return;
      const r = intrinsic.w / intrinsic.h;
      setAspectValue(r);
      setAspectLocked(true);
      setCrop(DEFAULT_CROP_REGION);
      return;
    }

    setAspectValue(ratio);
    setAspectLocked(true);
    if (!intrinsic) return;

    const sourceAspect = intrinsic.w / intrinsic.h;
    const targetWOverH = ratio / sourceAspect; // normalized width / height

    // If currently at full frame or near full, center maximum box of that ratio in the video
    const isNearFull = crop.width >= 0.95 && crop.height >= 0.95;
    if (isNearFull) {
      let w: number;
      let h: number;
      if (targetWOverH <= 1) {
        h = 1.0;
        w = targetWOverH;
      } else {
        w = 1.0;
        h = 1.0 / targetWOverH;
      }
      const x = Math.max(0, (1.0 - w) / 2);
      const y = Math.max(0, (1.0 - h) / 2);
      setCrop({ x, y, width: w, height: h });
    } else {
      // User is already focused on a specific region: preserve center of that region
      const centerX = crop.x + crop.width / 2;
      const centerY = crop.y + crop.height / 2;
      let w = Math.max(crop.width, crop.height * targetWOverH);
      let h = w / targetWOverH;
      if (w > 1) {
        w = 1;
        h = w / targetWOverH;
      }
      if (h > 1) {
        h = 1;
        w = h * targetWOverH;
      }
      const x = Math.max(0, Math.min(1 - w, centerX - w / 2));
      const y = Math.max(0, Math.min(1 - h, centerY - h / 2));
      setCrop({ x, y, width: w, height: h });
    }
  }

  // Pixel display values for the X/Y/W/H inputs
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

  // Inset values for the SVG mask and positioning
  const insetTop = `${crop.y * 100}%`;
  const insetLeft = `${crop.x * 100}%`;
  const insetW = `${crop.width * 100}%`;
  const insetH = `${crop.height * 100}%`;

  const isCropped =
    crop.x !== 0 || crop.y !== 0 || crop.width !== 1 || crop.height !== 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-[var(--text)]">{t('side.cropVideo')}</h2>
            {intrinsic && (
              <span className="rounded bg-[var(--fill)] px-2 py-0.5 font-mono text-xs text-[var(--muted)]">
                {px.w} × {px.h} px
              </span>
            )}
            {isCropped && (
              <span className="rounded bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCrop(DEFAULT_CROP_REGION);
                setAspectLocked(false);
                setAspectValue(null);
                setActivePreset('Free');
              }}
              className="flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1 text-xs text-[var(--muted)] hover:bg-[var(--panel-3)] hover:text-[var(--text)]"
              title={t('crop.resetFull')}
            >
              <RotateCcw size={12} />
              {t('crop.resetFull')}
            </button>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--panel-3)] text-[var(--muted)] hover:text-[var(--text)]"
              aria-label={t('common.close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Preview area */}
        <div ref={previewWrapRef} className="flex flex-1 items-center justify-center overflow-hidden p-6 bg-black/40">
          <div
            ref={containerRef}
            className="relative select-none rounded-md bg-black shadow-2xl shrink-0"
            style={
              containerSize
                ? { width: `${containerSize.w}px`, height: `${containerSize.h}px` }
                : {
                    width: `min(100%, calc(60vh * ${videoAspect}))`,
                    height: `min(60vh, calc(100% / ${videoAspect}))`,
                    aspectRatio: String(videoAspect)
                  }
            }
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full rounded-md pointer-events-none"
            />

            {/* Dim overlay outside crop + Rule-of-thirds grid */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <defs>
                <mask id="crop-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={insetLeft} y={insetTop} width={insetW} height={insetH} fill="black" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="black" fillOpacity="0.6" mask="url(#crop-mask)" />
              
              {/* Outer crop border */}
              <rect
                x={insetLeft}
                y={insetTop}
                width={insetW}
                height={insetH}
                fill="none"
                stroke="rgba(52,211,153,0.95)"
                strokeWidth="2"
              />

              {/* Rule of thirds grid lines */}
              <line
                x1={`calc(${insetLeft} + ${insetW} * 0.3333)`}
                y1={insetTop}
                x2={`calc(${insetLeft} + ${insetW} * 0.3333)`}
                y2={`calc(${insetTop} + ${insetH})`}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <line
                x1={`calc(${insetLeft} + ${insetW} * 0.6666)`}
                y1={insetTop}
                x2={`calc(${insetLeft} + ${insetW} * 0.6666)`}
                y2={`calc(${insetTop} + ${insetH})`}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <line
                x1={insetLeft}
                y1={`calc(${insetTop} + ${insetH} * 0.3333)`}
                x2={`calc(${insetLeft} + ${insetW})`}
                y2={`calc(${insetTop} + ${insetH} * 0.3333)`}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <line
                x1={insetLeft}
                y1={`calc(${insetTop} + ${insetH} * 0.6666)`}
                x2={`calc(${insetLeft} + ${insetW})`}
                y2={`calc(${insetTop} + ${insetH} * 0.6666)`}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            </svg>

            {/* Move overlay (whole crop region) */}
            <div
              className="absolute cursor-move"
              style={{ left: insetLeft, top: insetTop, width: insetW, height: insetH }}
              onPointerDown={(e) => onPointerDown('move', e)}
              title={t('crop.dragHint')}
            />

            {/* Corner handles (4 corners) */}
            {/* Top-Left */}
            <div
              className="absolute -ml-3 -mt-3 flex h-6 w-6 cursor-nwse-resize items-center justify-center group"
              style={{ left: insetLeft, top: insetTop }}
              onPointerDown={(e) => onPointerDown('top-left', e)}
            >
              <div className="h-3.5 w-3.5 rounded-sm border-2 border-emerald-400 bg-white shadow-md transition-transform group-hover:scale-125" />
            </div>

            {/* Top-Right */}
            <div
              className="absolute -ml-3 -mt-3 flex h-6 w-6 cursor-nesw-resize items-center justify-center group"
              style={{ left: `calc(${insetLeft} + ${insetW})`, top: insetTop }}
              onPointerDown={(e) => onPointerDown('top-right', e)}
            >
              <div className="h-3.5 w-3.5 rounded-sm border-2 border-emerald-400 bg-white shadow-md transition-transform group-hover:scale-125" />
            </div>

            {/* Bottom-Left */}
            <div
              className="absolute -ml-3 -mt-3 flex h-6 w-6 cursor-nesw-resize items-center justify-center group"
              style={{ left: insetLeft, top: `calc(${insetTop} + ${insetH})` }}
              onPointerDown={(e) => onPointerDown('bottom-left', e)}
            >
              <div className="h-3.5 w-3.5 rounded-sm border-2 border-emerald-400 bg-white shadow-md transition-transform group-hover:scale-125" />
            </div>

            {/* Bottom-Right */}
            <div
              className="absolute -ml-3 -mt-3 flex h-6 w-6 cursor-nwse-resize items-center justify-center group"
              style={{ left: `calc(${insetLeft} + ${insetW})`, top: `calc(${insetTop} + ${insetH})` }}
              onPointerDown={(e) => onPointerDown('bottom-right', e)}
            >
              <div className="h-3.5 w-3.5 rounded-sm border-2 border-emerald-400 bg-white shadow-md transition-transform group-hover:scale-125" />
            </div>

            {/* Edge handles (4 edges) */}
            {/* Top edge */}
            <div
              className="absolute -mt-2.5 flex h-5 cursor-ns-resize items-center justify-center group"
              style={{ left: insetLeft, top: insetTop, width: insetW }}
              onPointerDown={(e) => onPointerDown('top', e)}
            >
              <div className="h-1.5 w-8 rounded-full border border-black/40 bg-white shadow-sm transition-transform group-hover:scale-110" />
            </div>

            {/* Bottom edge */}
            <div
              className="absolute -mt-2.5 flex h-5 cursor-ns-resize items-center justify-center group"
              style={{ left: insetLeft, top: `calc(${insetTop} + ${insetH})`, width: insetW }}
              onPointerDown={(e) => onPointerDown('bottom', e)}
            >
              <div className="h-1.5 w-8 rounded-full border border-black/40 bg-white shadow-sm transition-transform group-hover:scale-110" />
            </div>

            {/* Left edge */}
            <div
              className="absolute -ml-2.5 flex w-5 cursor-ew-resize items-center justify-center group"
              style={{ top: insetTop, left: insetLeft, height: insetH }}
              onPointerDown={(e) => onPointerDown('left', e)}
            >
              <div className="h-8 w-1.5 rounded-full border border-black/40 bg-white shadow-sm transition-transform group-hover:scale-110" />
            </div>

            {/* Right edge */}
            <div
              className="absolute -ml-2.5 flex w-5 cursor-ew-resize items-center justify-center group"
              style={{ top: insetTop, left: `calc(${insetLeft} + ${insetW})`, height: insetH }}
              onPointerDown={(e) => onPointerDown('right', e)}
            >
              <div className="h-8 w-1.5 rounded-full border border-black/40 bg-white shadow-sm transition-transform group-hover:scale-110" />
            </div>
          </div>
        </div>

        {/* Aspect presets pills + Numeric inputs + actions */}
        <div className="shrink-0 border-t border-white/5 bg-[var(--bg)] px-6 py-4 space-y-3">
          {/* Presets row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-[var(--muted)]">{t('crop.aspect')}:</span>
            {ASPECT_PRESETS.map((p) => {
              const isSelected = activePreset === p.label;

              return (
                <button
                  key={p.label}
                  onClick={() => applyAspectPreset(p.label, p.value)}
                  className={
                    'rounded-md px-2.5 py-1 text-xs font-medium transition ' +
                    (isSelected
                      ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                      : 'border border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] hover:bg-[var(--panel-3)] hover:text-[var(--text)]')
                  }
                >
                  {p.value === null
                    ? t('crop.free')
                    : p.value === 'original'
                    ? t('crop.original')
                    : p.label}
                </button>
              );
            })}

            <button
              onClick={() => setAspectLocked((v) => !v)}
              disabled={aspectValue == null}
              className={
                'flex h-7 items-center justify-center rounded-md border px-2 text-xs ml-1 ' +
                (aspectLocked
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] hover:bg-[var(--panel-3)]') +
                ' disabled:opacity-40 disabled:cursor-not-allowed'
              }
              title={aspectLocked ? t('crop.aspectLocked') : t('crop.aspectUnlocked')}
              aria-label={aspectLocked ? t('crop.unlockAspect') : t('crop.lockAspect')}
            >
              {aspectLocked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
          </div>

          {/* Numeric inputs + footer buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-end gap-3">
              <NumericField label="X" value={px.x} onChange={(v) => handleNumericChange('x', v)} disabled={!intrinsic} />
              <NumericField label="Y" value={px.y} onChange={(v) => handleNumericChange('y', v)} disabled={!intrinsic} />
              <NumericField label="W" value={px.w} onChange={(v) => handleNumericChange('w', v)} disabled={!intrinsic} />
              <NumericField label="H" value={px.h} onChange={(v) => handleNumericChange('h', v)} disabled={!intrinsic} />
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <div className="mr-3 text-xs text-[var(--faint)] hidden sm:block">
                {intrinsic ? `${intrinsic.w} × ${intrinsic.h}px source` : ''}
              </div>
              <button
                onClick={onClose}
                className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-4 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-3)]"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCommit}
                className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-xs font-semibold text-[var(--accent-fg)] hover:opacity-90 shadow-sm"
              >
                {t('common.done')}
              </button>
            </div>
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
      <span className="text-[11px] uppercase tracking-wider text-[var(--muted)]">{label}</span>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(0, v));
        }}
        className="w-20 rounded-md border border-[var(--line)] bg-[var(--field)] px-2 py-1 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-40"
      />
    </label>
  );
}
