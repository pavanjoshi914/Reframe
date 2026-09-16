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

// A pixel this dark or darker counts as "the transparent margin" or a black bar.
// Not 0, because the encoder's colour conversion rounds a few values off true black.
const BLACK = 6;
// Scan cap per side. A window shadow margin is tens of pixels; pillarbox bars
// (e.g. a tall or square window inside a 16:9 canvas) can reach ~45% on each side.
const MAX_SIDE = 0.45;

/**
 * Find the black border or pillarbox/letterbox around a frame and return the crop
 * that removes it, or null if there is nothing to trim.
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

  // We trim if there is a 4-sided transparent margin (e.g. CSD window shadow),
  // OR pillarbox bars (opposing left & right), OR letterbox bars (opposing top & bottom).
  // Requiring opposing pairs is what protects content: an app whose left sidebar
  // is dark keeps it because the right edge has content.
  const hasHorizontalBars = left > 0 && right > 0;
  const hasVerticalBars = top > 0 && bottom > 0;
  if (!hasHorizontalBars && !hasVerticalBars) return null;

  // A completely black frame (e.g. warm-up frame) runs all scanned sides to the cap.
  if (left >= maxX && right >= maxX && top >= maxY && bottom >= maxY) return null;

  // A frame that is black on edges but only a pixel or two deep total is far
  // more likely to be an alignment rounding artifact than a margin or black bar.
  if (top + bottom + left + right < 4) return null;

  const cw = w - left - right;
  const ch = h - top - bottom;
  if (cw < w * 0.1 || ch < h * 0.1) return null;

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
