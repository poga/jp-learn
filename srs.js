// SM-2 spaced repetition, adapted to 3 grades. Pure. Browser global + node.
// Intervals are whole days; `due`/`today` are day-numbers, not timestamps.

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const EASY_BONUS = 1.3;

// A fresh, never-reviewed card.
function newCard() {
  return { ease: DEFAULT_EASE, interval: 0, reps: 0, due: 0, new: true };
}

// Apply a grade and return the next state. grade is 'again' | 'good' | 'easy'.
function schedule(card, grade, today) {
  let { ease, interval, reps } = card;
  if (grade === 'again') {
    if (reps > 0) ease -= 0.2; // only penalize cards that were already learned
    reps = 0;
    interval = 0; // relearn this same session
  } else if (reps === 0) {
    interval = grade === 'easy' ? 4 : 1;
    if (grade === 'easy') ease += 0.15;
    reps = 1;
  } else {
    const mult = grade === 'easy' ? ease * EASY_BONUS : ease;
    interval = Math.max(1, Math.round(interval * mult));
    if (grade === 'easy') ease += 0.15;
    reps += 1;
  }
  ease = Math.max(MIN_EASE, ease);
  return { ease, interval, reps, due: today + interval, new: false };
}

// New cards are always due; reviews are due once `today` reaches their date.
function isDue(card, today) {
  return card.new || card.due <= today;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { newCard, schedule, isDue, DEFAULT_EASE, MIN_EASE };
}
