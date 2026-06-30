import { dayOf } from './day.js';
import { newOn, revDoneOn } from './stats.js';
import { DEFAULT_CONFIG } from './config.js';

// Pure session queue over a deck of card states. No DOM, no storage: callers pass
// the card array, the stats log, the config, and the current time. Mirrors Anki's
// new/learning/review interleave with two daily limits and a learn-ahead window.

const isLearn = s => s === 'learning' || s === 'relearning';

// Split the deck relative to `now`/`today` into the queues the picker draws from.
function partition(cards, cfg, now, today) {
  const readyLearn = [], pendingLearn = [], fresh = [], dueRev = [];
  for (const c of cards) {
    if (isLearn(c.state)) (c.due <= now ? readyLearn : pendingLearn).push(c);
    else if (c.state === 'new') fresh.push(c);
    else if (dayOf(c.due, cfg.rolloverHour) <= today) dueRev.push(c);
  }
  readyLearn.sort((a, b) => a.due - b.due);
  pendingLearn.sort((a, b) => a.due - b.due);
  dueRev.sort((a, b) => a.due - b.due);
  return { readyLearn, pendingLearn, fresh, dueRev };
}

// Earliest study-day with available work, or null. Learning is handled separately
// via the done `learning` count, so it is excluded here.
function nextDueDay(cards, cfg, today, newDone) {
  const canNew = newDone < cfg.newPerDay;
  let min = null;
  for (const c of cards) {
    let d = null;
    if (c.state === 'new') d = canNew ? today : today + 1;
    else if (c.state === 'review') {
      const dd = dayOf(c.due, cfg.rolloverHour);
      d = dd > today ? dd : today;
    }
    if (d != null && (min == null || d < min)) min = d;
  }
  return min;
}

function pickNext({ cards, stats, config = DEFAULT_CONFIG, now }) {
  const today = dayOf(now, config.rolloverHour);
  const newDone = newOn(stats, today), revDone = revDoneOn(stats, today);
  const { readyLearn, pendingLearn, fresh, dueRev } = partition(cards, config, now, today);

  if (readyLearn.length) return { kind: 'card', id: readyLearn[0].id };

  const newOpen = newDone < config.newPerDay && fresh.length > 0;
  const revOpen = revDone < config.reviewsPerDay && dueRev.length > 0;
  if (newOpen && revOpen) {
    // introduce a new card when it is behind its proportional pace, else review.
    const newBehind = newDone / config.newPerDay <= revDone / config.reviewsPerDay;
    return { kind: 'card', id: (newBehind ? fresh[0] : dueRev[0]).id };
  }
  if (newOpen) return { kind: 'card', id: fresh[0].id };
  if (revOpen) return { kind: 'card', id: dueRev[0].id };

  // only not-yet-ripe learning cards remain: learn-ahead or report done.
  if (pendingLearn.length) {
    const soon = pendingLearn[0];
    if (soon.due - now <= config.learnAheadMins * 60000)
      return { kind: 'card', id: soon.id };
  }
  return { kind: 'done', learning: pendingLearn.length,
    dueDay: nextDueDay(cards, config, today, newDone) };
}

function counts({ cards, stats, config = DEFAULT_CONFIG, now }) {
  const today = dayOf(now, config.rolloverHour);
  const newDone = newOn(stats, today), revDone = revDoneOn(stats, today);
  const { readyLearn, pendingLearn, fresh, dueRev } = partition(cards, config, now, today);
  return {
    newLeft: Math.min(fresh.length, Math.max(0, config.newPerDay - newDone)),
    learning: readyLearn.length + pendingLearn.length,
    due: Math.min(dueRev.length, Math.max(0, config.reviewsPerDay - revDone)),
  };
}

export { pickNext, counts };
