// 3D scene presets: the video rendered as MANY cards — rings, grids, streams —
// animated across a rotation-lane region. Each scene is a pure function
// p ∈ [0,1] (linear progress through the region) → SceneInstance[], rendered
// by renderScene3D with painter's-algorithm depth sorting.
//
// Units: ox/oz in card WIDTHS, oy in card HEIGHTS, rotations in degrees,
// s = uniform scale. +z is toward the camera; keep oz ≤ ~0.8 so nothing
// crosses the near plane.
//
// The cursor glues to the "hero" card — heroIndex() picks the instance nearest
// the camera, which for every scene here is the one fronting the arrangement.

import type { SceneInstance } from './card3d';

const TAU = Math.PI * 2;
const D = 180 / Math.PI;
// Deterministic per-index jitter — Math.random would break resume/export parity.
const jit = (i: number, salt = 0) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
// Wrap a scroll coordinate into (-span/2, span/2] so rows loop seamlessly.
const wrap = (v: number, span: number) => ((v % span) + span * 1.5) % span - span / 2;

type Gen = (p: number) => SceneInstance[];

const inst = (partial: Partial<SceneInstance>): SceneInstance => ({
  ox: 0, oy: 0, oz: 0, rx: 0, ry: 0, rz: 0, s: 1, ...partial
});

// ── ring / orbit family ─────────────────────────────────────────────────────
// n cards on a circle; the circle's plane and how cards face distinguish the
// variants. Rear cards tuck to oz = −2R…0 with the front card at oz ≈ 0.
function orbitRing(p: number, n: number, R: number, opts: { plane: 'y' | 'x' | 'diag'; face: 'out' | 'flat' | 'tangent'; s?: number; turns?: number }): SceneInstance[] {
  const out: SceneInstance[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n + p * (opts.turns ?? 1)) * TAU;
    const sin = Math.sin(a), cos = Math.cos(a);
    const base = { oz: (cos - 1) * R, s: opts.s ?? 0.55 };
    if (opts.plane === 'y') {
      out.push(inst({ ...base, ox: sin * R, ry: opts.face === 'flat' ? 0 : sin * (opts.face === 'tangent' ? 90 : 60) }));
    } else if (opts.plane === 'x') {
      out.push(inst({ ...base, oy: sin * R * 0.9, rx: opts.face === 'flat' ? 0 : -sin * (opts.face === 'tangent' ? 90 : 60) }));
    } else {
      const k = Math.SQRT1_2;
      out.push(inst({ ...base, ox: sin * R * k, oy: sin * R * k * 0.9, ry: sin * 45, rx: -sin * 45 }));
    }
  }
  return out;
}

// Flat ring in the screen plane (cards arranged like numbers on a clock).
function flatRing(p: number, n: number, R: number, opts: { petal?: boolean; s?: number; arc?: number; turns?: number }): SceneInstance[] {
  const out: SceneInstance[] = [];
  const arc = opts.arc ?? 1; // fraction of the full circle to cover
  for (let i = 0; i < n; i++) {
    const a = (arc === 1 ? i / n + p * (opts.turns ?? 0.25) : (i / (n - 1) - 0.5) * arc + Math.sin(p * TAU) * 0.04) * TAU;
    out.push(inst({
      ox: Math.sin(a) * R,
      oy: Math.cos(a) * R * 0.9,
      rz: opts.petal ? -a * D : 0,
      s: opts.s ?? 0.42
    }));
  }
  return out;
}

// ── row / stream family ─────────────────────────────────────────────────────
// Cards on a line that scrolls with p; shape() bends the line per position.
function row(p: number, n: number, spacing: number, speed: number, shape: (x: number, i: number, ph: number) => Partial<SceneInstance>, s = 0.55): SceneInstance[] {
  const span = n * spacing;
  const ph = p * TAU;
  const out: SceneInstance[] = [];
  for (let i = 0; i < n; i++) {
    const x = wrap(i * spacing - p * speed * span, span);
    out.push(inst({ ox: x, s, ...shape(x, i, ph) }));
  }
  return out;
}

// ── grid family ─────────────────────────────────────────────────────────────
function grid(cols: number, rows: number, sx: number, sy: number, s: number, cell: (ix: number, iy: number, cx: number, cy: number) => Partial<SceneInstance>): SceneInstance[] {
  const out: SceneInstance[] = [];
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const cx = (ix - (cols - 1) / 2) * sx;
      const cy = (iy - (rows - 1) / 2) * sy;
      out.push(inst({ ox: cx, oy: cy, s, ...cell(ix, iy, cx, cy) }));
    }
  }
  return out;
}

