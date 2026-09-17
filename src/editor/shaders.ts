// Animated shader backgrounds.
//
// A moving background is scenery, not part of the edit: it runs on its own clock
// and keeps going while the video is paused. The preview therefore drives it
// from wall-clock time (see bgClockMs below), while the exporter drives it from
// each frame's own timestamp — a rendered file has no "now" to read. The two
// sit at different phases of the same loop, which nobody can perceive; what
// does matter is that Capture Frame reads the same clock the screen is showing,
// so a grabbed still matches the preview it was taken from.
//
// Rendering is WebGL for the obvious reason: these are per-pixel effects, and
// doing fbm noise on a 2D canvas in JS is three orders of magnitude too slow to
// hold 60fps. The output is handed back as a plain canvas, so the 2D compositor
// draws it with the same `drawCover`-shaped call it uses for a wallpaper — blur,
// overscan and everything downstream keep working untouched.
//
// This is a SEPARATE GL context from card3d.ts on purpose. That one is resized
// to the output frame on every draw; sharing would mean two callers fighting
// over the viewport and the bound program inside a single frame.

export type ShaderId =
  | 'aurora' | 'drift' | 'waves' | 'nebula' | 'silk' | 'dusk'
  | 'fire' | 'electric' | 'rays' | 'beam' | 'ripple' | 'peaks' | 'smoke';

export const SHADER_IDS: ShaderId[] = [
  'aurora', 'drift', 'waves', 'nebula', 'silk', 'dusk',
  'fire', 'electric', 'rays', 'beam', 'ripple', 'peaks', 'smoke'
];

export const SHADER_LABELS: Record<ShaderId, string> = {
  aurora: 'Aurora',
  drift: 'Drift',
  waves: 'Waves',
  nebula: 'Nebula',
  silk: 'Silk',
  dusk: 'Dusk',
  fire: 'Fire',
  electric: 'Electric',
  rays: 'Rays',
  beam: 'Beam',
  ripple: 'Ripple',
  peaks: 'Peaks',
  smoke: 'Smoke'
};

// The background's own clock.
//
// A moving background is scenery, not part of the edit — it keeps moving while
// the video is paused, the way it does in Screen Movie. So the PREVIEW drives it
// from wall-clock elapsed time rather than the playhead.
//
// The export still drives it from the frame's own timestamp, because an exported
// video has no "now" to read. The two therefore sit at different phases, which
// is fine: nobody can tell which second of a loop they are looking at. What does
// matter is that Capture Frame agrees with the screen, so that path reads this
// same clock instead of the playhead.
const CLOCK_ORIGIN = typeof performance !== 'undefined' ? performance.now() : Date.now();
export function bgClockMs(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - CLOCK_ORIGIN;
}

/** A saved project may name a shader that no longer exists. */
export function normalizeShader(v: unknown): ShaderId {
  return SHADER_IDS.includes(v as ShaderId) ? (v as ShaderId) : 'aurora';
}

// Render size is capped and the compositor scales the result up.
//
// Every one of these is smooth, low-frequency colour — there is no detail above
// about 720p to lose, and a 4K export would otherwise pay for 8M fragments of
// fbm per frame to produce something visually identical to 1M. The cap is on
// the long edge so the aspect ratio still comes out right.
const MAX_EDGE = 1280;

const VS = `
attribute vec2 aPos;
varying vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Shared prelude: value noise + fbm + a helper that keeps every shader working
// in a square-ish space regardless of the frame's aspect, so a 16:9 and a 9:16
// background look like the same material rather than one being stretched.
const PRELUDE = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
varying vec2  vUV;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

// Aspect-corrected coordinates centred on the frame.
vec2 space() {
  vec2 p = vUV - 0.5;
  p.x *= uRes.x / uRes.y;
  return p;
}
`;

