// Cinematic 3D Animation Presets for screen recordings.
//
// Unlike cheesy geometric multi-card rings/spheres, modern screen recording
// editors (CleanShot Studio, TiltIt) treat recordings with elegant single-card
// 3D camera moves: smooth perspective fly-ins, dynamic camera orbits,
// coordinated zoom-tilts, organic ambient breathing, and clean presentation decks.
//
// Each preset is a pure function p ∈ [0,1] → SceneInstance[], rendered by
// renderScene3D with painter's-algorithm depth sorting.
//
// Units: ox/oz in card WIDTHS, oy in card HEIGHTS, rotations in degrees,
// s = uniform scale. +z is toward the camera; keep oz ≤ ~0.8 so nothing
// crosses the near plane.
//
// The cursor glues to the "hero" card — heroIndex() picks the instance nearest
// the camera (highest oz).

import type { SceneInstance } from './card3d';

const TAU = Math.PI * 2;

// Smooth easing curves
const easeOutSine = (t: number) => Math.sin((Math.max(0, Math.min(1, t)) * Math.PI) / 2);
const easeInCubic = (t: number) => Math.pow(Math.max(0, Math.min(1, t)), 3);
const easeInOutCubic = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

type Gen = (p: number) => SceneInstance[];

const inst = (partial: Partial<SceneInstance>): SceneInstance => ({
  ox: 0, oy: 0, oz: 0, rx: 0, ry: 0, rz: 0, s: 1, ...partial
});

