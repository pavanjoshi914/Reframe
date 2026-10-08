// Border presets: the treatment applied to the recording card's EDGE — a dark
// rim, a hard retro shadow, a stack of pages behind it, a glow, macOS window bezel.
//
// Each preset is two passes rather than one, because the interesting ones live
// on both sides of the card:
//
//   under — painted BEFORE the card, so it shows outside the silhouette
//           (the stack's back pages, retro's offset block, the glow)
//   over  — painted AFTER, sitting in the ring the caller reserved for it
//
// Splitting them this way is what lets the 3D/scene path reuse this at all: a
// card there is rendered flat into an offscreen canvas and textured onto a
// quad, so anything drawn outside its bounds would simply be cut off. That path
// runs `over` only, and the outside-the-card presets degrade to no border
// rather than to a clipped mess.
//
// THICKNESS IS A PERCENTAGE OF THE CARD, not a pixel count. Every band below is
// a fraction of `T`, which the caller derives from the card's short side. Quoted
// in px-at-1080p a rim is only correct at one card size: the same 14px reads as
// a heavy frame on a small picture-in-picture card and as a hairline on a
// full-width one, and it has to be rescaled by hand for every export
// resolution. A percentage is right at every size by construction.

export type BorderId =
  | 'default'
  | 'macWindow'
  | 'liquidGlass'
  | 'darkGlass'
  | 'gradient'
  | 'outline'
  | 'glow'
  | 'retro'
  | 'stack'
  | 'metal3d';

export const BORDER_IDS: BorderId[] = [
  'default',
  'macWindow',
  'liquidGlass',
  'darkGlass',
  'gradient',
  'outline',
  'glow',
  'retro',
  'stack',
  'metal3d'
];

export const DEFAULT_BORDER: BorderId = 'default';
/** Percent of the card's short side. The reference apps sit under 1%. */
export const DEFAULT_BORDER_WIDTH_PCT = 0.8;
export const DEFAULT_BORDER_OPACITY = 100;

/** A saved project may name a preset that no longer exists. */
export function normalizeBorder(id: unknown): BorderId {
  return BORDER_IDS.includes(id as BorderId) ? (id as BorderId) : DEFAULT_BORDER;
}

// Human-friendly labels for presets
export const BORDER_LABELS: Record<BorderId, string> = {
  default: 'None',
  macWindow: 'macOS Window',
  liquidGlass: 'Liquid Glass',
  darkGlass: 'Dark Glass',
  gradient: 'Aurora',
  outline: 'Dual Outline',
  glow: 'Neon Glow',
  retro: 'Retro Block',
  stack: 'Paper Stack',
  metal3d: '3D Bezel'
};

/** null = keep each preset's own colours. Anything else tints the main band. */
export const BORDER_COLORS: (string | null)[] = [
  null, '#ffffff', '#0b0d12', '#f59e0b', '#22c55e',
  '#14b8a6', '#3b82f6', '#a855f7', '#ec4899'
];

export type BorderStyle = {
  /** Thickness as a percent of the card's short side. */
  widthPct: number;
  /** 0..100, applied to the whole treatment. */
  opacity: number;
  /** Overrides the preset's own colour when set. */
  color: string | null;
  /** Default roundness in px when picking or resetting this preset. */
  roundnessPx?: number;
};

/**
 * Each preset's own starting values.
 *
 * One shared style across every preset meant switching from a 5% Retro frame to
 * a glass rim left the glass 5% thick. A preset is a LOOK, and thickness and
 * opacity are part of that look, so picking one seeds all three.
 */
