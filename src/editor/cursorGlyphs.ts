// Synthetic-cursor glyphs, shared by the compositor and the sidebar picker.
//
// Each glyph is SVG path data in an ~18-unit-tall design space with the
// ORIGIN AT THE HOTSPOT — the exact point the pointer is "at". Arrows put the
// origin at their tip; the I-beam and the fun pointers are centred on it. The
// compositor feeds `d` to Path2D and the picker feeds the same string to an
// <svg>, so a tile can never drift from what actually renders.
//
// `view` is the SVG viewBox the picker uses to frame that glyph.

export type CursorGlyph = {
  d: string;
  view: string;
  /** Drawn as a text glyph (emoji) instead of a filled path. */
  char?: string;
};

export const CURSOR_GLYPHS: Record<string, CursorGlyph> = {
  // Classic OS-style arrow — straight edges and sharp corners, exactly as it
  // was before the glyph rewrite. Easing these corners with curves (tried, and
  // reverted) makes the silhouette read as subtly bent; the crispness comes
  // from the outline being painted underneath the fill, not from the geometry.
  system: {
    d: 'M0 0 L0 16 L3.5 12.5 L6 18 L8 17 L5.5 11.5 L11 11.5 Z',
    view: '-1.5 -1.5 15 22'
  },
  // Bolder, stylized arrow.
  arrow: {
    d: 'M0 0 L0 19 L4.6 14.8 L7.4 21 L10.2 19.8 L7.3 13.9 L13.2 12.2 Z',
    view: '-1.5 -1.5 17 25'
  },
  // Fully rounded, evenly weighted pointer — the contemporary demo-tool look.
  modern: {
    d:
      'M0.9 0.5 Q0 0 0 1.05 L0 15.5 Q0 16.9 1.15 16.05 L4.2 13.5 ' +
      'Q4.85 13.05 5.2 13.8 L7.3 19.2 Q7.65 20 8.45 19.65 L9.85 19.1 ' +
      'Q10.65 18.75 10.3 17.95 L8.25 12.75 L11.9 12.75 Q13.1 12.75 12.2 11.9 Z',
    view: '-1.5 -1.5 16 23'
  },
  // Slim, elongated arrow.
  sleek: {
    d: 'M0 0 L0 20.5 L3.1 15.6 L5.5 20.8 L7.1 20 L4.8 15 L9.4 13.7 Z',
    view: '-1.5 -1.5 13 24'
  },
  // Stepped hypotenuse — the low-res pointer of early desktops.
  retro: {
    d:
      'M0 0 L0 16.5 L3.4 13.2 L6.2 19.4 L8.6 18.3 L6 12.6 L10.8 12.6 L10.8 10.4 ' +
      'L8.6 10.4 L8.6 8.2 L6.4 8.2 L6.4 6 L4.2 6 L4.2 3.8 L2 3.8 L2 1.6 Z',
    view: '-1.5 -1.5 14 23'
  },
  // Pointing hand: index finger up (hotspot at the fingertip), three folded
  // knuckles to its right and a thumb bulge on the left.
  hand: {
    d:
      'M-1.9 2.1 A1.9 1.9 0 0 1 1.9 2.1 L1.9 9.1 C2.3 8.5 3.6 8.5 4 9.1 L4 10.3 ' +
      'C4.4 9.7 5.7 9.7 6.1 10.4 L6.1 11.5 C6.5 11 7.7 11.1 8 11.8 L8 15.6 ' +
      'C8 18.6 5.9 20.8 3.1 20.8 L0 20.8 C-2.2 20.8 -4 19.6 -4.8 17.6 L-6.4 13.8 ' +
      'C-6.8 12.9 -6.4 11.9 -5.5 11.6 C-4.7 11.3 -3.8 11.7 -3.4 12.5 L-2.6 14.1 ' +
      'L-1.9 14.1 Z',
    view: '-8 -1.5 17 24'
  },
  // Text I-beam, centred on the hotspot.
  beam: {
    d:
      'M-2.6 -8 L2.6 -8 L2.6 -6.6 L0.9 -6.6 L0.9 6.6 L2.6 6.6 L2.6 8 L-2.6 8 ' +
      'L-2.6 6.6 L-0.9 6.6 L-0.9 -6.6 L-2.6 -6.6 Z',
    view: '-5 -10 10 20'
  },
  // Paw print — pad plus four toes, centred on the hotspot.
  paw: {
    d:
      'M-5.2 3.5 a5.2 4.3 0 1 0 10.4 0 a5.2 4.3 0 1 0 -10.4 0 Z ' +
      'M-6.5 -2.6 a1.9 1.9 0 1 0 3.8 0 a1.9 1.9 0 1 0 -3.8 0 Z ' +
      'M-3.5 -5.4 a1.9 1.9 0 1 0 3.8 0 a1.9 1.9 0 1 0 -3.8 0 Z ' +
      'M0.1 -5.4 a1.9 1.9 0 1 0 3.8 0 a1.9 1.9 0 1 0 -3.8 0 Z ' +
      'M2.9 -2.6 a1.9 1.9 0 1 0 3.8 0 a1.9 1.9 0 1 0 -3.8 0 Z',
    view: '-8 -8.5 16 17'
  },
  // Emoji pointer — drawn as a text glyph, so it keeps its own colours.
  emoji: { d: '', view: '0 0 20 20', char: '👆' }
};

/** Ring and dot are drawn procedurally (they scale as circles, not paths). */
export const CURSOR_CIRCLE_STYLES = new Set(['ring', 'dot']);

export type CursorStyleId =
  | 'system'
  | 'arrow'
  | 'modern'
  | 'sleek'
  | 'retro'
  | 'hand'
  | 'beam'
  | 'ring'
  | 'dot'
  | 'paw'
  | 'emoji';

/** Picker order — plain pointers first, then shapes, then the playful ones. */
export const CURSOR_STYLE_IDS: CursorStyleId[] = [
  'system', 'arrow', 'modern', 'sleek',
  'retro', 'hand', 'beam', 'ring',
  'dot', 'paw', 'emoji'
];

// How long the pointer must sit still before it starts fading, and how long
// the fade takes. Only used when "Hide when idle" is on.
export const CURSOR_IDLE_MS = 1500;
export const CURSOR_IDLE_FADE_MS = 400;
// Squared distance (in normalized 0..1 frame coords) that counts as movement —
// about 4px on a 1920-wide frame, so hand-jitter doesn't keep it awake.
export const CURSOR_MOVE_EPS_SQ = 4e-6;
