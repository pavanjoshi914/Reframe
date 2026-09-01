import type { CropRegion } from './store';

// Recording a single window on Linux grabs that window's own X11 drawable, and
// for a client-side-decorated window (Chrome, GTK apps, Electron apps) that
// drawable is BIGGER than the window you see: the toolkit reserves an invisible
// margin around it for the drop shadow and resize handles. That margin is fully
// transparent, H.264 has no alpha channel, and transparent flattens to pure
// black — so every such recording arrives inside a black picture frame.
//
// Measured on a 730x956 Chrome window: 16px left and right, 10px top, 32px
// bottom (asymmetric because a drop shadow sits low), 8.6% of the recorded area.
// The giveaway that it is transparency rather than a shadow someone drew is that
// the margin has exactly two luminance values across it, 0 and 255 — a hard cut,
// no gradient.
//
// Detection is deliberately timid. It only trims a line that is essentially pure
// black across its WHOLE length, so a dark-themed app whose edge pixels are
// #1e1e1e or which has one bright pixel in the margin keeps every pixel it has.

// A pixel this dark or darker counts as "the transparent margin". Not 0, because
// the encoder's colour conversion rounds a few values off true black.
const BLACK = 6;
// Give up rather than trim more than this off any one side. A window shadow is
// tens of pixels; anything approaching a third of the frame is content we have
// misread, not a margin.
const MAX_SIDE = 0.2;

/**
 * Find the pure-black border around a frame and return the crop that removes it,
 * or null if there is nothing to trim (or the frame doesn't look like a window
 * in a transparent margin).
 *
 * `read` returns the frame's pixels as RGBA rows, width*height*4.
 */
export function detectBlackBorder(
  data: Uint8ClampedArray,
  w: number,
  h: number
): CropRegion | null {
  if (w < 8 || h < 8) return null;

  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    // Max channel, not a weighted luminance: a saturated blue pixel is content
    // even though its perceptual luminance is low.
    return Math.max(data[i], data[i + 1], data[i + 2]);
  };
  const rowIsBlack = (y: number) => {
    for (let x = 0; x < w; x++) if (lum(x, y) > BLACK) return false;
    return true;
  };
  const colIsBlack = (x: number) => {
    for (let y = 0; y < h; y++) if (lum(x, y) > BLACK) return false;
    return true;
  };

  const maxY = Math.floor(h * MAX_SIDE);
  const maxX = Math.floor(w * MAX_SIDE);

  let top = 0;
  while (top < maxY && rowIsBlack(top)) top++;
  let bottom = 0;
  while (bottom < maxY && rowIsBlack(h - 1 - bottom)) bottom++;
  let left = 0;
  while (left < maxX && colIsBlack(left)) left++;
  let right = 0;
  while (right < maxX && colIsBlack(w - 1 - right)) right++;

  // The margin we are looking for surrounds the window, so it is present on all
  // four sides. Requiring that is what separates it from black bars, which come
  // in one opposing pair: a letterboxed video (bars top and bottom only) or a
  // pillarboxed one (left and right only) keeps its bars, because there they are
  // part of the picture rather than an artefact of how the window was grabbed.
  if (!top || !bottom || !left || !right) return null;

  // Any side that ran all the way to the cap means the scan never found content
  // — a blank warm-up frame, or a genuinely dark image. Without this a fully
  // black frame trims to the cap on all four sides and passes every check below,
  // silently cropping 36% off a perfectly good recording.
  if (top >= maxY || bottom >= maxY || left >= maxX || right >= maxX) return null;

  // A frame that is black on every side but only a pixel or two deep is far
  // more likely to be a letterboxed video or a dark UI than a window margin.
  if (top + bottom + left + right < 4) return null;

  const cw = w - left - right;
  const ch = h - top - bottom;
  if (cw < w * 0.5 || ch < h * 0.5) return null;

  return { x: left / w, y: top / h, width: cw / w, height: ch / h };
}

/**
 * Draw one frame of `video` and look for a black border. Returns the crop to
 * apply, or null to leave the recording alone.
 *
 * The frame is taken from partway in rather than t=0: the first frames of a
 * capture are often still warming up (a blank or half-composited window), and a
 * wholly black frame would look like a margin covering everything.
 */
export function detectBlackBorderFromVideo(video: HTMLVideoElement): CropRegion | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return detectBlackBorder(data, w, h);
  } catch {
    // A frame we can't read (not decoded yet) just means no auto-trim.
    return null;
  }
}