const easeStep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ── the 40 scenes ───────────────────────────────────────────────────────────
export const SCENES: Record<string, Gen> = {
  // ORBITS & RINGS
  orbit: (p) => orbitRing(p, 6, 0.95, { plane: 'y', face: 'out', s: 0.42 }),
  orbitVert: (p) => orbitRing(p, 6, 0.95, { plane: 'x', face: 'out', s: 0.42 }),
  orbitDiag: (p) => orbitRing(p, 6, 0.95, { plane: 'diag', face: 'out', s: 0.42 }),
  ring: (p) => flatRing(p, 10, 0.42, { s: 0.2 }),
  petals: (p) => Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8 + p * 0.5) * TAU;
    return inst({ ox: Math.sin(a) * 0.36, oy: Math.cos(a) * 0.36, rz: -a * D, ry: Math.sin(a) * 22, rx: Math.cos(a) * 22, s: 0.4 });
  }),
  rainbow: (p) => flatRing(p, 7, 0.62, { arc: 0.5, s: 0.26 }).map((c) => inst({ ...c, oy: c.oy - 0.3, rz: Math.atan2(c.ox, c.oy + 0.3) * -D * 0.5 })),
  globe: (p) => {
    const out: SceneInstance[] = [];
    const R = 0.62;
    for (const [lat, n] of [[0, 8], [38, 7], [-38, 7], [68, 4], [-68, 4]] as [number, number][]) {
      const la = (lat * Math.PI) / 180, ring = Math.cos(la);
      for (let i = 0; i < n; i++) {
        const a = (i / n + p * 0.6 + lat / 400) * TAU;
        out.push(inst({
          ox: Math.sin(a) * R * ring, oy: Math.sin(la) * R * 1.05, oz: (Math.cos(a) - 1) * R * ring,
          ry: Math.sin(a) * 70, rx: -lat * 0.9, s: 0.3
        }));
      }
    }
    return out;
  },
  sphere: (p) => [
    ...orbitRing(p, 10, 1.6, { plane: 'y', face: 'out', s: 0.36 }),
    ...orbitRing(p, 7, 1.15, { plane: 'y', face: 'out', s: 0.32, turns: 1 }).map((c) => inst({ ...c, oy: 1.0, rx: -30 })),
    ...orbitRing(p, 7, 1.15, { plane: 'y', face: 'out', s: 0.32, turns: 1 }).map((c) => inst({ ...c, oy: -1.0, rx: 30 })),
    ...orbitRing(p, 3, 0.55, { plane: 'y', face: 'out', s: 0.28 }).map((c) => inst({ ...c, oy: 1.55, rx: -55 })),
    ...orbitRing(p, 3, 0.55, { plane: 'y', face: 'out', s: 0.28 }).map((c) => inst({ ...c, oy: -1.55, rx: 55 }))
  ],
  drum: (p) => orbitRing(p, 8, 0.8, { plane: 'y', face: 'tangent', s: 0.4 }),
  rolodex: (p) => orbitRing(p, 8, 0.85, { plane: 'x', face: 'flat', s: 0.42 }),
  spinner: (p) => [inst({ rz: p * 360, s: 0.85 })],
  pageFlip: (p) => [inst({ ry: -180 * easeStep(p), s: 0.85 })],
  swing: (p) => Array.from({ length: 4 }, (_, i) => {
    const lag = i * 0.045, rz = Math.sin((p - lag) * TAU) * 16;
    return inst({ rz, oy: -0.05, oz: -i * 0.12, s: 0.72 - i * 0.02 });
  }).reverse(),
  elevator: (p) => {
    const n = 5, step = easeStep((p * n) % 1) + Math.floor(p * n);
    return Array.from({ length: n + 1 }, (_, i) => inst({ oy: (i - step) * 1.25, s: 0.8 }));
  },

  // STREAMS & LINES
  slider: (p) => row(p, 4, 0.62, 1, () => ({}), 0.5),
  pager: (p) => row(p, 4, 0.58, 1, (x) => ({ ry: -x * 28, oz: -Math.abs(x) * 0.2 }), 0.5),
  scroll: (p) => row(p, 6, 0.42, 1, () => ({}), 0.3),
  ticker: (p) => row(p, 8, 0.42, 2, () => ({}), 0.3),
  stream: (p) => row(p, 6, 0.62, 1, (x) => ({ oy: x * 0.35, rz: -8 }), 0.5),
  trail: (p) => row(p, 6, 0.66, 1, (x) => ({ oz: -Math.abs(x) * 0.75, ry: -x * 18 }), 0.6),
  wave: (p) => row(p, 6, 0.56, 1, (x, _i, ph) => ({ oy: Math.sin(x * 3.0 + ph) * 0.22, rz: Math.cos(x * 3.0 + ph) * 9 }), 0.4),
  flag: (p) => row(p, 7, 0.42, 0.5, (x, _i, ph) => ({ ry: Math.sin(x * 3.4 + ph * 2) * 38, oz: Math.cos(x * 3.4 + ph * 2) * 0.1 }), 0.36),
  curve: (p) => row(p, 5, 0.6, 1, (x) => ({ oz: -x * x * 0.45, ry: -x * 26 }), 0.46),
  twist: (p) => row(p, 7, 0.46, 0.5, (x, _i, ph) => ({ rz: x * 52 + Math.sin(ph) * 10 }), 0.38),
  spiral: (p) => Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12 * 2 + p) * TAU;
    return inst({ ox: Math.sin(a) * 1.1, oy: (i / 11 - 0.5) * 2.3, oz: (Math.cos(a) - 1) * 1.1, ry: Math.sin(a) * 60, s: 0.4 });
  }),
  helix: (p) => Array.from({ length: 14 }, (_, i) => {
    const strand = i % 2, k = Math.floor(i / 2);
    const a = (k / 7 * 1.5 + p + strand * 0.5) * TAU;
    return inst({ ox: Math.sin(a) * 0.95, oy: (k / 6 - 0.5) * 2.2, oz: (Math.cos(a) - 1) * 0.95, ry: Math.sin(a) * 55, s: 0.36 });
  }),
  tunnel: (p) => {
    const out: SceneInstance[] = [];
    for (let ringI = 0; ringI < 4; ringI++) {
      const depth = wrap(ringI * 1.6 - p * 6.4, 6.4) - 2.6;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6 + ringI * 0.08) * TAU;
        out.push(inst({ ox: Math.sin(a) * 1.25, oy: Math.cos(a) * 1.15, oz: depth, rz: -a * D, s: 0.42 }));
      }
    }
    return out;
  },
  flow: (p) => row(p, 4, 0.85, 0.5, (x) => ({ oy: Math.abs(x) * 0.12 - 0.05, rz: x * 9, ry: -x * 14 }), 0.62),
  cascade: (p) => Array.from({ length: 5 }, (_, i) => {
    const k = i - 2 + Math.sin(p * TAU) * 0.5;
    return inst({ ox: k * 0.06, oy: -k * 0.42, oz: -Math.abs(k) * 0.25, s: 0.42 });
  }),
  parallax: (p) => [
    ...row(p, 5, 0.5, 1, () => ({ oy: 0.32, oz: -0.9 }), 0.24),
    ...row(1 - p, 4, 0.62, 1, () => ({ oy: -0.28, oz: -0.2 }), 0.34)
  ],
  stackFan: (p) => Array.from({ length: 5 }, (_, i) => {
    const k = i - 2, sway = Math.sin(p * TAU) * 6;
    return inst({ rz: k * (13 + sway * 0.5) + sway, oy: -0.15 + Math.abs(k) * 0.04, oz: -Math.abs(k) * 0.12, s: 0.62 });
  }),
  shuffle: (p) => Array.from({ length: 3 }, (_, i) => {
    const a = (i / 3 + p) * TAU;
    return inst({ ox: Math.sin(a) * 0.36, oz: (Math.cos(a) - 1) * 0.35, rz: Math.sin(a) * 6, s: 0.5 });
  }),
  scatter: (p) => Array.from({ length: 9 }, (_, i) => inst({
    ox: (jit(i) - 0.5) * 2.4 + Math.sin(p * TAU + i) * 0.06,
    oy: (jit(i, 1) - 0.5) * 1.8 + Math.cos(p * TAU + i * 2) * 0.05,
    oz: -jit(i, 2) * 1.2,
    rz: (jit(i, 3) - 0.5) * 34,
    s: 0.34 + jit(i, 4) * 0.2
  })),
  spotlight: (p) => [
    ...Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6 + p * 0.25) * TAU;
      return inst({ ox: Math.sin(a) * 1.35, oy: Math.cos(a) * 0.85, oz: -1.3, rz: Math.sin(a) * 10, s: 0.32 });
    }),
    inst({ oz: 0.05, s: 0.78 })
  ],

  // GRIDS & WALLS
  // Alternate rows drift in opposite directions.
  gridDrift: (p) => grid(4, 3, 0.48, 0.62, 0.36, () => ({})).map((c, i) => {
    const iy = Math.floor(i / 4);
    return inst({ ...c, ox: c.ox + Math.sin(p * TAU) * 0.15 * (iy % 2 ? 1 : -1) });
  }),
  gridZoom: (p) => {
    const z = 0.55 + easeStep(p) * 1.1;
    return grid(4, 3, 0.48 * z, 0.62 * z, 0.36 * z, () => ({}));
  },
  // Brick-offset columns, alternate columns drifting vertically.
  masonry: (p) => grid(3, 3, 0.56, 0.7, 0.4, (ix, iy) => ({
    oy: (iy - 1) * 0.7 + (ix % 2 ? 0.35 : 0)
  })).map((c, i) => inst({ ...c, oy: c.oy + Math.sin(p * TAU) * 0.18 * ((i % 3) % 2 ? 1 : -1) })),
  masonryH: (p) => grid(3, 3, 0.58, 0.64, 0.4, (ix, iy) => ({
    ox: (ix - 1) * 0.58 + (iy % 2 ? 0.29 : 0)
  })).map((c, i) => inst({ ...c, ox: c.ox + Math.sin(p * TAU) * 0.18 * (Math.floor(i / 3) % 2 ? 1 : -1) })),
  isoWall: (p) => grid(3, 3, 0.52, 0.66, 0.38, (_ix, _iy, cx) => ({
    oz: -cx * 0.5, rx: 16, ry: -30
  })).map((c) => inst({ ...c, ox: c.ox * 0.85 + Math.sin(p * TAU) * 0.2 })),
  flipGrid: (p) => grid(4, 2, 0.52, 0.66, 0.42, (ix, iy) => ({
    ry: 180 * easeStep(p * 2.2 - (ix + iy) * 0.22)
  }))
};

