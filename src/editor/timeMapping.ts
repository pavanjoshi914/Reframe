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

  const introCard = cards.length > 0 && cards[0].startMs <= 800 ? cards[0] : null;

  let shift = 0;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const isIntro = card === introCard;

    if (timelineMs < card.startMs) {
      if (isIntro && timelineMs >= 0) {
        return { videoMs: 0, isPaused: true, activeTitleCard: card };
      }
      break;
    }
    if (timelineMs < card.endMs) {
      const insertVideoMs = isIntro
        ? 0
        : Math.max(0, card.startMs - (introCard ? introCard.endMs + shift : shift));
      return { videoMs: insertVideoMs, isPaused: true, activeTitleCard: card };
    }
    if (!isIntro) {
      shift += Math.max(0, card.endMs - card.startMs);
    }
  }

  const effectiveTimeline = introCard ? Math.max(0, timelineMs - introCard.endMs) : timelineMs;
  const videoMs = Math.max(0, effectiveTimeline - shift);
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

  const introCard = cards.length > 0 && cards[0].startMs <= 800 ? cards[0] : null;

  let shift = 0;
  for (const card of cards) {
    if (card === introCard) continue;
    const cardVideoStart = Math.max(0, card.startMs - (introCard ? introCard.endMs + shift : shift));
    if (videoMs < cardVideoStart) {
      break;
    }
    shift += Math.max(0, card.endMs - card.startMs);
  }
  return videoMs + (introCard ? introCard.endMs : 0) + shift;
}
