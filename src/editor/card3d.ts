// 3D "card" renderer for the framed video.
//
// The compositor is a 2D canvas, whose transform model is affine — it can
// translate / scale / rotate / skew but has NO perspective term, so a tilted
// card (far edge narrower than near edge) cannot be drawn with drawImage or
// setTransform. This module draws the card as ONE textured quad on a small
// WebGL context with a real perspective projection, and hands back an RGBA
// canvas (transparent around the card) that the 2D pipeline composites with a
// single drawImage. Preview and export both go through drawFrame, so both get
// the same pixels from the same code.
//
// Two things must agree exactly — the pixels and where the cursor lands on the
// tilted surface — so BOTH use the same math here: `cardMatrix()` builds the
// model-view-projection, the shader applies it to the quad, and
// `projectCardPoint()` applies it to a point on the card for the cursor /
// click-ripple / shadow polygon. One source of truth; they can't drift apart.

import type { Rotation } from './export';

// ── 4x4 column-major matrices (WebGL convention) ───────────────────────────
type M4 = Float32Array;
const I4 = (): M4 => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  }
  return o;
}
const deg = (d: number) => (d * Math.PI) / 180;
function rotX(a: number): M4 { const c=Math.cos(a), s=Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
function rotY(a: number): M4 { const c=Math.cos(a), s=Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
function rotZ(a: number): M4 { const c=Math.cos(a), s=Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); }
function translate(x: number, y: number, z: number): M4 { const m = I4(); m[12]=x; m[13]=y; m[14]=z; return m; }
function scale(x: number, y: number, z: number): M4 { const m = I4(); m[0]=x; m[5]=y; m[10]=z; return m; }
function perspective(fovyRad: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovyRad / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}

// ── The card transform ─────────────────────────────────────────────────────
// Inputs are in OUTPUT pixels: the frame is outW×outH; the (unrotated, unzoomed)
// card occupies box (bx,by,bw,bh). The zoom is the SAME zoom the 2D path
// applies (level z about the box centre, focus offset tx,ty), folded into the
// model matrix so rotation composes with it identically.
export type CardXform = {
  outW: number; outH: number;
  bx: number; by: number; bw: number; bh: number;
  zoom: number;            // zoomLevel (1 = none)
  zoomTx: number;          // the 2D path's tx (px, pre-scale) — see drawVideoBox
  zoomTy: number;
  rot: Rotation;           // degrees
};

// Camera: a modest field of view so ±40° reads as a leaning card, not a
// fisheye. The card sits at z = -dist with its WIDTH spanning the box in
// screen px at that distance, so rotation=0,zoom=1 reproduces the 2D box
// exactly (verified in tests: corners land on the box corners).
const FOVY = deg(28);

// One card of a multi-card scene: offsets in card widths/heights (ox·bw px,
// oy·bh px, oz·bw px, +z toward the camera), rotation in degrees, uniform
// scale. The plain single-card render is the identity instance.
export type SceneInstance = {
  ox: number; oy: number; oz: number;
  rx: number; ry: number; rz: number;
  s: number;
};
export const IDENTITY_INSTANCE: SceneInstance = { ox: 0, oy: 0, oz: 0, rx: 0, ry: 0, rz: 0, s: 1 };

export function cardMatrix(x: CardXform, inst: SceneInstance = IDENTITY_INSTANCE): M4 {
  const { outW, outH, bx, by, bw, bh, zoom, zoomTx, zoomTy, rot } = x;
  const aspect = outW / outH;
  // World units: 1 unit = 1 output px at the card's depth, centred on the
  // FRAME centre with +y up (GL), so convert the box's px centre accordingly.
  const cxPx = bx + bw / 2 + zoom * zoomTx;      // zoomed centre (px, y-down)
  const cyPx = by + bh / 2 + zoom * zoomTy;
  const cx = cxPx - outW / 2;
  const cy = outH / 2 - cyPx;
  // Distance such that the full frame height maps to outH px at z=-dist.
  const dist = (outH / 2) / Math.tan(FOVY / 2);
  const proj = perspective(FOVY, aspect, 1, dist * 8);
  // model: scale the unit quad (-1..1) to the card size (w,h), zoom it, rotate,
  // then move to the card centre at depth -dist. Scene instances add their own
  // offset (converted from card units to px) and rotation around the card.
  let m = I4();
  m = mul(m, translate(cx + inst.ox * bw * zoom, cy + inst.oy * bh * zoom, -dist + inst.oz * bw * zoom));
  m = mul(m, rotX(deg(rot.tiltX + inst.rx)));
  m = mul(m, rotY(deg(rot.tiltY + inst.ry)));
  m = mul(m, rotZ(deg(rot.spinZ + inst.rz)));
  m = mul(m, scale((bw / 2) * zoom * inst.s, (bh / 2) * zoom * inst.s, 1));
  // MVP maps a unit quad corner (±1,±1,0,1) to clip space.
  return mul(proj, m);
}

// Convert clip-space to output px (y-down). Returns null behind the camera.
function clipToPx(v: [number, number, number, number], outW: number, outH: number): { x: number; y: number } | null {
  const w = v[3];
  if (w <= 1e-6) return null;
  const ndcX = v[0] / w, ndcY = v[1] / w;
  return { x: (ndcX * 0.5 + 0.5) * outW, y: (1 - (ndcY * 0.5 + 0.5)) * outH };
}
function apply(m: M4, p: [number, number, number, number]): [number, number, number, number] {
  return [
    m[0]*p[0] + m[4]*p[1] + m[8]*p[2]  + m[12]*p[3],
    m[1]*p[0] + m[5]*p[1] + m[9]*p[2]  + m[13]*p[3],
    m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14]*p[3],
    m[3]*p[0] + m[7]*p[1] + m[11]*p[2] + m[15]*p[3],
  ];
}

