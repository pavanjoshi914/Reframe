import type { LaneItem } from './store';

/**
 * Computes the total timeline duration including all pausing title cards (interstitial screens).
 */
export function computeTotalDuration(baseDurationMs: number, items: LaneItem[]): number {
  const pauseMs = items
    .filter((it) => it.kind === 'titleCard' && it.pauseVideo !== false)
    .reduce((sum, it) => sum + Math.max(0, it.endMs - it.startMs), 0);
  return Math.max(100, (baseDurationMs || 0) + pauseMs);
}

/**
 * Maps a timeline timestamp (ms from 0 to total timeline duration) to the corresponding
 * source video timestamp (ms from 0 to base recording duration).
 *
 * If timelineMs falls inside a pausing title card, isPaused is true, and videoMs is the
 * frozen frame timestamp where the title card was inserted.
 */
export function timelineToVideoMs(
  timelineMs: number,
  items: LaneItem[]
): { videoMs: number; isPaused: boolean; activeTitleCard?: LaneItem } {
  const cards = items
    .filter((it) => it.kind === 'titleCard' && it.pauseVideo !== false)
    .sort((a, b) => a.startMs - b.startMs);

  let shift = 0;
  for (const card of cards) {
    if (timelineMs < card.startMs) {
      break;
    }
    if (timelineMs < card.endMs) {
      const videoMs = Math.max(0, card.startMs - shift);
      return { videoMs, isPaused: true, activeTitleCard: card };
    }
    shift += Math.max(0, card.endMs - card.startMs);
  }

  const videoMs = Math.max(0, timelineMs - shift);
  return { videoMs, isPaused: false };
}

/**
 * Maps a source video timestamp (ms) to the corresponding timeline position (ms),
 * accounting for all preceding pausing title cards.
 */
export function videoToTimelineMs(
  videoMs: number,
  items: LaneItem[]
): number {
  const cards = items
    .filter((it) => it.kind === 'titleCard' && it.pauseVideo !== false)
    .sort((a, b) => a.startMs - b.startMs);

  let shift = 0;
  for (const card of cards) {
    const cardVideoStart = card.startMs - shift;
    if (videoMs < cardVideoStart) {
      break;
    }
    shift += Math.max(0, card.endMs - card.startMs);
  }
  return videoMs + shift;
}