// Each preset is deliberately low-contrast and desaturated at the edges: this is
// a backdrop for a card with text on it, not a wallpaper competing with it. The
// bright core sits off-centre so the card (which is centred) doesn't sit on the
// one spot where the background is busiest.
const FRAGMENTS: Record<ShaderId, string> = {
  // Ribbons of light that drift and fold, on a deep blue ground.
  aurora: `
  void main() {
    vec2 p = space();
    float t = uTime * 0.42;
    float band = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float y = p.y + 0.16 * sin(p.x * 1.7 + t * (1.0 + fi * 0.35) + fi * 2.1)
                    + 0.07 * sin(p.x * 3.9 - t * 1.6 + fi);
      band += 0.055 / (abs(y + (fi - 1.0) * 0.13) + 0.055);
    }
    band *= 0.42;
    vec3 base = mix(vec3(0.03, 0.05, 0.12), vec3(0.05, 0.10, 0.22), vUV.y);
    vec3 lit  = mix(vec3(0.16, 0.75, 0.72), vec3(0.42, 0.36, 0.92), vUV.x + 0.18 * sin(t));
    gl_FragColor = vec4(base + lit * band, 1.0);
  }`,

  // Coloured lights orbiting behind frosted glass. Blended additively then
  // tone-mapped, so overlaps brighten and shift hue the way real lights do
  // instead of turning to mud. The moving sibling of the Mesh presets below.
  drift: `
  vec3 blob(vec2 p, vec2 c, vec3 col, float r) {
    float d = length(p - c);
    return col * exp(-d * d / (r * r));
  }
  void main() {
    vec2 p = space();
    float t = uTime * 0.30;
    vec3 c = vec3(0.03, 0.03, 0.06);
    c += blob(p, vec2(cos(t * 0.9) * 0.46, sin(t * 0.7) * 0.30), vec3(1.30, 0.30, 0.62), 0.34);
    c += blob(p, vec2(cos(t * 0.6 + 2.1) * 0.54, sin(t * 1.1 + 1.3) * 0.34), vec3(0.22, 0.48, 1.40), 0.36);
    c += blob(p, vec2(cos(t * 1.3 + 4.2) * 0.40, sin(t * 0.8 + 3.7) * 0.32), vec3(1.35, 0.72, 0.20), 0.28);
    c += blob(p, vec2(cos(t * 0.5 + 5.6) * 0.58, sin(t * 0.9 + 0.4) * 0.28), vec3(0.20, 1.10, 0.80), 0.30);
    c = c / (c + 0.62);            // Reinhard: keeps overlaps from clipping to white
    gl_FragColor = vec4(c, 1.0);
  }`,

  // Long smooth swells, lit from the top. Reads as depth rather than pattern
  // because each layer is darker AND slower than the one above it.
  waves: `
  void main() {
    vec2 p = space();
    float t = uTime * 0.72;
    vec3 c = mix(vec3(0.05, 0.07, 0.14), vec3(0.10, 0.16, 0.30), vUV.y);
    // Front to back, TOP crest first. Each layer fills everything below its own
    // line, so they have to descend — run them the other way and the last one
    // drawn sits highest and covers every band before it, which leaves exactly
    // one visible edge and no sense of depth at all.
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float speed = 1.0 - fi * 0.14;
      float y = 0.26 - fi * 0.13
              + 0.055 * sin(p.x * 2.3 + t * speed * 1.7 + fi * 1.7)
              + 0.030 * sin(p.x * 5.1 - t * speed * 1.1 + fi * 0.6);
      float m = smoothstep(0.010, -0.010, p.y - y);
      vec3 layer = mix(vec3(0.13, 0.42, 0.72), vec3(0.40, 0.18, 0.58), fi / 4.0) * (1.0 - fi * 0.15);
      c = mix(c, layer, m);
    }
    gl_FragColor = vec4(c, 1.0);
  }`,

  // Slow clouds of dust. Domain warping (feeding fbm its own output) is what
  // stops it looking like static noise and makes it curl.
  nebula: `
  void main() {
    vec2 p = space() * 2.0;
    float t = uTime * 0.34;
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(4.7, -t)));
    vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.3 * t),
                  fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.2 * t));
    float f = fbm(p + 3.5 * r);
    vec3 c = mix(vec3(0.03, 0.04, 0.10), vec3(0.16, 0.10, 0.38), clamp(f * f * 2.4, 0.0, 1.0));
    c = mix(c, vec3(0.72, 0.28, 0.52), clamp(length(r) * 0.55, 0.0, 1.0));
    c = mix(c, vec3(0.95, 0.72, 0.42), clamp(r.x * r.x * 0.9, 0.0, 1.0));
    c *= 0.55 + 0.45 * smoothstep(1.15, 0.15, length(space()) * 1.6);  // vignette
    gl_FragColor = vec4(c, 1.0);
  }`,

  // Fine warped stripes — the closest thing here to a texture rather than a
  // gradient. Kept very low contrast so it never fights text sitting over it.
  silk: `
  void main() {
    vec2 p = space();
    float t = uTime * 0.24;
    float w = fbm(p * 1.8 + vec2(t, -t * 0.6));
    float s = sin((p.x * 5.5 + p.y * 2.5 + w * 4.5 + t * 1.4) * 2.0);
    float m = 0.5 + 0.5 * s;
    vec3 a = vec3(0.06, 0.08, 0.16);
    vec3 b = mix(vec3(0.20, 0.30, 0.58), vec3(0.42, 0.26, 0.60), vUV.x);
    vec3 c = mix(a, b, m * 0.55 + 0.18);
    c += 0.05 * smoothstep(0.72, 1.0, m);      // a faint sheen on the crests
    gl_FragColor = vec4(c, 1.0);
  }`,

  // A warm horizon that breathes. The one light preset in the set — the others
  // are all dark, and a dark card needs somewhere bright to sit.
  dusk: `
  void main() {
    vec2 p = space();
    float t = uTime * 0.80;
    float h = 0.34 + 0.09 * sin(t * 0.9) + 0.055 * fbm(vec2(p.x * 1.6, t));
    float sky = smoothstep(0.0, 0.55, vUV.y - h);
    vec3 c = mix(vec3(0.98, 0.72, 0.45), vec3(0.36, 0.44, 0.82), sky);
    // pow() with a negative base is UNDEFINED in GLSL, and on this driver it
    // returns NaN — which propagates through the mix and paints the band black.
    // Clamping the base is the whole fix; without it the top and bottom of the
    // frame come out solid black wherever the glow term falls off.
    float glow = max(0.0, 1.0 - abs(vUV.y - h - 0.02) * 2.6);
    c = mix(c, vec3(0.99, 0.86, 0.66), pow(glow, 6.0) * 0.85);
    float cl = fbm(vec2(p.x * 2.1 + t * 0.7, p.y * 3.4 - t * 0.15));
    c = mix(c, vec3(1.0, 0.92, 0.88), smoothstep(0.55, 0.85, cl) * 0.30 * sky);
    gl_FragColor = vec4(c, 1.0);
  }`,

  // Flames. The trick is sampling the noise field moving UPWARD (subtracting t
  // from y) and tapering it with height — fire is noise plus a direction, and
  // without the taper it reads as orange fog.
  fire: `
  void main() {
    vec2 p = vUV;
    float t = uTime * 0.95;
    float n1 = fbm(vec2(p.x * 3.0, p.y * 2.2 - t));
    float n2 = fbm(vec2(p.x * 6.4 + 3.1, p.y * 4.2 - t * 1.7));
    float flame = n1 * 0.65 + n2 * 0.35;
    float v = clamp(flame * smoothstep(1.05, 0.02, p.y) * 2.3 - 0.22, 0.0, 1.0);
    // Stepped ramp rather than one mix: real flame goes black → red → orange →
    // near-white over a narrow band, and a linear blend skips the orange.
    vec3 c = vec3(0.02, 0.012, 0.02);
    c = mix(c, vec3(0.62, 0.08, 0.02), smoothstep(0.04, 0.42, v));
    c = mix(c, vec3(1.00, 0.44, 0.05), smoothstep(0.34, 0.72, v));
    c = mix(c, vec3(1.00, 0.92, 0.62), smoothstep(0.70, 0.96, v));
    gl_FragColor = vec4(c, 1.0);
  }`,

  // Bolts. Each is a vertical line displaced by two sines and drawn as a
  // reciprocal falloff, which gives a hot thin core with a soft halo — the same
  // 1/(d+k) trick Aurora uses for its ribbons.
  electric: `
  float bolt(vec2 p, float seed, float t) {
    float x = p.x + 0.26 * sin(p.y * 3.0 + t + seed)
                  + 0.10 * sin(p.y * 7.5 - t * 1.7 + seed * 2.0);
    return 0.016 / (abs(x) + 0.016);
  }
  void main() {
    vec2 p = space();
    float t = uTime * 1.15;
    float g = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      g += bolt(p - vec2((fi - 1.5) * 0.30, 0.0), fi * 2.3, t)
         * (0.45 + 0.55 * sin(t * 2.1 + fi * 1.9));
    }
    vec3 base = mix(vec3(0.02, 0.03, 0.08), vec3(0.03, 0.05, 0.14), vUV.y);
    vec3 lit = mix(vec3(0.30, 0.88, 1.00), vec3(0.55, 0.45, 1.00), vUV.y);
    gl_FragColor = vec4(base + lit * max(0.0, g) * 0.34, 1.0);
  }`,

  // Shafts of light from above, breathing in width and brightness.
  rays: `
  void main() {
    vec2 p = space();
    float t = uTime * 0.38;
    float g = 0.0;
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float x = (fi - 3.0) * 0.17 + 0.05 * sin(t * 0.7 + fi * 1.3);
      float w = 0.030 + 0.018 * sin(t * 1.1 + fi * 2.1);
      g += w / (abs(p.x - x) + w) * (0.45 + 0.55 * sin(t + fi * 1.7));
    }
    g *= smoothstep(-0.62, 0.55, p.y);      // strongest at the top, fades down
    vec3 base = mix(vec3(0.02, 0.03, 0.10), vec3(0.05, 0.07, 0.19), vUV.y);
    vec3 lit = mix(vec3(0.35, 0.55, 1.00), vec3(0.78, 0.45, 1.00), vUV.x);
    gl_FragColor = vec4(base + lit * g * 0.24, 1.0);
  }`,

  // A spotlight cone sweeping through haze. Built in the light's own frame:
  // distance ALONG the axis widens the cone, distance ACROSS it falls off.
  beam: `
  void main() {
    vec2 p = space();
    float t = uTime * 0.32;
    vec2 o = vec2(0.34 * sin(t), 0.66);
    vec2 d = normalize(vec2(0.30 * sin(t * 0.8 + 1.0), -1.0));
    vec2 v = p - o;
    float along = dot(v, d);
    float across = length(v - d * along);
    float cone = smoothstep(0.60, 0.0, across / max(0.08, along * 0.55 + 0.10));
    cone *= smoothstep(-0.08, 0.30, along) * smoothstep(1.60, 0.30, along);
    float haze = 0.62 + 0.38 * fbm(p * 3.0 + vec2(0.0, -t));
    vec3 base = vec3(0.03, 0.02, 0.07);
    vec3 lit = mix(vec3(0.68, 0.36, 1.00), vec3(0.32, 0.56, 1.00), vUV.y);
    gl_FragColor = vec4(base + lit * cone * haze * 0.60, 1.0);
  }`,

  // Concentric rings travelling outward from a point below the frame.
  ripple: `
  void main() {
    vec2 p = space();
    float t = uTime * 0.60;
    float d = length(p - vec2(0.0, -0.06));
    float m = 0.5 + 0.5 * sin(d * 26.0 - t * 2.3);
    float fall = smoothstep(1.00, 0.04, d);
    vec3 a = vec3(0.05, 0.03, 0.09);
    vec3 b = mix(vec3(1.00, 0.55, 0.78), vec3(0.55, 0.45, 1.00), clamp(d * 1.3, 0.0, 1.0));
    gl_FragColor = vec4(mix(a, b, m * fall * 0.42 + 0.06), 1.0);
  }`,

  // Jagged ridges. Same descending-layer rule as Waves — each ridge fills below
  // its own line, so they must be drawn top-down or the last one hides the rest.
  peaks: `
  void main() {
    vec2 p = space();
    float t = uTime * 0.34;
    vec3 c = mix(vec3(0.03, 0.03, 0.09), vec3(0.11, 0.06, 0.21), vUV.y);
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float sc = 2.2 + fi * 1.9;
      float h = 0.12 - fi * 0.095
              + 0.11 * abs(sin(p.x * sc + t * (0.4 + fi * 0.18) + fi * 1.4));
      float m = smoothstep(0.007, -0.007, p.y - h);
      vec3 col = mix(vec3(1.00, 0.56, 0.16), vec3(0.86, 0.20, 0.46), fi / 3.0) * (1.0 - fi * 0.17);
      c = mix(c, col, m);
    }
    gl_FragColor = vec4(c, 1.0);
  }`,

  // Grey volumetric smoke — the desaturated cousin of Nebula, warped harder and
  // drifting upward so it rolls rather than swirls in place.
  smoke: `
  void main() {
    vec2 p = space() * 1.6;
    float t = uTime * 0.22;
    vec2 q = vec2(fbm(p + vec2(0.0, t * 1.2)), fbm(p + vec2(5.2, -t)));
    float f = fbm(p + 2.4 * q + vec2(t * 0.3, -t * 0.5));
    float v = clamp(f * 1.75 - 0.25, 0.0, 1.0);
    vec3 c = mix(vec3(0.03, 0.03, 0.04), vec3(0.54, 0.56, 0.62), v);
    c = mix(c, vec3(0.80, 0.82, 0.88), smoothstep(0.66, 1.0, v) * 0.65);
    c *= 0.50 + 0.50 * smoothstep(1.25, 0.20, length(space()) * 1.5);
    gl_FragColor = vec4(c, 1.0);
  }`
};