// ── All Cinematic Animation Presets ──────────────────────────────────────────
export const SCENES: Record<string, Gen> = {
  // ── ENTRANCES (INTROS) ──
  // Dramatic depth entrance: flies in from depth with pitch and soft deceleration, smoothly landing flat at center.
  heroFlyIn: (p) => {
    const t = easeOutSine(p);
    const rev = 1 - t;
    return [inst({
      ox: 0,
      oy: rev * 0.16,
      oz: -rev * 0.82,
      rx: rev * 22,
      ry: -rev * 8,
      rz: rev * 2,
      s: 0.8 + t * 0.2
    })];
  },

  // Floating high above canvas at an isometric tilt, gracefully landing flat at center.
  elevateLand: (p) => {
    const t = easeOutSine(p);
    const rev = 1 - t;
    return [inst({
      ox: rev * 0.04,
      oy: -rev * 0.3,
      oz: rev * 0.25,
      rx: rev * 24,
      ry: rev * 28,
      rz: -rev * 6,
      s: 0.9 + t * 0.1
    })];
  },

  // Sweeping entrance from the left with yaw rotation, smoothly landing flat at center.
  glideInL: (p) => {
    const t = easeOutSine(p);
    const rev = 1 - t;
    return [inst({
      ox: -rev * 0.65,
      oy: rev * 0.05,
      oz: -rev * 0.3,
      rx: rev * 6,
      ry: -rev * 30,
      rz: rev * 3,
      s: 0.92 + t * 0.08
    })];
  },

  // Sweeping entrance from the right with yaw rotation, smoothly landing flat at center.
  glideInR: (p) => {
    const t = easeOutSine(p);
    const rev = 1 - t;
    return [inst({
      ox: rev * 0.65,
      oy: rev * 0.05,
      oz: -rev * 0.3,
      rx: rev * 6,
      ry: rev * 30,
      rz: -rev * 3,
      s: 0.92 + t * 0.08
    })];
  },

  // Diagonal swoop from top-left corner directly and smoothly landing flat at center.
  cornerSwoop: (p) => {
    const t = easeOutSine(p);
    const rev = 1 - t;
    return [inst({
      ox: -rev * 0.52,
      oy: -rev * 0.38,
      oz: -rev * 0.35,
      rx: rev * 18,
      ry: -rev * 22,
      rz: rev * 8,
      s: 0.84 + t * 0.16
    })];
  },

  // Snappy scale pop-in with subtle tilt, smoothly settling flat at center.
  springPop: (p) => {
    const t = easeOutSine(p);
    const rev = 1 - t;
    return [inst({
      ox: 0,
      oy: rev * 0.04,
      oz: -rev * 0.18,
      rx: rev * 10,
      ry: 0,
      rz: 0,
      s: 0.85 + t * 0.15
    })];
  },

  // Rises up from bottom horizon, smoothly straightening flat into center.
  riseTilt: (p) => {
    const t = easeOutSine(p);
    const rev = 1 - t;
    return [inst({
      ox: 0,
      oy: rev * 0.55,
      oz: -rev * 0.22,
      rx: rev * 28,
      ry: 0,
      rz: 0,
      s: 0.9 + t * 0.1
    })];
  },

  // ── CAMERA SWEEPS & ORBITS ──
  // Smooth cinematic dolly arc across the window from Left to Right.
  orbitLR: (p) => {
    const t = easeInOutCubic(p);
    const arc = Math.sin(t * Math.PI);
    return [inst({
      ox: -0.06 + t * 0.12,
      oy: 0,
      oz: arc * 0.12,
      rx: 10 + arc * 3,
      ry: -26 + t * 52,
      rz: -arc * 2,
      s: 0.98 + arc * 0.04
    })];
  },

  // Smooth cinematic dolly arc across the window from Right to Left.
  orbitRL: (p) => {
    const t = easeInOutCubic(p);
    const arc = Math.sin(t * Math.PI);
    return [inst({
      ox: 0.06 - t * 0.12,
      oy: 0,
      oz: arc * 0.12,
      rx: 10 + arc * 3,
      ry: 26 - t * 52,
      rz: arc * 2,
      s: 0.98 + arc * 0.04
    })];
  },

  // Majestic 3D turntable slow inspection arc.
  turntable3D: (p) => {
    const t = easeInOutCubic(p);
    return [inst({
      ox: Math.sin((t - 0.5) * Math.PI) * 0.08,
      oy: 0,
      oz: 0.05,
      rx: 18,
      ry: -32 + t * 64,
      rz: -2 + Math.sin(t * Math.PI) * 4,
      s: 0.96
    })];
  },

  // Lateral camera tracking shot held at an elegant isometric angle.
  isometricPan: (p) => {
    const t = easeInOutCubic(p);
    return [inst({
      ox: -0.12 + t * 0.24,
      oy: 0.06 - t * 0.12,
      oz: 0.02,
      rx: 26,
      ry: 36,
      rz: -10,
      s: 0.92
    })];
  },

  // Coordinated dual-axis sweep keeping the recording sleek and modern.
  dynamicPerspective: (p) => {
    const ph = p * TAU;
    return [inst({
      ox: Math.sin(ph) * 0.05,
      oy: Math.cos(ph) * 0.03,
      oz: 0.04,
      rx: 14 * Math.cos(p * Math.PI),
      ry: 24 * Math.sin(p * Math.PI - 0.5),
      rz: Math.sin(ph) * 3,
      s: 0.98
    })];
  },

  // Modern diagonal product teaser angle sweeping smoothly.
  dutchSweep: (p) => {
    const t = easeInOutCubic(p);
    return [inst({
      ox: -0.08 + t * 0.16,
      oy: 0,
      oz: 0.03,
      rx: 8,
      ry: -14 + t * 28,
      rz: -10 + t * 20,
      s: 0.98
    })];
  },

  // ── FOCUS & ZOOM-TILTS ──
  // Zooms into top-left while pitching the opposite edge away into depth (CleanShot style).
  zoomTiltTL: (p) => {
    const t = easeInOutCubic(p);
    return [inst({
      ox: t * 0.18,
      oy: -t * 0.14,
      oz: t * 0.35,
      rx: -t * 14,
      ry: t * 18,
      rz: -t * 2,
      s: 1.0 + t * 0.15
    })];
  },

  // Zooms into top-right with dynamic depth tilt.
  zoomTiltTR: (p) => {
    const t = easeInOutCubic(p);
    return [inst({
      ox: -t * 0.18,
      oy: -t * 0.14,
      oz: t * 0.35,
      rx: -t * 14,
      ry: -t * 18,
      rz: t * 2,
      s: 1.0 + t * 0.15
    })];
  },

  // Deep forward camera push with perspective compression.
  centerDive: (p) => {
    const t = easeInOutCubic(p);
    const arc = Math.sin(p * Math.PI);
    return [inst({
      ox: 0,
      oy: 0,
      oz: t * 0.45,
      rx: arc * 6,
      ry: 0,
      rz: 0,
      s: 1.0 + t * 0.12
    })];
  },

  // Leans on a 3D display stand angle highlighting primary action area.
  cornerSpotlight: (p) => {
    const t = easeInOutCubic(p);
    return [inst({
      ox: -0.04,
      oy: 0.02,
      oz: 0.15 + t * 0.05,
      rx: 20,
      ry: -24 + t * 4,
      rz: 4,
      s: 0.95
    })];
  },

  // Gentle forward dolly with subtle directional tilt for detail inspection.
  detailFocus: (p) => {
    const t = easeInOutCubic(p);
    return [inst({
      ox: 0,
      oy: -t * 0.06,
      oz: t * 0.28,
      rx: -t * 8,
      ry: t * 6,
      rz: 0,
      s: 1.0 + t * 0.18
    })];
  },

  // ── AMBIENT & FLOATING (CONTINUOUS LIFE) ──
  // Gentle breathing hover with micro pitch/yaw oscillation.
  ambientHover: (p) => {
    const ph = p * TAU;
    return [inst({
      ox: Math.sin(ph * 0.8) * 0.015,
      oy: Math.sin(ph) * 0.032,
      oz: Math.cos(ph * 0.6) * 0.04,
      rx: Math.cos(ph) * 3.5,
      ry: Math.sin(ph * 0.7) * 5.5,
      rz: Math.sin(ph * 0.5) * 1.8,
      s: 0.98
    })];
  },

  // Hypnotic subtle pendulum sway.
  pendulumFloat: (p) => {
    const ph = p * TAU;
    return [inst({
      ox: Math.sin(ph) * 0.05,
      oy: -Math.abs(Math.cos(ph)) * 0.02,
      oz: 0.02,
      rx: 6,
      ry: Math.cos(ph) * 10,
      rz: Math.sin(ph) * 6,
      s: 0.96
    })];
  },

  // Gentle undulating wave tilt.
  horizonWave: (p) => {
    const ph = p * TAU;
    return [inst({
      ox: 0,
      oy: Math.sin(ph) * 0.04,
      oz: Math.cos(ph) * 0.05,
      rx: Math.sin(ph) * 8,
      ry: 0,
      rz: Math.cos(ph * 0.5) * 2,
      s: 0.96
    })];
  },

  // Slow, elegant diagonal floating drift.
  subtleDrift: (p) => {
    const ph = p * TAU;
    return [inst({
      ox: Math.sin(ph * 0.5) * 0.04,
      oy: Math.cos(ph * 0.5) * 0.03,
      oz: Math.sin(ph) * 0.03,
      rx: 10 + Math.sin(ph * 0.6) * 3,
      ry: 16 + Math.cos(ph * 0.4) * 4,
      rz: -3,
      s: 0.95
    })];
  },

  // ── EXITS (OUTROS) ──
  // Starts flat and eases backward into distance.
  fallbackOut: (p) => {
    const t = easeInCubic(p);
    return [inst({
      ox: 0,
      oy: t * 0.1,
      oz: -t * 0.85,
      rx: t * 34,
      ry: -t * 8,
      rz: t * 2,
      s: 1.0 - t * 0.3
    })];
  },

  // Lifts up and accelerates away to top-right corner.
  swoopOut: (p) => {
    const t = easeInCubic(p);
    return [inst({
      ox: t * 0.75,
      oy: -t * 0.6,
      oz: -t * 0.5,
      rx: -t * 26,
      ry: t * 32,
      rz: -t * 15,
      s: 1.0 - t * 0.25
    })];
  },

  // Smoothly glides out to the left off frame.
  glideOutL: (p) => {
    const t = easeInCubic(p);
    return [inst({
      ox: -t * 0.8,
      oy: t * 0.05,
      oz: -t * 0.35,
      rx: t * 8,
      ry: -t * 40,
      rz: t * 4,
      s: 1.0 - t * 0.15
    })];
  },

  // Smoothly glides out to the right off frame.
  glideOutR: (p) => {
    const t = easeInCubic(p);
    return [inst({
      ox: t * 0.8,
      oy: t * 0.05,
      oz: -t * 0.35,
      rx: t * 8,
      ry: t * 40,
      rz: -t * 4,
      s: 1.0 - t * 0.15
    })];
  },

  // Descends forward below the horizon plane.
  horizonFade: (p) => {
    const t = easeInCubic(p);
    return [inst({
      ox: 0,
      oy: t * 0.75,
      oz: -t * 0.3,
      rx: t * 42,
      ry: 0,
      rz: 0,
      s: 1.0 - t * 0.18
    })];
  },

  // ── PRESENTATION DECKS (MODERN MULTI-WINDOW) ──
  // Hero card in front with 2 companion cards cleanly in isometric depth.
  keynoteStack: (p) => {
    const ph = p * TAU;
    const sway = Math.sin(ph) * 0.015;
    return [
      inst({ ox: -0.42, oy: -0.04, oz: -0.38, ry: 18, rx: 8, s: 0.68 }),
      inst({ ox: 0.42, oy: -0.04, oz: -0.38, ry: -18, rx: 8, s: 0.68 }),
      inst({ ox: 0, oy: sway, oz: 0.08, ry: 0, rx: 4, s: 0.88 })
    ];
  },

  // Three cleanly aligned cards side-by-side on an isometric grid.
  isometricTrio: (p) => {
    const ph = p * TAU;
    const sway = Math.sin(ph) * 0.015;
    return [
      inst({ ox: -0.55, oy: 0.2 + sway, oz: -0.25, rx: 22, ry: -28, rz: 0, s: 0.6 }),
      inst({ ox: 0, oy: sway, oz: 0, rx: 22, ry: -28, rz: 0, s: 0.65 }),
      inst({ ox: 0.55, oy: -0.2 + sway, oz: 0.25, rx: 22, ry: -28, rz: 0, s: 0.6 })
    ];
  },

  // Elegant 3-card hand fan presentation.
  presentationFan: (p) => {
    const ph = p * TAU;
    const sway = Math.sin(ph) * 2;
    return [
      inst({ ox: -0.32, oy: -0.02, oz: -0.15, rz: -12 + sway, ry: 10, rx: 6, s: 0.74 }),
      inst({ ox: 0.32, oy: -0.02, oz: -0.15, rz: 12 - sway, ry: -10, rx: 6, s: 0.74 }),
      inst({ ox: 0, oy: 0, oz: 0.06, rz: 0, ry: 0, rx: 6, s: 0.82 })
    ];
  }
};

