// Border presets: the treatment applied to the recording card's EDGE — a dark
// rim, a hard retro shadow, a stack of pages behind it, a glow.
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

export type BorderId = 'default' | 'darkGlass' | 'liquidGlass' | 'retro' | 'stack' | 'glow';

export const BORDER_IDS: BorderId[] = ['default', 'darkGlass', 'liquidGlass', 'retro', 'stack', 'glow'];

export const DEFAULT_BORDER: BorderId = 'default';
/** Percent of the card's short side. The reference apps sit under 1%. */
export const DEFAULT_BORDER_WIDTH_PCT = 0.8;
export const DEFAULT_BORDER_OPACITY = 100;

/** A saved project may name a preset that no longer exists. */
export function normalizeBorder(id: unknown): BorderId {
  return BORDER_IDS.includes(id as BorderId) ? (id as BorderId) : DEFAULT_BORDER;
}

// English-only, matching the rotation and scene presets — none of the other
// locales translate that family.
export const BORDER_LABELS: Record<BorderId, string> = {
  default: 'Default',
  darkGlass: 'Dark Glass',
  liquidGlass: 'Liquid Glass',
  retro: 'Retro',
  stack: 'Stack',
  glow: 'Glow'
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
};

/**
 * Each preset's own starting values.
 *
 * One shared style across every preset meant switching from a 5% Retro frame to
 * a glass rim left the glass 5% thick. A preset is a LOOK, and thickness and
 * opacity are part of that look, so picking one seeds all three.
 */