type Prog = { prog: WebGLProgram; uRes: WebGLUniformLocation | null; uTime: WebGLUniformLocation | null };
type MeshProg = Prog & {
  uC0: WebGLUniformLocation | null; uC1: WebGLUniformLocation | null;
  uC2: WebGLUniformLocation | null; uC3: WebGLUniformLocation | null;
};
type FieldProg = Prog & {
  uHue: WebGLUniformLocation | null; uCol: WebGLUniformLocation | null;
  uFold: WebGLUniformLocation | null; uWarp: WebGLUniformLocation | null;
  uShape: WebGLUniformLocation | null; uMot: WebGLUniformLocation | null;
  uCent: WebGLUniformLocation | null; uOff: WebGLUniformLocation | null;
  uVar: WebGLUniformLocation | null;
};
type GL = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  gl: WebGLRenderingContext;
  progs: Partial<Record<ShaderId, Prog>>;
  mesh?: MeshProg;
  field?: FieldProg;
};
let state: GL | null = null;
let unavailable = false;

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

function init(w: number, h: number): GL | null {
  if (unavailable) return null;
  if (state) {
    if (state.canvas.width !== w || state.canvas.height !== h) {
      state.canvas.width = w; state.canvas.height = h;
      state.gl.viewport(0, 0, w, h);
    }
    return state;
  }
  try {
    const canvas = makeCanvas(w, h);
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true }) as WebGLRenderingContext | null;
    if (!gl) { unavailable = true; return null; }
    // One fullscreen quad, shared by every program.
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.viewport(0, 0, w, h);
    state = { canvas, gl, progs: {} };
    return state;
  } catch (e) {
    console.warn('[shaders] WebGL unavailable', e);
    unavailable = true;
    return null;
  }
}

function link(gl: WebGLRenderingContext, fragmentSrc: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
  return prog;
}