export type SceneId = keyof typeof SCENES;
export const SCENE_IDS = Object.keys(SCENES) as SceneId[];

// Grouping for the palette UI.
export const SCENE_GROUPS: { key: string; ids: string[] }[] = [
  { key: 'orbits', ids: ['orbit', 'orbitVert', 'orbitDiag', 'ring', 'petals', 'rainbow', 'globe', 'sphere', 'drum', 'rolodex', 'spinner', 'pageFlip', 'swing', 'elevator'] },
  { key: 'streams', ids: ['slider', 'pager', 'scroll', 'ticker', 'stream', 'trail', 'wave', 'flag', 'curve', 'twist', 'spiral', 'helix', 'tunnel', 'flow', 'cascade', 'parallax', 'stackFan', 'shuffle', 'scatter', 'spotlight'] },
  { key: 'grids', ids: ['gridDrift', 'gridZoom', 'masonry', 'masonryH', 'isoWall', 'flipGrid'] }
];

// Per-scene knobs, mirroring what users expect from the reference tools.
export type SceneShape = '1:1' | '4:3' | '3:2' | '16:9' | '9:16';
export type SceneSettings = {
  speed: number; zoom: number; tiltX: number; tiltY: number;
  depth: number; spacing: number; radius: number; shape: SceneShape;
  posX: number; posY: number; // arrangement centre, fractions of the frame
};
export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  speed: 1, zoom: 1, tiltX: 0, tiltY: 0, depth: 1, spacing: 1, radius: 1, shape: '1:1', posX: 0.5, posY: 0.5
};
export const SCENE_SHAPE_RATIO: Record<SceneShape, number> = {
  '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16
};

// Instances for a scene at progress p, with the settings applied: speed
// stretches p (looping scenes wrap, one-shot scenes clamp inside their
// generator); spacing/depth/radius scale the offsets; zoom dollies the whole
// arrangement; tiltX/tiltY rotate the arrangement as a group — positions AND
// card orientations — about the frame centre.
// Looping scenes run on WALL TIME — one cycle per CYCLE_SEC at speed 1 — so a
// short region isn't frantic and a long one isn't glacial. One-shot scenes
// (a page flip, a grid zoom-in…) still complete across their region.
export const CYCLE_SEC = 10;
const ONE_SHOT = new Set(['pageFlip', 'gridZoom', 'elevator', 'flipGrid']);
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
    // group rotation: about Y, then about X (matches card3d's X→Y order seen
    // from the arrangement's frame)
    let x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    let y1 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    return { ...c, ox: x1, oy: y1, oz: z2, rx: c.rx + st.tiltX, ry: c.ry + st.tiltY, s: c.s * st.zoom };
  });
}

// The cursor glues to whichever card fronts the arrangement.
export function heroIndex(instances: SceneInstance[]): number {
  let best = 0;
  for (let i = 1; i < instances.length; i++) if (instances[i].oz > instances[best].oz) best = i;
  return best;
}
