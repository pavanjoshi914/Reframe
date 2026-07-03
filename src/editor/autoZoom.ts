import type { CursorSample, ClickSample } from '@shared/ipc';

// Auto-zoom suggestion from captured cursor ACTIVITY — clicks first, then dwell.
//
// The signature "pro demo" move is the camera punching in when the user *does*
// something. Clicks are the strongest action signal, so each click (or cluster
// of clicks in the same spot) becomes a zoom centred on it, easing in just
// before the click and holding briefly after. Dwell (the cursor lingering over
// what's being explained) is a weaker, secondary signal kept for narrated
// stretches with no clicks. Click and dwell regions in the same place/time
// merge into one held zoom; when we have more candidates than MAX_ZOOMS, click
// regions win. Constant motion with no clicks or dwell yields nothing.

export type ZoomSuggestion = {
  startMs: number;
  endMs: number;
  zoomLevel: number;
  zoomTargetX: number;
  zoomTargetY: number;
};

// Dwell (movement) tuning.
const DWELL_RADIUS = 0.06; // normalized distance — cursor "stays put" within this
const MIN_DWELL_MS = 700; // a dwell must last this long to be worth zooming
const LEAD_IN_MS = 350; // start the zoom slightly before the dwell
const LEAD_OUT_MS = 500; // hold slightly after
const MIN_GAP_MS = 400; // merge dwell runs closer than this
const ZOOM_LEVEL = 2.0;

// Click (action) tuning — punchier and held a touch longer than a dwell.
const CLICK_CLUSTER_MS = 1200; // clicks within this of each other join one cluster
const CLICK_CLUSTER_RADIUS = 0.12; // …and within this normalized distance
const CLICK_LEAD_IN_MS = 300; // punch in just before the click
const CLICK_HOLD_MS = 1000; // linger after the last click in the cluster
const CLICK_ZOOM_LEVEL = 2.2;

// Combine tuning.
const MERGE_GAP_MS = 500; // regions closer than this in time may merge…
const MERGE_RADIUS = 0.12; // …if also within this normalized distance
const MAX_ZOOMS = 6;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

type Run = { start: number; end: number; cx: number; cy: number };

// Dwell runs: stretches where the cursor stays within DWELL_RADIUS of the run's
// FIRST sample for at least MIN_DWELL_MS. Anchoring at the first sample (not a
// running centroid) means a slow pan eventually leaves the radius and ends the
// run instead of dragging it along.
function dwellRuns(samples: CursorSample[]): Run[] {
  const pts = [...samples].sort((a, b) => a.t - b.t);
  const runs: Run[] = [];
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

  // Merge consecutive dwells that are close in BOTH time and space (one dwell
  // that briefly wobbled out and back); distinct dwells stay separate.
  runs.sort((a, b) => a.start - b.start);
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < MIN_GAP_MS && Math.hypot(r.cx - last.cx, r.cy - last.cy) < DWELL_RADIUS) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

// Click clusters: consecutive clicks within CLICK_CLUSTER_MS and
// CLICK_CLUSTER_RADIUS of each other collapse into one run (e.g. a double-click,
// or a few clicks on the same control) centred on the clicks' mean position.
function clickRuns(clicks: ClickSample[]): Run[] {
  const pts = [...clicks].sort((a, b) => a.t - b.t);
  const runs: Run[] = [];
  let i = 0;
  while (i < pts.length) {
    let j = i;
    let sumX = 0;
    let sumY = 0;
    let n = 0;
    // Extend while the next click is close in time (to its predecessor) and
    // space (to the cluster's running mean).
    while (j < pts.length) {
      const mx = n ? sumX / n : pts[j].x;
      const my = n ? sumY / n : pts[j].y;
      const dt = j > i ? pts[j].t - pts[j - 1].t : 0;
      if (j > i && (dt > CLICK_CLUSTER_MS || Math.hypot(pts[j].x - mx, pts[j].y - my) > CLICK_CLUSTER_RADIUS)) break;
      sumX += pts[j].x;
      sumY += pts[j].y;
      n++;
      j++;
    }
    runs.push({ start: pts[i].t, end: pts[j - 1].t, cx: sumX / n, cy: sumY / n });
    i = j;
  }
  return runs;
}

// Primary API: suggest zoom regions from cursor movement + clicks.
export function suggestZoomsFromActivity(
  samples: CursorSample[] | null | undefined,
  clicks: ClickSample[] | null | undefined,
  durationMs: number
): ZoomSuggestion[] {
  if (durationMs <= 0) return [];
  const hasSamples = !!samples && samples.length >= 5;
  const hasClicks = !!clicks && clicks.length > 0;
  if (!hasSamples && !hasClicks) return [];

  type Cand = Run & { fromClick: boolean };
  const cands: Cand[] = [
    ...(hasClicks ? clickRuns(clicks as ClickSample[]).map((r) => ({ ...r, fromClick: true })) : []),
    ...(hasSamples ? dwellRuns(samples as CursorSample[]).map((r) => ({ ...r, fromClick: false })) : [])
  ];
  if (cands.length === 0) return [];

  // Merge candidates that are close in time AND space into one region. A click
  // preceded by a dwell on the same control (move → pause → click) becomes a
  // single held zoom instead of two; the click's centre + priority win.
  cands.sort((a, b) => a.start - b.start);
  const merged: Cand[] = [];
  for (const r of cands) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < MERGE_GAP_MS && Math.hypot(r.cx - last.cx, r.cy - last.cy) < MERGE_RADIUS) {
      last.end = Math.max(last.end, r.end);
      last.start = Math.min(last.start, r.start);
      if (r.fromClick && !last.fromClick) {
        last.cx = r.cx;
        last.cy = r.cy;
      }
      last.fromClick = last.fromClick || r.fromClick;
    } else {
      merged.push({ ...r });
    }
  }

  // Add lead-in / hold, then clamp each region's start to the previous region's
  // end so padded neighbours hand off sequentially instead of overlapping.
  type Region = ZoomSuggestion & { fromClick: boolean };
  const regions: Region[] = [];
  for (const r of merged) {
    const leadIn = r.fromClick ? CLICK_LEAD_IN_MS : LEAD_IN_MS;
    const hold = r.fromClick ? CLICK_HOLD_MS : LEAD_OUT_MS;
    let startMs = Math.max(0, r.start - leadIn);
    const endMs = Math.min(durationMs, r.end + hold);
    const prev = regions[regions.length - 1];
    if (prev) startMs = Math.max(startMs, prev.endMs);
    if (endMs - startMs < 250) continue;
    regions.push({
      startMs,
      endMs,
      zoomLevel: r.fromClick ? CLICK_ZOOM_LEVEL : ZOOM_LEVEL,
      zoomTargetX: clamp01(r.cx),
      zoomTargetY: clamp01(r.cy),
      fromClick: r.fromClick
    });
  }

  // Cap: click regions win, then longer regions; restore chronological order.
  regions.sort(
    (a, b) => Number(b.fromClick) - Number(a.fromClick) || b.endMs - b.startMs - (a.endMs - a.startMs)
  );
  return regions
    .slice(0, MAX_ZOOMS)
    .sort((a, b) => a.startMs - b.startMs)
    .map(({ startMs, endMs, zoomLevel, zoomTargetX, zoomTargetY }) => ({ startMs, endMs, zoomLevel, zoomTargetX, zoomTargetY }));
}

// Back-compat wrapper (movement only).
export function suggestZoomsFromCursor(
  samples: CursorSample[] | null | undefined,
  durationMs: number
): ZoomSuggestion[] {
  return suggestZoomsFromActivity(samples, null, durationMs);
}