// Backward-compatibility aliases for any legacy saved scene IDs
const LEGACY_ALIASES: Record<string, string> = {
  orbit: 'orbitLR',
  orbitVert: 'orbitRL',
  orbitDiag: 'dynamicPerspective',
  ring: 'keynoteStack',
  petals: 'presentationFan',
  rainbow: 'isometricTrio',
  globe: 'turntable3D',
  sphere: 'turntable3D',
  drum: 'orbitLR',
  rolodex: 'riseTilt',
  spinner: 'dutchSweep',
  pageFlip: 'glideInL',
  swing: 'pendulumFloat',
  elevator: 'elevateLand',
  slider: 'glideInL',
  pager: 'glideInR',
  scroll: 'ambientHover',
  ticker: 'orbitLR',
  stream: 'isometricPan',
  trail: 'heroFlyIn',
  wave: 'horizonWave',
  flag: 'ambientHover',
  curve: 'dynamicPerspective',
  twist: 'dutchSweep',
  spiral: 'turntable3D',
  helix: 'keynoteStack',
  tunnel: 'centerDive',
  flow: 'subtleDrift',
  cascade: 'keynoteStack',
  parallax: 'keynoteStack',
  stackFan: 'presentationFan',
  shuffle: 'keynoteStack',
  scatter: 'keynoteStack',
  spotlight: 'cornerSpotlight',
  gridDrift: 'isometricTrio',
  gridZoom: 'centerDive',
  masonry: 'isometricTrio',
  masonryH: 'isometricTrio',
  isoWall: 'isometricTrio',
  flipGrid: 'presentationFan'
};