export const BORDER_DEFAULTS: Record<BorderId, BorderStyle> = {
  default:     { widthPct: 1.4, opacity: 35, color: null },
  darkGlass:   { widthPct: 1.4, opacity: 35, color: '#0b0d12' },
  liquidGlass: { widthPct: 1.4, opacity: 35, color: '#ffffff' },
  retro:       { widthPct: 5,   opacity: 35, color: '#ffffff' },
  stack:       { widthPct: 5,   opacity: 35, color: '#ffffff' },
  // Thickness is the glow's REACH and opacity its brightness — there is no rim
  // to size, so the same two sliders drive the light instead.
  glow:        { widthPct: 2.5, opacity: 60, color: '#3b82f6' }
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
 *
 * The ring this reserves is exactly what the `over` pass fills, so a preset
 * that wants a lighter rim asks for a narrower ring here rather than painting a
 * thin line inside a wide one and leaving a gap.
 */
export function borderOutset(id: BorderId, w: number, h: number, widthPct: number): number {
  // Glow draws no rim at all, so it takes no room — asking for a ring it never
  // fills is what left a gap between the picture and its own light.
  if (id === 'default' || id === 'glow') return 0;
  const T = borderThickness(w, h, widthPct);
  if (id === 'retro') return T * 0.4;
  if (id === 'stack') return T * 0.35;
  return T;
}

// A local copy of export.ts's rounded-rect tracer. Importing it back from
// export.ts would make the two modules circular (export.ts imports this one),
// and the outline has to match the card's clip path exactly or the rim sits a
// fraction off the corner it is supposed to trace.
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

// A band of `width`, sitting `inset` in from the card edge. A canvas stroke
// straddles its path, so tracing the card outline directly would spill half the
// line beyond the edge — where the flat path's clip eats it and the 3D path's
// texture doesn't have it. Offset by inset + width/2 and pull the corner radius
// in by the same amount, or the corners bulge relative to the straight runs.
//
// `inset` is what lets a preset stack bands ACROSS the rim's thickness — a
// bright line on the inner lip, a hairline right on the outside — instead of
// every layer starting from the edge and painting over the one before it.
function band(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
  inset: number, width: number, style: string
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

/** #rrggbb → rgba() at the given alpha, so a picked colour can be layered. */
function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Painted before the card, outside its silhouette. Flat path only. */
export function paintBorderUnder(
  ctx: CanvasRenderingContext2D,
  id: BorderId,
  x: number, y: number, w: number, h: number, r: number,
  st: BorderStyle = DEFAULT_BORDER_STYLE,
  opts: { thickness?: number } = {}
) {
  if (id === 'default' || id === 'darkGlass') return;
  const T = opts.thickness ?? borderThickness(w, h, st.widthPct);
  if (T <= 0 || st.opacity <= 0) return;

  // Everything here is cast from the PICTURE's rect, never the grown card's.
  // These shapes are opaque — a black block, white pages, a black disc thrown
  // only for its shadow — and the picture covers the picture rect exactly. Draw
  // them at the card's outer rect instead and their fill stands in the ring the
  // rim is about to paint: a translucent rim over solid black is a black line,
  // which is what Glow at 40% opacity was showing.
  const px = x + T, py = y + T, pw = w - T * 2, ph = h - T * 2, pr = Math.max(0, r - T);
  if (pw <= 0 || ph <= 0) return;

  ctx.save();
  ctx.globalAlpha = Math.min(1, st.opacity / 100);

  if (id === 'retro') {
    // A hard, un-blurred block offset down-right — the print/mid-century look,
    // deliberately not a soft drop shadow. The offset tracks the thickness, so
    // the slider moves the whole effect rather than only its outline.
    const d = T * 1.4;
    ctx.fillStyle = st.color ?? '#0b0d12';
    rr(ctx, px + d, py + d, pw, ph, pr);
    ctx.fill();
  } else if (id === 'stack') {
    // Two pages peeking out behind, each smaller and fainter, so the card reads
    // as the top of a pile. They step up AND to the right: offsetting straight
    // up left a grey bar sitting above the card rather than pages behind it.
    const base = st.color ?? '#ffffff';
    for (const [k, alpha] of [[2, 0.30], [1, 0.55]] as const) {
      const off = T * 1.6 * k;
      ctx.fillStyle = rgba(base, alpha);
      rr(ctx, px + off * 0.6, py - off, pw - off * 0.2, ph, pr);
      ctx.fill();
    }
  } else if (id === 'glow') {
    // Emission, not a painted halo.
    //
    // Light ADDS to what it falls on — a lamp over a red wall gives a brighter
    // red, never a grey one. `lighter` is canvas's additive blend, so the glow
    // sums with the background instead of covering it, and a coloured glow
    // tints whatever it lands on the way real light would.
    //
    // Two passes, because emission is not one blur: a tight bright core where
    // the source is, and a wide dim falloff around it. A single radius reads as
    // a sticker of fog; the pair reads as something luminous.
    const glow = st.color ?? '#60a5fa';
    ctx.globalCompositeOperation = 'lighter';
    for (const [reach, strength] of [[1.6, 0.55], [5.0, 0.35]] as const) {
      ctx.shadowColor = rgba(glow, strength);
      ctx.shadowBlur = T * reach;
      ctx.fillStyle = '#000';   // invisible under `lighter`; only its shadow lands
      rr(ctx, px, py, pw, ph, pr);
      ctx.fill();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
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
  if (id === 'default') return;
  // The caller grew the card to make room for the rim, so it already knows the
  // thickness; recomputing from the enlarged box gives a different number and
  // creeps the ring back over the picture.
  const T = opts.thickness ?? borderThickness(w, h, st.widthPct);
  if (T <= 0 || st.opacity <= 0) return;

  ctx.save();
  ctx.filter = 'none';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.globalAlpha = Math.min(1, st.opacity / 100);

  const hair = Math.max(1, T * 0.14);
  const tint = st.color;

  if (id === 'darkGlass' || id === 'liquidGlass') {
    // Same material, opposite ink: Dark Glass is near-black, Liquid Glass is
    // white. The lip has to contrast with whichever it is, or a white rim gets
    // a white highlight and reads as a flat slab.
    const base = tint ?? (id === 'liquidGlass' ? '#ffffff' : '#0b0d12');
    const light = isLight(base);
    band(ctx, x, y, w, h, r, 0, T, rgba(base, 0.85));
    band(
      ctx, x, y, w, h, r, Math.max(0, T - T * 0.2), T * 0.2,
      light ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.22)'
    );
  } else if (id === 'retro') {
    band(ctx, x, y, w, h, r, 0, T, tint ?? '#0b0d12');
  } else if (id === 'stack') {
    band(ctx, x, y, w, h, r, 0, T, tint ? rgba(tint, 0.95) : 'rgba(255,255,255,0.95)');
    // A dark hairline on the outermost pixels: a white rim over a white page is
    // white over white at every opacity, and this is what separates them.
    band(ctx, x, y, w, h, r, 0, hair, 'rgba(0,0,0,0.30)');
  }  // glow paints nothing here — its light lives entirely in the under pass

  ctx.restore();
}