// A point ON the card given as u,v in 0..1 (card space, 0,0 = top-left, like
// the cropped video) → output px. This is what keeps the synthetic cursor,
// click ripples and the shadow polygon glued to the tilted surface: they use
// exactly the matrix the shader uses.
export function projectCardPoint(x: CardXform, u: number, v: number, inst?: SceneInstance): { x: number; y: number } | null {
  const m = cardMatrix(x, inst);
  // unit quad: u 0..1 → x -1..1 ; v 0..1 (top-down) → y 1..-1
  return clipToPx(apply(m, [u * 2 - 1, 1 - v * 2, 0, 1]), x.outW, x.outH);
}
export function projectCardCorners(x: CardXform): { x: number; y: number }[] | null {
  const c = [projectCardPoint(x, 0, 0), projectCardPoint(x, 1, 0), projectCardPoint(x, 1, 1), projectCardPoint(x, 0, 1)];
  return c.every(Boolean) ? (c as { x: number; y: number }[]) : null;
}

// ── WebGL renderer (lazily created, one per process) ───────────────────────
const VS = `
attribute vec2 aPos;      // unit quad corner
attribute vec2 aUV;
uniform mat4 uMVP;
varying vec2 vUV;
void main() { vUV = aUV; gl_Position = uMVP * vec4(aPos, 0.0, 1.0); }`;
const FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUV;
void main() { gl_FragColor = texture2D(uTex, vUV); }`;

type GLState = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  tex: WebGLTexture;
  uMVP: WebGLUniformLocation;
  vbo: WebGLBuffer;
};
let state: GLState | null = null;
let glUnavailable = false;

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

function init(w: number, h: number): GLState | null {
  if (glUnavailable) return null;
  if (state) {
    if (state.canvas.width !== w || state.canvas.height !== h) { state.canvas.width = w; state.canvas.height = h; state.gl.viewport(0, 0, w, h); }
    return state;
  }
  try {
    const canvas = makeCanvas(w, h);
    const gl = (canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true }) as WebGLRenderingContext | null);
    if (!gl) { glUnavailable = true; return null; }
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    // unit quad as a triangle strip: (x,y,u,v)
    const verts = new Float32Array([ -1,-1, 0,1,   1,-1, 1,1,   -1,1, 0,0,   1,1, 1,0 ]);
    const vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos'), aUV = gl.getAttribLocation(prog, 'aUV');
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV);  gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);
    const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.viewport(0, 0, w, h);
    const uMVP = gl.getUniformLocation(prog, 'uMVP')!;
    state = { canvas, gl, prog, tex, uMVP, vbo };
    return state;
  } catch (e) {
    console.warn('[card3d] WebGL unavailable, falling back to flat card', e);
    glUnavailable = true;
    return null;
  }
}

export function card3dAvailable(): boolean { return !glUnavailable && (state !== null || init(2, 2) !== null); }

// Draw `cardTexture` (the pre-rendered card: cropped video + rounded corners,
// RGBA with transparent corners, sized bw×bh or any size — it's just a texture)
// as the rotated quad and return an outW×outH RGBA canvas for compositing.
// Returns null if WebGL is unavailable (caller falls back to the flat 2D path).
export function renderCard3D(cardTexture: TexImageSource, x: CardXform): OffscreenCanvas | HTMLCanvasElement | null {
  return renderScene3D(cardTexture, x, [IDENTITY_INSTANCE]);
}

// Draw the same texture as MANY cards (a scene: ring, grid, stream…). Painter's
// algorithm — no depth buffer (blending needs draw order anyway), so sort
// far → near by each card's z offset before drawing.
export function renderScene3D(
  cardTexture: TexImageSource,
  x: CardXform,
  instances: SceneInstance[]
): OffscreenCanvas | HTMLCanvasElement | null {
  const st = init(x.outW, x.outH);
  if (!st) return null;
  const { gl, tex, uMVP, canvas } = st;
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cardTexture);
  const ordered = [...instances].sort((a, b) => a.oz - b.oz);
  for (const inst of ordered) {
    gl.uniformMatrix4fv(uMVP, false, cardMatrix(x, inst));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  return canvas;
}