function program(st: GL, id: ShaderId): Prog {
  const cached = st.progs[id];
  if (cached) return cached;
  const { gl } = st;
  const prog = link(gl, PRELUDE + FRAGMENTS[id]);
  const entry: Prog = {
    prog,
    uRes: gl.getUniformLocation(prog, 'uRes'),
    uTime: gl.getUniformLocation(prog, 'uTime')
  };
  st.progs[id] = entry;
  return entry;
}

function meshProgram(st: GL): MeshProg {
  if (st.mesh) return st.mesh;
  const { gl } = st;
  const prog = link(gl, MESH_FS);
  st.mesh = {
    prog,
    uRes: gl.getUniformLocation(prog, 'uRes'),
    uTime: gl.getUniformLocation(prog, 'uTime'),
    uC0: gl.getUniformLocation(prog, 'uC0'),
    uC1: gl.getUniformLocation(prog, 'uC1'),
    uC2: gl.getUniformLocation(prog, 'uC2'),
    uC3: gl.getUniformLocation(prog, 'uC3')
  };
  return st.mesh;
}

function fieldProgram(st: GL): FieldProg {
  if (st.field) return st.field;
  const { gl } = st;
  const prog = link(gl, FIELD_FS);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  st.field = {
    prog, uRes: u('uRes'), uTime: u('uTime'),
    uHue: u('uHue'), uCol: u('uCol'), uFold: u('uFold'),
    uWarp: u('uWarp'), uShape: u('uShape'), uMot: u('uMot'),
    uCent: u('uCent'), uOff: u('uOff'), uVar: u('uVar')
  };
  return st.field;
}

/**
 * Render one frame of an animated background.
 *
 * `ms` is the playhead, not wall-clock — see the note at the top of the file.
 * Returns null when WebGL is unavailable; callers fall back to a flat fill
 * rather than leaving the frame empty.
 */