for (const [oldKey, newKey] of Object.entries(LEGACY_ALIASES)) {
  if (!SCENES[oldKey] && SCENES[newKey]) {
    SCENES[oldKey] = SCENES[newKey];
  }
}

export type SceneId = keyof typeof SCENES;
export const SCENE_IDS = Object.keys(SCENES) as SceneId[];

// Grouping for the palette UI.
export const SCENE_GROUPS: { key: string; ids: string[] }[] = [
  { key: 'entrances', ids: ['heroFlyIn', 'elevateLand', 'glideInL', 'glideInR', 'cornerSwoop', 'springPop', 'riseTilt'] },
  { key: 'sweeps', ids: ['orbitLR', 'orbitRL', 'turntable3D', 'isometricPan', 'dynamicPerspective', 'dutchSweep'] },
  { key: 'focus', ids: ['zoomTiltTL', 'zoomTiltTR', 'centerDive', 'cornerSpotlight', 'detailFocus'] },
  { key: 'ambient', ids: ['ambientHover', 'pendulumFloat', 'horizonWave', 'subtleDrift'] },
  { key: 'exits', ids: ['fallbackOut', 'swoopOut', 'glideOutL', 'glideOutR', 'horizonFade'] },
  { key: 'decks', ids: ['keynoteStack', 'isometricTrio', 'presentationFan'] }
];