export const BORDER_DEFAULTS: Record<BorderId, BorderStyle> = {
  default:     { widthPct: 1.4, opacity: 35,  color: null },
  macWindow:   { widthPct: 1.8, opacity: 100, color: '#181920', roundnessPx: 14 },
  liquidGlass: { widthPct: 1.4, opacity: 20,  color: '#ffffff', roundnessPx: 23 },
  darkGlass:   { widthPct: 1.4, opacity: 20,  color: '#0b0d12', roundnessPx: 23 },
  gradient:    { widthPct: 1.6, opacity: 45,  color: null, roundnessPx: 23 },
  outline:     { widthPct: 1.8, opacity: 85,  color: null },
  glow:        { widthPct: 2.5, opacity: 60,  color: '#3b82f6', roundnessPx: 23 },
  retro:       { widthPct: 1.9, opacity: 25,  color: '#ffffff', roundnessPx: 23 },
  stack:       { widthPct: 1.2, opacity: 35,  color: '#ffffff', roundnessPx: 23 },
  metal3d:     { widthPct: 1.2, opacity: 100, color: '#0b0d12', roundnessPx: 23 }
};

export const DEFAULT_BORDER_STYLE: BorderStyle = {
  widthPct: DEFAULT_BORDER_WIDTH_PCT,
  opacity: DEFAULT_BORDER_OPACITY,
  color: null
};

/** Thickness in output pixels for a card of this size. */
export function borderThickness(w: number, h: number, widthPct: number): number {
  return Math.max(0, (widthPct / 100) * Math.min(w, h));
}

/**
 * How far the rim extends OUTSIDE the picture, in output pixels.
 *
 * A border adds to the card's footprint; it never eats into the recording.
 * Thickening it grows the frame outward, the way a mount grows around a
 * photograph — dialling it up and watching it creep inward over the picture is
 * the wrong mental model and the wrong result.
 */
export function borderOutset(id: BorderId, w: number, h: number, widthPct: number): number {
  if (id === 'default' || id === 'glow' || id === 'macWindow') return 0;
  const T = borderThickness(w, h, widthPct);
  if (id === 'retro') return T * 0.4;
  if (id === 'stack') return T * 0.35;
  if (id === 'outline') return T * 0.8;
  return T;
}

/**
 * Traces a rectangle with independent corner radii (top-left, top-right, bottom-right, bottom-left).
 */
export function roundedRectCorners(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  rtl: number, rtr: number, rbr: number, rbl: number
) {
  const maxR = Math.min(w, h) / 2;
  const tl = Math.max(0, Math.min(rtl, maxR));
  const tr = Math.max(0, Math.min(rtr, maxR));
  const br = Math.max(0, Math.min(rbr, maxR));
  const bl = Math.max(0, Math.min(rbl, maxR));

  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
  else ctx.lineTo(x, y);
  ctx.closePath();
}

/** Height of the macOS window title bar in pixels, scaled to canvas resolution. */
export function macTitleBarHeight(outH: number, _widthPct: number = 1.8, _roundnessPx: number = 14): number {
  const sc = Math.max(0.65, outH / 1080);
  return Math.round(72 * sc);
}