export function renderShaderBackground(
  id: ShaderId,
  ms: number,
  w: number,
  h: number
): OffscreenCanvas | HTMLCanvasElement | null {
  const scale = Math.min(1, MAX_EDGE / Math.max(1, Math.max(w, h)));
  const rw = Math.max(2, Math.round(w * scale));
  const rh = Math.max(2, Math.round(h * scale));
  const st = init(rw, rh);
  if (!st) return null;
  const { gl } = st;
  try {
    const p = program(st, normalizeShader(id));
    gl.useProgram(p.prog);
    const aPos = gl.getAttribLocation(p.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    if (p.uRes) gl.uniform2f(p.uRes, rw, rh);
    if (p.uTime) gl.uniform1f(p.uTime, ms / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return st.canvas;
  } catch (e) {
    console.warn('[shaders] render failed', e);
    unavailable = true;
    return null;
  }
}

/** Flat colour to fall back to per preset, when WebGL is missing. */
export const SHADER_FALLBACK: Record<ShaderId, string> = {
  aurora: '#0a1226',
  drift: '#141019',
  waves: '#0d1526',
  nebula: '#0a0a1c',
  silk: '#101425',
  dusk: '#5b5f9e',
  fire: '#1a0703',
  electric: '#050a16',
  rays: '#070b1c',
  beam: '#080513',
  ripple: '#0d0817',
  peaks: '#0a0718',
  smoke: '#14161a'
};

// ── Mesh gradients (static) ────────────────────────────────────────────────
//
// The still counterpart to the animated set: four soft coloured lights blended
// behind glass, frozen. These are the ones you reach for when the background
// should stay out of the way — motion in a backdrop pulls the eye away from
// whatever the recording is showing, and for a lot of clips that is the wrong
// trade.
//
// One shader drives all of them. A preset is just four colours and a phase, so
// adding a mesh is one line of data rather than another program to compile, and
// every one of them is deterministic: same preset, same pixels, forever.

export type MeshPreset = { id: string; colors: [string, string, string, string]; phase: number };

export const MESH_PRESETS: MeshPreset[] = [
  { id: 'm01', colors: ['#6366f1', '#a855f7', '#3b82f6', '#1e1b4b'], phase: 0.0 },
  { id: 'm02', colors: ['#ec4899', '#8b5cf6', '#f43f5e', '#2e1065'], phase: 1.7 },
  { id: 'm03', colors: ['#f9a8d4', '#c4b5fd', '#fbcfe8', '#ede9fe'], phase: 3.1 },
  { id: 'm04', colors: ['#14b8a6', '#22c55e', '#0d9488', '#052e2b'], phase: 4.6 },
  { id: 'm05', colors: ['#f97316', '#ef4444', '#fb923c', '#431407'], phase: 6.0 },
  { id: 'm06', colors: ['#38bdf8', '#0ea5e9', '#e0f2fe', '#0c4a6e'], phase: 7.4 },
  { id: 'm07', colors: ['#e11d48', '#a21caf', '#7c3aed', '#1a032e'], phase: 8.9 },
  { id: 'm08', colors: ['#334155', '#1e293b', '#475569', '#020617'], phase: 10.3 },
  { id: 'm09', colors: ['#f59e0b', '#eab308', '#fbbf24', '#451a03'], phase: 11.8 },
  { id: 'm10', colors: ['#5eead4', '#67e8f9', '#a7f3d0', '#083344'], phase: 13.2 },
  { id: 'm11', colors: ['#fb7185', '#fda4af', '#f472b6', '#4c0519'], phase: 14.7 },
  { id: 'm12', colors: ['#64748b', '#94a3b8', '#7dd3fc', '#0f172a'], phase: 16.1 },
  { id: 'm13', colors: ['#84cc16', '#10b981', '#bef264', '#14532d'], phase: 17.6 },
  { id: 'm14', colors: ['#c4b5fd', '#818cf8', '#e9d5ff', '#312e81'], phase: 19.0 },
  { id: 'm15', colors: ['#fb923c', '#f43f5e', '#fcd34d', '#7c2d12'], phase: 20.5 },
  { id: 'm16', colors: ['#1d4ed8', '#0891b2', '#2563eb', '#020a2e'], phase: 21.9 }
];

export function normalizeMesh(v: unknown): string {
  return MESH_PRESETS.some((m) => m.id === v) ? (v as string) : MESH_PRESETS[0].id;
}

export function meshPreset(id: string): MeshPreset {
  return MESH_PRESETS.find((m) => m.id === normalizeMesh(id)) ?? MESH_PRESETS[0];
}

// Same blob maths as `drift`, but the four colours arrive as uniforms and the
// clock is a fixed per-preset phase rather than the playhead.
const MESH_FS = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uC0;
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;
varying vec2  vUV;

vec2 space() { vec2 p = vUV - 0.5; p.x *= uRes.x / uRes.y; return p; }
vec3 blob(vec2 p, vec2 c, vec3 col, float r) {
  float d = length(p - c);
  return col * exp(-d * d / (r * r));
}
void main() {
  vec2 p = space();
  float t = uTime;
  vec3 c = uC3 * 0.35;
  c += blob(p, vec2(cos(t * 0.9) * 0.46, sin(t * 0.7) * 0.30), uC0 * 1.45, 0.40);
  c += blob(p, vec2(cos(t * 0.6 + 2.1) * 0.54, sin(t * 1.1 + 1.3) * 0.34), uC1 * 1.45, 0.42);
  c += blob(p, vec2(cos(t * 1.3 + 4.2) * 0.40, sin(t * 0.8 + 3.7) * 0.32), uC2 * 1.35, 0.34);
  c += blob(p, vec2(cos(t * 0.5 + 5.6) * 0.58, sin(t * 0.9 + 0.4) * 0.28), uC0 * 1.10, 0.36);
  c = c / (c + 0.70);
  gl_FragColor = vec4(c, 1.0);
}`;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ── Field (layered glow, parametric) ───────────────────────────────────────
//
// Derived from OpenShaders' "pure field" shader, reference @eodev (#2,220).
// Credits and the licence position are in SHADER_CREDITS.md next to this file.
//
// The technique behind OpenShaders' grid, rebuilt from the published parts
// rather than copied: iterate a point through a fold matrix, accumulate a
// reciprocal glow at each step, tint it along an OKLCH ramp, tonemap, dither.
//
// Their 2,200-odd "shaders" are ONE shader — this one — with a different set of
// constants each. The rarity dropdown gives it away: Pure field 39%, Grain 13%,
// ASCII 12% … percentages summing to 100 is a generative trait table, not a
// gallery. So the thing worth having is the generator, not the outputs: a
// preset here is ~24 numbers, and new looks cost a line of data.
//
// Three ideas in it are standard published practice and worth keeping:
//   OKLCH for the colour ramp   — perceptually even hue travel, so a sweep
//                                 doesn't bunch up in the blues
//   ACES-ish tonemap            — overlapping glows roll off instead of
//                                 clipping to white
//   blue-noise dither at 1/255  — kills the banding that any smooth gradient
//                                 shows on an 8-bit display

export type FieldPreset = {
  id: string;
  hue: number; hueSpread: number; hueTravel: number; colourCycle: number;
  chroma: number; lightness: number; lightSwing: number; falloff: number;
  theta: number; shear: number; shrink: number; layers: number;
  warpFX: number; warpFY: number; warpAX: number; warpAY: number;
  aspectX: number; aspectY: number; glow: number; soft: number;
  speed: number; breathRate: number; breathAmt: number; phase: number;
  // The two I originally left out, and the reason the first pass came out as
  // centred rosettes instead of soft sweeps: the fold origin is moved OFF the
  // frame before iterating, and the whole field is rotated. With the centre at
  // 0,0 every layer folds around the middle and the filaments stack into a
  // symmetric flower. Push the origin outside the frame and only one arm of it
  // crosses the picture — which is the look.
  centreX: number; centreY: number; tilt: number; zoom: number;
  offsetX: number; offsetY: number;
  variant: FieldVariant;
};

const F = (
  id: string, hue: number, hueSpread: number, chroma: number, lightness: number,
  centreX: number, centreY: number, tilt: number,
  layers: number, glow: number, speed: number, phase: number,
  variant: FieldVariant = 'pure'
): FieldPreset => ({
  variant,
  id, hue, hueSpread, hueTravel: 1.549, colourCycle: 0.2305,
  chroma, lightness, lightSwing: 0.294, falloff: 0.2585,
  theta: 2.1257, shear: 0.9637, shrink: 0.9462, layers,
  warpFX: 0.4712, warpFY: 2.6813, warpAX: 0.1184, warpAY: 0.0337,
  aspectX: 2.1228, aspectY: 0.1768, glow, soft: 0.00256,
  speed, breathRate: 0.4732, breathAmt: 0.1041, phase,
  centreX, centreY, tilt, zoom: 1.0615,
  offsetX: 0.3266, offsetY: -0.0572
});

export const FIELD_PRESETS: FieldPreset[] = [
  //   id      hue  spread chroma light   cX      cY    tilt  layers  glow    speed phase
  F('f01', 0.841, 0.026, 0.110, 0.541, -0.567,  0.220, 1.329, 75, 0.00260, 0.517,  86),
  F('f02', 0.038, 0.055, 0.126, 0.512, -0.612, -0.185, 2.140, 68, 0.00242, 0.448,  12),
  F('f03', 0.545, 0.031, 0.118, 0.556,  0.594,  0.268, 0.742, 80, 0.00228, 0.585,  41),
  F('f04', 0.372, 0.044, 0.101, 0.528, -0.498,  0.402, 2.688, 62, 0.00275, 0.392, 130),
  F('f05', 0.716, 0.068, 0.134, 0.498,  0.652, -0.148, 1.874, 72, 0.00251, 0.541, 205),
  F('f06', 0.118, 0.029, 0.114, 0.572, -0.640,  0.096, 0.418, 66, 0.00268, 0.470,  63),
  F('f07', 0.918, 0.047, 0.122, 0.507,  0.512,  0.351, 2.402, 84, 0.00219, 0.622, 158),
  F('f08', 0.618, 0.061, 0.096, 0.549, -0.556, -0.294, 1.062, 58, 0.00288, 0.358,  92),
  F('f09', 0.262, 0.036, 0.130, 0.482,  0.678,  0.172, 3.014, 78, 0.00234, 0.564,  27),
  F('f10', 0.482, 0.079, 0.108, 0.534, -0.524,  0.318, 1.596, 64, 0.00262, 0.425, 174),
  F('f11', 0.016, 0.021, 0.138, 0.466,  0.601, -0.236, 0.884, 82, 0.00224, 0.601, 119),
  F('f12', 0.684, 0.052, 0.104, 0.561, -0.588,  0.144, 2.256, 70, 0.00256, 0.494,   6),

  // Quiet — same geometry, half the chroma and a dimmer core. These go behind a
  // recording that is mostly text.
  F('f13', 0.841, 0.018, 0.054, 0.418, -0.567,  0.220, 1.329, 52, 0.00172, 0.340,  86),
  F('f14', 0.038, 0.030, 0.061, 0.396, -0.612, -0.185, 2.140, 48, 0.00164, 0.302,  12),
  F('f15', 0.545, 0.020, 0.057, 0.430,  0.594,  0.268, 0.742, 56, 0.00156, 0.378,  41),
  F('f16', 0.372, 0.026, 0.049, 0.404, -0.498,  0.402, 2.688, 44, 0.00182, 0.266, 130),
  F('f17', 0.716, 0.038, 0.066, 0.382,  0.652, -0.148, 1.874, 50, 0.00168, 0.356, 205),
  F('f18', 0.118, 0.017, 0.055, 0.442, -0.640,  0.096, 0.418, 46, 0.00176, 0.318,  63),
  F('f19', 0.918, 0.027, 0.059, 0.390,  0.512,  0.351, 2.402, 58, 0.00148, 0.396, 158),
  F('f20', 0.618, 0.034, 0.047, 0.424, -0.556, -0.294, 1.062, 42, 0.00192, 0.248,  92),
  F('f21', 0.262, 0.021, 0.064, 0.374,  0.678,  0.172, 3.014, 54, 0.00160, 0.370,  27),
  F('f22', 0.482, 0.044, 0.052, 0.412, -0.524,  0.318, 1.596, 47, 0.00174, 0.288, 174),
  F('f23', 0.016, 0.012, 0.068, 0.366,  0.601, -0.236, 0.884, 57, 0.00150, 0.404, 119),
  F('f24', 0.684, 0.029, 0.050, 0.434, -0.588,  0.144, 2.256, 49, 0.00170, 0.330,   6),

  // The other eight rarities. Same geometry vocabulary, different treatment on
  // top — which is how OpenShaders mints them.
  F('g01', 0.841, 0.026, 0.104, 0.520, -0.567,  0.220, 1.329, 70, 0.00250, 0.500,  86, 'grain'),
  F('g02', 0.545, 0.031, 0.112, 0.528,  0.594,  0.268, 0.742, 74, 0.00224, 0.560,  41, 'grain'),
  F('g03', 0.038, 0.055, 0.118, 0.500, -0.612, -0.185, 2.140, 64, 0.00238, 0.440,  12, 'grain'),
  F('a01', 0.545, 0.024, 0.130, 0.600,  0.594,  0.268, 0.742, 64, 0.00300, 0.520,  41, 'ascii'),
  F('a02', 0.118, 0.029, 0.126, 0.590, -0.640,  0.096, 0.418, 60, 0.00310, 0.470,  63, 'ascii'),
  F('a03', 0.918, 0.047, 0.134, 0.580,  0.512,  0.351, 2.402, 66, 0.00290, 0.600, 158, 'ascii'),
  F('d01', 0.684, 0.052, 0.120, 0.560, -0.588,  0.144, 2.256, 68, 0.00268, 0.490,   6, 'dither'),
  F('d02', 0.262, 0.036, 0.128, 0.540,  0.678,  0.172, 3.014, 72, 0.00252, 0.550,  27, 'dither'),
  F('d03', 0.016, 0.021, 0.132, 0.520,  0.601, -0.236, 0.884, 70, 0.00246, 0.580, 119, 'dither'),
  F('h01', 0.716, 0.068, 0.136, 0.580,  0.652, -0.148, 1.874, 66, 0.00300, 0.530, 205, 'halftone'),
  F('h02', 0.482, 0.079, 0.124, 0.570, -0.524,  0.318, 1.596, 62, 0.00306, 0.430, 174, 'halftone'),
  F('h03', 0.372, 0.044, 0.118, 0.560, -0.498,  0.402, 2.688, 60, 0.00312, 0.400, 130, 'halftone'),
  F('s01', 0.841, 0.026, 0.112, 0.540, -0.567,  0.220, 1.329, 72, 0.00256, 0.500,  86, 'sparkle'),
  F('s02', 0.618, 0.061, 0.100, 0.548, -0.556, -0.294, 1.062, 60, 0.00284, 0.360,  92, 'sparkle'),
  F('l01', 0.545, 0.031, 0.116, 0.550,  0.594,  0.268, 0.742, 62, 0.00236, 0.540,  41, 'liquid'),
  F('l02', 0.262, 0.036, 0.126, 0.500,  0.678,  0.172, 3.014, 58, 0.00244, 0.520,  27, 'liquid'),
  F('m01', 0.038, 0.055, 0.130, 0.520, -0.612, -0.185, 2.140, 58, 0.00260, 0.450,  12, 'mosaic'),
  F('m02', 0.716, 0.068, 0.124, 0.510,  0.652, -0.148, 1.874, 56, 0.00258, 0.530, 205, 'mosaic'),
  // Chroma samples the field three times, so it runs at a third of the layers.
  F('c01', 0.918, 0.047, 0.128, 0.520,  0.512,  0.351, 2.402, 30, 0.00250, 0.600, 158, 'chroma'),
  F('c02', 0.482, 0.079, 0.114, 0.534, -0.524,  0.318, 1.596, 28, 0.00262, 0.430, 174, 'chroma')
];

/**
 * The part of a Field preset a user can change.
 *
 * Colour and treatment only — the geometry (fold angle, shear, shrink, aspect,
 * warp) stays fixed, because that is what makes every preset read as the same
 * family. It is also why the source site can mint thousands of these: nearly
 * all of the variation between them is hue.
 */
export type FieldStyle = {
  hue: number;        // 0..1, one turn
  hueSpread: number;  // 0..0.25, how far the ramp travels
  chroma: number;     // 0..0.2
  lightness: number;  // 0.25..0.7
  variant: FieldVariant;
};

export const DEFAULT_FIELD_STYLE: FieldStyle = {
  hue: FIELD_PRESETS[0].hue,
  hueSpread: FIELD_PRESETS[0].hueSpread,
  chroma: FIELD_PRESETS[0].chroma,
  lightness: FIELD_PRESETS[0].lightness,
  variant: FIELD_PRESETS[0].variant
};

/** The style a preset starts from — seeded into the sliders when it is picked. */
export function fieldStyleOf(id: string): FieldStyle {
  const f = fieldPreset(id);
  return { hue: f.hue, hueSpread: f.hueSpread, chroma: f.chroma, lightness: f.lightness, variant: f.variant };
}

export function normalizeField(v: unknown): string {
  return FIELD_PRESETS.some((f) => f.id === v) ? (v as string) : FIELD_PRESETS[0].id;
}
export function fieldPreset(id: string): FieldPreset {
  return FIELD_PRESETS.find((f) => f.id === normalizeField(id)) ?? FIELD_PRESETS[0];
}

// GLSL ES 1.0, not 3.00: this project's context is WebGL1, so there is no
// gl_VertexID trick for the fullscreen triangle (we already have a quad) and
// no `out` — it writes gl_FragColor. The loop bound must be a compile-time
// constant, hence `i <= 96` with an early break on the preset's layer count.
// Variants — the nine "rarities" OpenShaders mints, as post-process traits over
// the same field. Ordered as their dropdown lists them.
export const FIELD_VARIANTS = ['pure', 'grain', 'ascii', 'dither', 'halftone', 'sparkle', 'liquid', 'mosaic', 'chroma'] as const;
export type FieldVariant = (typeof FIELD_VARIANTS)[number];
export const FIELD_VARIANT_LABELS: Record<FieldVariant, string> = {
  pure: 'Pure field', grain: 'Grain', ascii: 'ASCII', dither: 'Dither', halftone: 'Halftone',
  sparkle: 'Sparkle', liquid: 'Liquid', mosaic: 'Mosaic', chroma: 'Chroma'
};

// GLSL ES 1.0, not 3.00: this project's context is WebGL1, so there is no
// gl_VertexID trick for the fullscreen triangle (we already have a quad) and
// no `out` — it writes gl_FragColor. The loop bound must be a compile-time
// constant, hence `i <= 96` with an early break on the preset's layer count.
//
// The field itself is factored into fieldAt() because three variants need it
// at a position that is not this fragment: Chroma samples it three times at
// different radii, ASCII and Halftone sample it once per CELL rather than per
// pixel. Inlining it would mean writing the loop four times.
const FIELD_FS = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec4  uHue;    // hue, spread, travel, cycle
uniform vec4  uCol;    // chroma, lightness, swing, falloff
uniform vec4  uFold;   // theta, shear, shrink, layers
uniform vec4  uWarp;   // freqX, freqY, ampX, ampY
uniform vec4  uShape;  // aspectX, aspectY, glow, soft
uniform vec4  uMot;    // speed, breathRate, breathAmt, phase
uniform vec4  uCent;   // centreX, centreY, tilt, zoom
uniform vec2  uOff;    // offsetX, offsetY
uniform float uVar;    // variant index
varying vec2  vUV;

const float TAU = 6.28318530718;

float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

// OpenShaders 3D hash
vec3 hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// OpenShaders blue noise
float blueNoise(vec2 p, float frame) {
  p += 5.588238 * mod(frame, 64.0);
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm2(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// OKLCH -> linear sRGB. A hue sweep in this space keeps even perceived
// lightness; the same sweep in HSL darkens through blue and spikes at yellow.
vec3 oklch(float L, float C, float h) {
  float a = C * cos(h), b = C * sin(h);
  float l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  float m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  float s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  vec3 lms = vec3(l_, m_, s_);
  lms = lms * lms * lms;
  return mat3( 4.0767416621, -1.2684380046, -0.0041960863,
              -3.3077115913,  2.6097574011, -0.7034186147,
               0.2309699292, -0.3413193965,  1.7076147010) * lms;
}

vec3 fieldAt(vec2 pos) {
  float t = uTime * uMot.x + uMot.w;
  float breath = (-sin(uTime * uMot.y * 1.5) + sin(uTime * uMot.y + 1.0)) * 0.25 + 0.5;
  vec2 u = (pos - uCent.xy) * (uCent.w - breath * uMot.z);
  float ct = cos(uCent.z), st = sin(uCent.z);
  u = mat2(ct, st, -st, ct) * u;
  mat2 fold = mat2(cos(uFold.x), sin(uFold.x), -uFold.y, cos(uFold.x));
  float h0 = uHue.x * TAU;
  float h1 = h0 + uHue.y * TAU;
  vec3 color = vec3(0.0);
  for (int i = 1; i <= 96; i++) {
    float fi = float(i);
    if (fi > uFold.w) break;
    u.x += -sin(u.y * uWarp.x + t + fi * 0.007) * uWarp.z;
    u.y += -sin(u.x * uWarp.y - t + fi * 0.020) * uWarp.w;
    u = fold * u * uFold.z;
    vec2 q = u - vec2(uOff.x + breath * 0.1, uOff.y);
    vec2 sq = vec2(q.x * uShape.x, q.y * uShape.y);
    float glow = uShape.z / (dot(sq, sq) + uShape.w);
    glow *= 0.25 + breath * 0.4;
    float r = length(u);
    float k = sin(fi * uHue.w + t * 1.2 + r * uHue.z) * 0.5 + 0.5;
    vec3 tint = clamp(oklch(uCol.y + uCol.z * k, uCol.x * (0.75 + 0.35 * k), mix(h0, h1, k)), 0.0, 1.0);
    color += glow * tint * exp2(-r * uCol.w);
  }
  return color;
}

vec3 tonemap(vec3 c) {
  vec3 x = max(c, 0.0);
  c = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);   // ACES-ish
  return pow(clamp(c, 0.0, 1.0), vec3(0.85, 0.92, 0.98));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// 5x5 glyph packed as a bitmask; bit (x + 5y) is one lit cell. The classic
// ASCII-shader encoding — a ramp of five characters from sparse to solid.
float glyph(float n, vec2 p) {
  p = floor(p * vec2(4.0, -4.0) + 2.5);
  if (clamp(p.x, 0.0, 4.0) == p.x && clamp(p.y, 0.0, 4.0) == p.y) {
    if (mod(floor(n / exp2(p.x + 5.0 * p.y)), 2.0) == 1.0) return 1.0;
  }
  return 0.0;
}

// 4x4 Bayer matrix, unrolled — an ordered threshold beats random noise for
// posterising because the pattern is stable frame to frame and doesn't crawl.
float bayer(vec2 p) {
  vec2 c = mod(floor(p), 4.0);
  float i = c.x + 4.0 * c.y;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  for (int k = 0; k < 16; k++) { if (float(k) == i) return m[k] / 16.0; }
  return 0.0;
}

void main() {
  vec2 frag = vUV * uRes;
  vec2 pos = (frag - 0.5 * uRes) / uRes.y;
  float V = uVar;
  float px = 1.0 / uRes.y;          // one output pixel in field units

  // ── Variants that change WHERE the field is sampled ──────────────────────
  vec2 sp = pos;
  if (V > 5.5 && V < 6.5) {         // liquid: domain distortion before sampling
    float w = uTime * 0.18;
    sp += vec2(fbm2(pos * 2.4 + vec2(0.0, w)) - 0.5,
               fbm2(pos * 2.4 + vec2(4.7, -w)) - 0.5) * 0.22;
  }
  if (V > 6.5 && V < 7.5) {         // mosaic: quantise to tiles
    float cell = px * 14.0;
    sp = (floor(pos / cell) + 0.5) * cell;
  }

  vec3 color;
  if (V > 7.5) {                    // chroma: three samples at different radii
    color = vec3(fieldAt(sp * 1.028).r, fieldAt(sp).g, fieldAt(sp * 0.972).b);
  } else if (V > 1.5 && V < 2.5) {  // ascii: one sample per cell
    float cell = px * 9.0;
    vec2 cc = (floor(pos / cell) + 0.5) * cell;
    color = fieldAt(cc);
  } else if (V > 3.5 && V < 4.5) {  // halftone: one sample per cell
    float cell = px * 7.0;
    vec2 cc = (floor(pos / cell) + 0.5) * cell;
    color = fieldAt(cc);
  } else {
    color = fieldAt(sp);
  }
  color = tonemap(color);

  if (V > 0.5 && V < 1.5) {         // grain: OpenShaders triangular film grain
    const float uStrength = 1.15;
    const float uScale = 1.25;
    float size = max(1.0, 1.8 * uScale);
    vec2 n = hash3(vec3(floor(frag / size), floor(uTime * 24.0))).xy;
    float g = n.x + n.y - 1.0;
    float shade = clamp(luma(color), 0.0, 1.0);
    float response = 4.0 * shade * (1.0 - shade);
    color += g * (0.035 + 0.1 * response) * uStrength;
  } else if (V > 1.5 && V < 2.5) {  // ascii
    float cell = px * 9.0;
    vec2 uvc = fract(pos / cell) - 0.5;
    float l = luma(color);
    float n = 4194304.0;                                   // .
    if (l > 0.10) n = 4329476.0;                           // :
    if (l > 0.22) n = 8735236.0;                           // *
    if (l > 0.38) n = 15255086.0;                          // o
    if (l > 0.56) n = 23385164.0;                          // &
    if (l > 0.76) n = 33061418.0;                          // @
    color = color * (0.10 + 1.35 * glyph(n, uvc));
  } else if (V > 2.5 && V < 3.5) {  // dither to 5 levels per channel
    float th = bayer(frag) - 0.5;
    color = floor(color * 5.0 + 0.5 + th) / 5.0;
  } else if (V > 3.5 && V < 4.5) {  // halftone, screen rotated 45deg
    float cell = px * 7.0;
    float a = 0.785398;
    mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
    vec2 uvc = fract((rot * pos) / cell) - 0.5;
    float dot_ = smoothstep(0.52, 0.46, length(uvc) / max(0.001, sqrt(luma(color)) * 0.95));
    color *= 0.12 + 1.25 * dot_;
  } else if (V > 4.5 && V < 5.5) {  // sparkle: glints on the brightest cells
    float cell = px * 11.0;
    vec2 id = floor(pos / cell);
    vec2 uvc = fract(pos / cell) - 0.5;
    float seed = hash12(id);
    float twinkle = 0.5 + 0.5 * sin(uTime * 2.4 + seed * TAU * 3.0);
    float live = step(0.78, seed) * step(0.22, luma(color)) * twinkle;
    float star = max(0.0, 1.0 - abs(uvc.x) * 22.0) + max(0.0, 1.0 - abs(uvc.y) * 22.0);
    star *= max(0.0, 1.0 - length(uvc) * 3.2);
    color += vec3(star * live * 1.6);
  }

  color *= 1.0 - smoothstep(0.5, 1.6, length(pos)) * 0.06;            // vignette
  color += (blueNoise(frag, floor(uTime * 24.0)) - 0.5) / 255.0;        // blue noise debanding
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

/** Render one Field preset. Animated — driven by the caller's clock. */
export function renderFieldBackground(
  id: string,
  ms: number,
  w: number,
  h: number,
  style?: Partial<FieldStyle> | null
): OffscreenCanvas | HTMLCanvasElement | null {
  const scale = Math.min(1, MAX_EDGE / Math.max(1, Math.max(w, h)));
  const rw = Math.max(2, Math.round(w * scale));
  const rh = Math.max(2, Math.round(h * scale));
  const st = init(rw, rh);
  if (!st) return null;
  const { gl } = st;
  try {
    const p = fieldProgram(st);
    const base = fieldPreset(id);
    const f: FieldPreset = style ? { ...base, ...style } : base;
    gl.useProgram(p.prog);
    const aPos = gl.getAttribLocation(p.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    if (p.uRes) gl.uniform2f(p.uRes, rw, rh);
    if (p.uTime) gl.uniform1f(p.uTime, ms / 1000);
    if (p.uHue) gl.uniform4f(p.uHue, f.hue, f.hueSpread, f.hueTravel, f.colourCycle);
    if (p.uCol) gl.uniform4f(p.uCol, f.chroma, f.lightness, f.lightSwing, f.falloff);
    if (p.uFold) gl.uniform4f(p.uFold, f.theta, f.shear, f.shrink, f.layers);
    if (p.uWarp) gl.uniform4f(p.uWarp, f.warpFX, f.warpFY, f.warpAX, f.warpAY);
    if (p.uShape) gl.uniform4f(p.uShape, f.aspectX, f.aspectY, f.glow, f.soft);
    if (p.uMot) gl.uniform4f(p.uMot, f.speed, f.breathRate, f.breathAmt, f.phase);
    if (p.uCent) gl.uniform4f(p.uCent, f.centreX, f.centreY, f.tilt, f.zoom);
    if (p.uOff) gl.uniform2f(p.uOff, f.offsetX, f.offsetY);
    if (p.uVar) gl.uniform1f(p.uVar, FIELD_VARIANTS.indexOf(f.variant));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return st.canvas;
  } catch (e) {
    console.warn('[shaders] field render failed', e);
    unavailable = true;
    return null;
  }
}

/** Render one static mesh-gradient preset. No time input — it never moves. */
export function renderMeshBackground(
  id: string,
  w: number,
  h: number
): OffscreenCanvas | HTMLCanvasElement | null {
  const scale = Math.min(1, MAX_EDGE / Math.max(1, Math.max(w, h)));
  const rw = Math.max(2, Math.round(w * scale));
  const rh = Math.max(2, Math.round(h * scale));
  const st = init(rw, rh);
  if (!st) return null;
  const { gl } = st;
  try {
    const p = meshProgram(st);
    const preset = meshPreset(id);
    gl.useProgram(p.prog);
    const aPos = gl.getAttribLocation(p.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    if (p.uRes) gl.uniform2f(p.uRes, rw, rh);
    if (p.uTime) gl.uniform1f(p.uTime, preset.phase);
    const locs = [p.uC0, p.uC1, p.uC2, p.uC3];
    preset.colors.forEach((hex, i) => {
      const l = locs[i];
      if (l) { const [r, g, b] = hexToRgb(hex); gl.uniform3f(l, r, g, b); }
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return st.canvas;
  } catch (e) {
    console.warn('[shaders] mesh render failed', e);
    unavailable = true;
    return null;
  }
}