// Per-scene knobs, mirroring what users expect from reference tools.
export type SceneShape = 'auto' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16';
export type SceneSettings = {
  speed: number; zoom: number; tiltX: number; tiltY: number;
  depth: number; spacing: number; radius: number; shape: SceneShape;
  posX: number; posY: number; // arrangement centre, fractions of the frame
};
export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  speed: 1, zoom: 1, tiltX: 0, tiltY: 0, depth: 1, spacing: 1, radius: 1, shape: 'auto', posX: 0.5, posY: 0.5
};
export const SCENE_SHAPE_RATIO: Record<Exclude<SceneShape, 'auto'>, number> = {
  '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16
};

// Presets that execute one-shot across the region (p ∈ [0, 1]) rather than cycling endlessly.
// Entrances arrive at rest; exits leave; sweeps and focus moves span the region once.
export const CYCLE_SEC = 8;
const ONE_SHOT = new Set([
  'heroFlyIn', 'elevateLand', 'glideInL', 'glideInR', 'cornerSwoop', 'springPop', 'riseTilt',
  'orbitLR', 'orbitRL', 'turntable3D', 'isometricPan', 'dynamicPerspective', 'dutchSweep',
  'zoomTiltTL', 'zoomTiltTR', 'centerDive', 'cornerSpotlight', 'detailFocus',
  'fallbackOut', 'swoopOut', 'glideOutL', 'glideOutR', 'horizonFade'
]);

export function sceneInstances(id: string, p: number, st: SceneSettings = DEFAULT_SCENE_SETTINGS, tSec = p * CYCLE_SEC): SceneInstance[] | null {
  const gen = SCENES[id];
  if (!gen) return null;
  const phase = ONE_SHOT.has(id)
    ? Math.min(1, p * st.speed)
    : ((tSec * st.speed) / CYCLE_SEC) % 1;
  const raw = gen(Math.max(0, Math.min(1, phase)));
  const gx = (st.tiltX * Math.PI) / 180, gy = (st.tiltY * Math.PI) / 180;
  const cx = Math.cos(gx), sx = Math.sin(gx), cy = Math.cos(gy), sy = Math.sin(gy);
  return raw.map((c) => {
    let x = c.ox * st.spacing * st.radius * st.zoom;
    let y = c.oy * st.spacing * st.radius * st.zoom;
    let z = c.oz * st.depth * st.radius * st.zoom;
    // group rotation: about Y, then about X
    let x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    let y1 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    return { ...c, ox: x1, oy: y1, oz: z2, rx: c.rx + st.tiltX, ry: c.ry + st.tiltY, s: c.s * st.zoom };
  });
}

// The cursor glues to whichever card fronts the arrangement (highest oz).
export function heroIndex(instances: SceneInstance[]): number {
  let best = 0;
  for (let i = 1; i < instances.length; i++) if (instances[i].oz > instances[best].oz) best = i;
  return best;
}
