import type { CursorSample } from '@shared/ipc';

// Auto-zoom suggestion from captured cursor movement.
//
// Heuristic: people pause the cursor over what they're explaining. We scan the
// samples for "dwell" runs — stretches where the cursor stays within a small
// radius for at least MIN_DWELL_MS — and turn each into a zoom region centred
// on where they were pointing, with a short lead-in/out so the zoom eases in
// before the action and releases after. Overlapping/adjacent regions merge, and
// we keep at most MAX_ZOOMS (the longest dwells win). Constant motion with no
// dwell yields no suggestions.

export type ZoomSuggestion = {
  startMs: number;
  endMs: number;
  zoomLevel: number;
  zoomTargetX: number;
  zoomTargetY: number;
};

const DWELL_RADIUS = 0.06; // normalized distance — cursor "stays put" within this
const MIN_DWELL_MS = 700; // a dwell must last this long to be worth zooming
const LEAD_IN_MS = 350; // start the zoom slightly before the dwell
const LEAD_OUT_MS = 500; // hold slightly after
const MIN_GAP_MS = 400; // merge regions closer than this
const MAX_ZOOMS = 6;
const ZOOM_LEVEL = 2.0;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function suggestZoomsFromCursor(
  samples: CursorSample[] | null | undefined,
  durationMs: number
): ZoomSuggestion[] {
  if (!samples || samples.length < 5 || durationMs <= 0) return [];
  const pts = [...samples].sort((a, b) => a.t - b.t);

  // Find dwell runs. Anchor each run at its FIRST sample and keep extending
  // while samples stay within DWELL_RADIUS of that fixed anchor — a slow pan
  // eventually leaves the radius and ends the run (a running centroid would
  // just follow the pan and never break). cx/cy is the run's mean position.
  const runs: { start: number; end: number; cx: number; cy: number }[] = [];
  let i = 0;
  while (i < pts.length) {
    const ax = pts[i].x;
    const ay = pts[i].y;
    let j = i;
    let sumX = 0;
    let sumY = 0;
    let n = 0;
    while (j < pts.length && Math.hypot(pts[j].x - ax, pts[j].y - ay) <= DWELL_RADIUS) {
      sumX += pts[j].x;
      sumY += pts[j].y;
      n++;
      j++;
    }
    const start = pts[i].t;
    const end = pts[Math.max(i, j - 1)].t;
    if (n > 0 && end - start >= MIN_DWELL_MS) runs.push({ start, end, cx: sumX / n, cy: sumY / n });
    i = j > i ? j : i + 1; // always advance past the cluster we just scanned
  }
  if (runs.length === 0) return [];

  // Merge consecutive dwells only when they're close in time AND in space —
  // i.e. one dwell that briefly wobbled out and back. Distinct dwells (a jump
  // to a different spot) stay separate even if back-to-back.
  runs.sort((a, b) => a.start - b.start);
  const mergedRuns: typeof runs = [];
  for (const r of runs) {
    const last = mergedRuns[mergedRuns.length - 1];
    if (last && r.start - last.end < MIN_GAP_MS && Math.hypot(r.cx - last.cx, r.cy - last.cy) < DWELL_RADIUS) {
      last.end = Math.max(last.end, r.end);
    } else {
      mergedRuns.push({ ...r });
    }
  }

  // Add lead-in/out, then clamp each region's start to the previous region's
  // end so padded neighbours never overlap into back-to-back active zooms.
  const regions: ZoomSuggestion[] = [];
  for (const r of mergedRuns) {
    let startMs = Math.max(0, r.start - LEAD_IN_MS);
    const endMs = Math.min(durationMs, r.end + LEAD_OUT_MS);
    const prev = regions[regions.length - 1];
    if (prev) startMs = Math.max(startMs, prev.endMs);
    if (endMs - startMs < 200) continue;
    regions.push({ startMs, endMs, zoomLevel: ZOOM_LEVEL, zoomTargetX: clamp01(r.cx), zoomTargetY: clamp01(r.cy) });
  }

  // Keep the longest MAX_ZOOMS, restored to chronological order.
  regions.sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs));
  return regions.slice(0, MAX_ZOOMS).sort((a, b) => a.startMs - b.startMs);
}