/** Paints the authentic macOS title bar with acrylic finish and traffic light controls. */
export function paintMacTitleBar(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, tbH: number, r: number,
  st: BorderStyle = DEFAULT_BORDER_STYLE
) {
  if (tbH <= 0 || w <= 0) return;
  const base = st.color ?? '#181920';
  const light = isLight(base);
  const alpha = Math.min(1, Math.max(0, st.opacity) / 100);

  ctx.save();
  ctx.globalAlpha *= alpha;

  // Clip to title bar top corners
  roundedRectCorners(ctx, x, y, w, tbH, r, r, 0, 0);
  ctx.clip();

  // 1. Title bar background
  if (light) {
    // For white/light title bars, keep pure flat background so it blends seamlessly into white content
    ctx.fillStyle = base;
  } else {
    // Subtle modern dark acrylic gradient
    const tbGrad = ctx.createLinearGradient(x, y, x, y + tbH);
    tbGrad.addColorStop(0, shade(base, 0.08));
    tbGrad.addColorStop(1, shade(base, -0.04));
    ctx.fillStyle = tbGrad;
  }
  ctx.fillRect(x, y, w, tbH);

  // 2. Traffic light buttons (Close, Minimize, Zoom) - CleanShot Studio proportions
  const dotR = Math.max(5.5, Math.min(8.0, tbH * 0.105));
  const dotY = y + Math.round(tbH * 0.46);
  const startX = x + Math.max(r * 0.8 + 12, Math.round(tbH * 0.46));
  const dotSpacing = Math.max(18, Math.round(dotR * 3.2));

  const dots = [
    { fill: '#ff5f56', stroke: '#e0443e' }, // Close (Red)
    { fill: '#ffbd2e', stroke: '#dea123' }, // Minimize (Yellow)
    { fill: '#27c93f', stroke: '#1aab29' }  // Zoom (Green)
  ];

  dots.forEach((dot, idx) => {
    const dotX = startX + idx * dotSpacing;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = dot.fill;
    ctx.fill();
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = dot.stroke;
    ctx.stroke();

    // Specular shine on upper half of dot
    ctx.beginPath();
    ctx.arc(dotX, dotY - dotR * 0.25, dotR * 0.5, 0, Math.PI, true);
    ctx.fillStyle = 'rgba(255,255,255,0.40)';
    ctx.fill();
  });

  ctx.restore();
}

/** Outer window hairline bezel framing the entire macOS window. */
export function paintMacWindowBezel(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
  st: BorderStyle = DEFAULT_BORDER_STYLE
) {
  const base = st.color ?? '#181920';
  const light = isLight(base);
  const alpha = Math.min(1, Math.max(0, st.opacity) / 100);
  const strokeW = Math.max(1, Math.min(6, Math.round((st.widthPct ?? 1.8) * 1.0)));

  ctx.save();
  ctx.globalAlpha *= alpha;
  roundedRectCorners(ctx, x, y, w, h, r, r, r, r);
  ctx.lineWidth = strokeW;
  ctx.strokeStyle = light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)';
  ctx.stroke();
  ctx.restore();
}

// Rounded-rect tracer matching the card outline.
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// A band of `width`, sitting `inset` in from the card edge.
function band(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
  inset: number, width: number, style: string | CanvasGradient
) {
  const d = inset + width / 2;
  if (width <= 0 || w <= d * 2 || h <= d * 2) return;
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  rr(ctx, x + d, y + d, w - d * 2, h - d * 2, r - d);
  ctx.stroke();
}

/** Perceptual luminance, to decide whether a rim needs a dark or light lip. */
function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

/**
 * Mix a colour toward white (`k > 0`) or black (`k < 0`), |k| in 0..1.
 */
function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const t = k < 0 ? 0 : 255;
  const a = Math.min(1, Math.abs(k));
  const ch = (v: number) => Math.round(v + (t - v) * a);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** #rrggbb → rgba() at the given alpha. */
function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Which presets emit light, in what colour, and with what falloff.
 */
export function emissionSpec(
  id: BorderId,
  st: BorderStyle
): { color: string; passes: readonly (readonly [number, number])[] } | null {
  // Glow: luminous ambient light source with multi-tier Gaussian falloff
  if (id === 'glow') return { color: st.color ?? '#60a5fa', passes: [[1.4, 0.65], [3.8, 0.42], [7.5, 0.22]] };
  // Metal 3D: subtle anisotropic bounce off lit edges
  if (id === 'metal3d') return { color: st.color ?? '#9fb4d0', passes: [[1.1, 0.26], [3.4, 0.16]] };
  // Aurora Gradient: vibrant atmospheric ambient light
  if (id === 'gradient') return { color: st.color ?? '#a855f7', passes: [[1.4, 0.50], [4.2, 0.28]] };
  return null;
}

/**
 * Additive luminous light emission around a rounded rect for flat 2D cards.
 * Uses hardware-accelerated blur filters and additive blending matching the 3D rotation path.
 */
