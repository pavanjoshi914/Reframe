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
  /**
   * Halo weight multiplier. The renderer sizes the visible outline at ~10% of
   * the glyph height (matched to a real system pointer); this nudges it per
   * glyph — the beam and hand sit a little lighter so their interior detail
   * stays legible. Defaults to 1.
   */
  weight?: number;
  /**
   * When set, `d` is a CENTRELINE and the glyph is drawn by stroking it at this
   * width (glyph units) with round caps and joins, instead of filling it. The
   * text caret needs this: it is a uniform-width line — stem, two curved serif
   * arms, a crossbar — and expressing that as a filled outline is what made it
   * come out as flat blocks that the fill-rounding then fattened. A stroked
   * centreline gives the smooth sweeps for free.
   */
  stroke?: number;
  /**
   * Interior line work, stroked in the OUTLINE colour on top of the fill —
   * the finger separations on the pointing hand, for instance. It has to be a
   * separate path drawn after the fill: as a subpath of `d` it would sit under
   * the fill (the glyph is painted stroke-then-fill so the outline reads as a
   * halo) and vanish.
   */
  detail?: string;
};

export const CURSOR_GLYPHS: Record<string, CursorGlyph> = {
  // Classic OS-style arrow — straight edges and sharp corners, exactly as it
  // was before the glyph rewrite. Easing these corners with curves (tried, and
  // reverted) makes the silhouette read as subtly bent; the crispness comes
  // from the outline being painted underneath the fill, not from the geometry.
  system: {
    // Outline weight matched to a real system pointer: 5.5% of the glyph
    // height against the 4.0% a default stroke gives. Because the outline is
    // stroked UNDER the fill with round joins, a heavier one also rounds the
    // silhouette — which is what stops the arrow reading as sharp and thin.
    // Proportions read off a real system pointer, row by row: aspect h/w 1.80,
    // the head reaching full width at 57% of the height, the tail starting at
    // 78% and 0.30 of the width across. The earlier arrow was 5% wider with a
    // head that ran to 62% and a tail that only began at 88% — which is what
    // read as fat with a stubby tail.
    weight: 1.0,
    d:
      'M 0.0 0.0 L 0.0 13.86 L 3.99 14.22 L 5.48 17.46 L 8.38 16.56 L 5.48 10.8 L 9.67 10.26 Z',
    view: '-1.5 -1.5 13 22'
  },
  // macOS Big Sur / Tahoe fluid rounded pointer (Recordly flagship).
  tahoe: {
    weight: 1.0,
    d:
      'M 0 0.24 C 0 0.08 0.15 0 0.26 0.11 L 9.85 9.72 C 10.37 10.24 10.0 11.14 9.26 11.14 L 5.98 11.14 ' +
      'L 8.16 16.32 C 8.44 16.97 8.13 17.73 7.48 18.0 C 6.82 18.28 6.07 17.97 5.8 17.32 L 3.59 12.07 ' +
      'L 1.34 14.07 C 0.84 14.52 0.06 14.21 0 13.57 Z',
    view: '-1.5 -1.5 14 22'
  },
  // Windows 11 Fluent design pointer (from Recordly Windows asset).
  windows11: {
    weight: 1.0,
    d:
      'M 0 0 L 12.04 12.11 L 6.86 12.11 L 8.99 16.43 L 5.9 18.0 L 3.53 13.14 L 0 16.57 Z',
    view: '-1.5 -1.5 16 22'
  },
  // Minimal / Figma multiplayer wedge pointer (from Recordly custom/minimal asset).
  figma: {
    weight: 0.9,
    d:
      'M 0 0.6 C -0.1 0.2 0.2 -0.1 0.6 0.1 L 15.65 8.73 C 16.03 8.95 15.97 9.52 15.55 9.65 L 8.23 11.9 ' +
      'C 8.11 11.94 8.01 12.01 7.95 12.11 L 4.29 17.76 C 4.04 18.13 3.46 18.03 3.37 17.58 L 0 0.6 Z',
    view: '-2 -2 20 22'
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
  // Pointing hand: authentic macOS Big Sur / Tahoe pointing hand (matched to Recordly).
  hand: {
    weight: 0.9,
    d:
      'M 2.51 18.0 C 1.02 18.0 -0.25 17.6 -1.3 16.8 C -2.35 16.0 -3.15 14.81 -3.7 13.24 ' +
      'L -5.27 8.82 C -5.32 8.68 -5.35 8.54 -5.38 8.38 C -5.4 8.23 -5.42 8.09 -5.42 7.97 ' +
      'C -5.42 7.52 -5.27 7.16 -4.96 6.91 C -4.66 6.66 -4.3 6.54 -3.89 6.54 ' +
      'C -3.6 6.54 -3.33 6.62 -3.09 6.8 C -2.85 6.97 -2.66 7.23 -2.51 7.57 ' +
      'L -1.82 9.28 C -1.8 9.32 -1.78 9.34 -1.74 9.34 C -1.69 9.34 -1.67 9.31 -1.67 9.26 ' +
      'V 1.73 C -1.67 1.2 -1.51 0.78 -1.2 0.47 C -0.88 0.16 -0.48 0.0 0.0 0.0 ' +
      'C 0.48 0.0 0.87 0.16 1.19 0.47 C 1.5 0.78 1.65 1.2 1.65 1.73 ' +
      'V 4.72 C 1.88 4.65 2.1 4.62 2.32 4.62 C 2.69 4.62 3.01 4.72 3.27 4.91 ' +
      'C 3.54 5.11 3.72 5.38 3.83 5.72 C 4.09 5.62 4.36 5.57 4.61 5.57 ' +
      'C 4.97 5.57 5.28 5.67 5.53 5.85 C 5.77 6.03 5.95 6.28 6.04 6.6 ' +
      'C 6.83 6.6 7.45 6.88 7.88 7.44 C 8.32 7.99 8.53 8.77 8.53 9.77 ' +
      'V 11.6 C 8.53 12.96 8.28 14.11 7.77 15.06 C 7.26 16.02 6.56 16.75 5.65 17.25 ' +
      'C 4.75 17.75 3.7 18.0 2.51 18.0 Z',
    view: '-7 -1.5 17 21'
  },
  // Text I-beam, centred on the hotspot. Modelled on the macOS text cursor:
  // thin serifs that flare out at top and bottom with a DEEP concave sweep into
  // a narrow stem, plus the small centre crossbar. The old glyph was a plain
  // square-serif "I" (straight rectangles), which is the shape difference you
  // notice against a real system cursor.
  //
  // Proportions measured off a reference recording: overall aspect h/w = 2.00,
  // stem width = 0.33 of the serif width, serif arm ~0.16 of the height.
  beam: {
    // Text I-beam, drawn as a STROKED centreline (see `stroke`): a stem with
    // a curved arm sweeping out to each of the four corners, and a short
    // crossbar just below centre. Measured off a real system caret, row by
    // row: body aspect h/w 2.33, stroke 0.18 of the width, arms meeting the
    // stem 13.5% down, crossbar 0.45 of the width across at 52%. The earlier
    // filled version had flat serif blocks — the reference's serifs are the
    // same thin line as the stem, just curved — and rounding its fill only
    // made the blocks fatter.
    //
    // Origin is the HOTSPOT, the centre of the stem.
    weight: 0.9,
    stroke: 1.39,
    d:
      'M -3.17 -8.3 Q -0.4 -8.3 0 -6.57 L 0 6.57 Q -0.4 8.3 -3.17 8.3 M 3.17 -8.3 Q 0.4 -8.3 0 -6.57 M 0 6.57 Q 0.4 8.3 3.17 8.3 M -1.04 0.3 L 1.04 0.3',
    view: '-5 -10.5 10 21'
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

// Captured system-cursor kind -> the glyph that stands in for it. The 'system'
// style picks through this per frame, so a recording shows an I-beam over text
// and a pointing hand over a link exactly where the real cursor did. Kinds we
// have no distinct glyph for fall back to the arrow rather than inventing one.
export const KIND_GLYPHS: Record<string, string> = {
  // The pointer is the classic 'arrow' glyph — straight edges, clean corners —
  // not the 'system' path, whose base/tail notch reads as broken at the halo
  // weight we now draw with.
  default: 'arrow',
  text: 'beam',
  pointer: 'hand',
  grab: 'hand',
  crosshair: 'arrow',
  wait: 'arrow'
};

/** Ring and dot are drawn procedurally (they scale as circles, not paths). */
export const CURSOR_CIRCLE_STYLES = new Set(['ring', 'dot']);

export type CursorStyleId =
  // 'system' FOLLOWS the cursor captured during recording — arrow over chrome,
  // I-beam over text, hand over links — which is what "system cursor" should
  // mean. It falls back to the arrow when the recording carries no cursor-kind
  // data (anything recorded before capture existed, or a Wayland session), so
  // it is safe as the default. Every other id is a fixed glyph.
  | 'system'
  | 'tahoe'
  | 'windows11'
  | 'figma'
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

/** Picker order — main pointer designs and shapes available to the user.
 *  Note: Contextual cursors ('hand' for links, 'beam' for text) are not picked here;
 *  they appear automatically when hovering buttons/text during playback.
 */
export const CURSOR_STYLE_IDS: CursorStyleId[] = [
  'system', 'tahoe', 'windows11', 'figma',
  'arrow', 'modern', 'sleek', 'retro',
  'ring', 'dot', 'paw', 'emoji'
];

// How long the pointer must sit still before it starts fading, and how long
// the fade takes. Only used when "Hide when idle" is on.
export const CURSOR_IDLE_MS = 1500;
export const CURSOR_IDLE_FADE_MS = 400;
// Squared distance (in normalized 0..1 frame coords) that counts as movement —
// about 4px on a 1920-wide frame, so hand-jitter doesn't keep it awake.
export const CURSOR_MOVE_EPS_SQ = 4e-6;