export function paintEmissionFlat(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
  border: BorderId,
  st: BorderStyle = DEFAULT_BORDER_STYLE
) {
  const spec = emissionSpec(border, st);
  if (!spec) return;
  const alpha = Math.min(1, Math.max(0, st.opacity) / 100);
  const T = borderThickness(w, h, st.widthPct);
  if (alpha <= 0 || T <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [reach, strength] of spec.passes) {
    ctx.filter = `blur(${Math.max(0.5, (T * reach) / 2)}px)`;
    ctx.globalAlpha = Math.min(1, strength * alpha);
    ctx.fillStyle = spec.color;
    rr(ctx, x, y, w, h, r);
    ctx.fill();
  }
  ctx.filter = 'none';
  ctx.restore();
}

/** Painted before the card, outside its silhouette. Flat path only. */
export function paintBorderUnder(
  ctx: CanvasRenderingContext2D,
  id: BorderId,
  x: number, y: number, w: number, h: number, r: number,
  st: BorderStyle = DEFAULT_BORDER_STYLE,
  opts: { thickness?: number } = {}
) {
  if (id === 'default' || id === 'darkGlass' || id === 'outline' || id === 'glow' || id === 'macWindow') return;
  const T = borderThickness(w, h, st.widthPct);
  if (T <= 0 || st.opacity <= 0) return;

  const bo = (opts.thickness !== undefined && opts.thickness > 0) ? opts.thickness : borderOutset(id, w, h, st.widthPct);
  // Reconstruct card bounds: x, y, w, h passed in are ox, oy, ow, oh (card outset by bo)
  const px = x + bo, py = y + bo, pw = w - bo * 2, ph = h - bo * 2, pr = Math.max(0, r - bo);
  if (pw <= 0 || ph <= 0) return;

  ctx.save();
  ctx.globalAlpha = Math.min(1, st.opacity / 100);

  if (id === 'retro') {
    // Hard brutalist drop block down-right
    const d = T * 1.4;
    ctx.fillStyle = st.color ?? '#0b0d12';
    rr(ctx, px + d, py + d, pw, ph, pr);
    ctx.fill();
  } else if (id === 'stack') {
    // Two stepped pages peeking out behind
    const base = st.color ?? '#ffffff';
    for (const [k, alpha] of [[2, 0.30], [1, 0.55]] as const) {
      const off = T * 1.6 * k;
      ctx.fillStyle = rgba(base, alpha);
      rr(ctx, px + off * 0.6, py - off, pw - off * 0.2, ph, pr);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Painted after the card, filling the ring reserved for it. */
export function paintBorderOver(
  ctx: CanvasRenderingContext2D,
  id: BorderId,
  x: number, y: number, w: number, h: number, r: number,
  st: BorderStyle = DEFAULT_BORDER_STYLE,
  opts: { thickness?: number } = {}
) {
  if (id === 'default' || id === 'macWindow') return;
  const T = (opts.thickness !== undefined && opts.thickness > 0) ? opts.thickness : borderThickness(w, h, st.widthPct);
  if (T <= 0 || st.opacity <= 0) return;

  ctx.save();
  ctx.filter = 'none';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.globalAlpha = Math.min(1, st.opacity / 100);

  const hair = Math.max(1, T * 0.14);
  const tint = st.color;

  if (id === 'gradient') {
    // Radiant multi-stop Aurora gradient with outer and inner specular hairlines
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    if (tint) {
      grad.addColorStop(0, shade(tint, 0.45));
      grad.addColorStop(0.35, tint);
      grad.addColorStop(0.7, shade(tint, -0.35));
      grad.addColorStop(1, shade(tint, 0.25));
    } else {
      grad.addColorStop(0, '#06b6d4');   // Cyan
      grad.addColorStop(0.25, '#3b82f6'); // Blue
      grad.addColorStop(0.5, '#8b5cf6');  // Purple
      grad.addColorStop(0.75, '#ec4899'); // Pink
      grad.addColorStop(1, '#f59e0b');    // Amber
    }

    band(ctx, x, y, w, h, r, 0, T, grad);
    // Outer specular hairline
    band(ctx, x, y, w, h, r, 0, hair, 'rgba(255,255,255,0.60)');
    // Inner contrast crease
    band(ctx, x, y, w, h, r, Math.max(0, T - hair), hair, 'rgba(0,0,0,0.35)');

  } else if (id === 'outline') {
    // Dual Outline: precision architectural hairline frame
    const base = tint ?? '#ffffff';
    const light = isLight(base);
    const outerW = Math.max(1, T * 0.38);
    const innerW = Math.max(1, T * 0.22);
    const gap = Math.max(1.5, T * 0.35);

    band(ctx, x, y, w, h, r, 0, outerW, rgba(base, 0.95));
    band(ctx, x, y, w, h, r, outerW + gap, innerW, rgba(base, light ? 0.65 : 0.45));

  } else if (id === 'darkGlass' || id === 'liquidGlass') {
    // Liquid glass with corner refraction gradient and inner bevel lip
    const base = tint ?? (id === 'liquidGlass' ? '#ffffff' : '#0b0d12');
    const light = isLight(base);

    const glassGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    if (light) {
      glassGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
      glassGrad.addColorStop(0.5, 'rgba(255,255,255,0.68)');
      glassGrad.addColorStop(1, 'rgba(235,242,255,0.88)');
    } else {
      glassGrad.addColorStop(0, shade(base, 0.20));
      glassGrad.addColorStop(0.5, rgba(base, 0.90));
      glassGrad.addColorStop(1, shade(base, -0.25));
    }

    band(ctx, x, y, w, h, r, 0, T, glassGrad);
    band(ctx, x, y, w, h, r, 0, hair, light ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.32)');
    band(
      ctx, x, y, w, h, r, Math.max(0, T - T * 0.22), T * 0.22,
      light ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.24)'
    );

  } else if (id === 'glow') {
    // Luminous neon filament on the outer lip that anchors the emission pass
    const base = tint ?? '#60a5fa';
    const filamentW = Math.max(1.2, T * 0.16);
    band(ctx, x, y, w, h, r, 0, filamentW, rgba(base, 0.92));
    band(ctx, x, y, w, h, r, 0, filamentW * 0.5, 'rgba(255,255,255,0.75)');

  } else if (id === 'retro') {
    band(ctx, x, y, w, h, r, 0, T, tint ?? '#0b0d12');

  } else if (id === 'stack') {
    band(ctx, x, y, w, h, r, 0, T, tint ? rgba(tint, 0.95) : 'rgba(255,255,255,0.95)');
    band(ctx, x, y, w, h, r, 0, hair, 'rgba(0,0,0,0.30)');

  } else if (id === 'metal3d') {
    // Machined chamfered bezel with dual facets
    const base = tint ?? '#9fb4d0';
    const outer = T * 0.55;
    const inner = T - outer;
    const lit = shade(base, 0.72);
    const dim = shade(base, -0.66);

    const gOut = ctx.createLinearGradient(x, y, x + w, y + h);
    gOut.addColorStop(0, lit);
    gOut.addColorStop(0.45, base);
    gOut.addColorStop(1, dim);
    band(ctx, x, y, w, h, r, 0, outer, gOut);

    const gIn = ctx.createLinearGradient(x, y, x + w, y + h);
    gIn.addColorStop(0, dim);
    gIn.addColorStop(0.55, shade(base, -0.22));
    gIn.addColorStop(1, lit);
    band(ctx, x, y, w, h, r, outer, inner, gIn);

    band(ctx, x, y, w, h, r, 0, hair, 'rgba(255,255,255,0.55)');
    band(ctx, x, y, w, h, r, Math.max(0, outer - hair / 2), hair, 'rgba(0,0,0,0.38)');
    band(ctx, x, y, w, h, r, Math.max(0, T - hair), hair * 1.6, 'rgba(0,0,0,0.45)');
  }

  ctx.restore();
}
