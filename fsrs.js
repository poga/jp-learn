// FSRS-6 spaced repetition. Pure. Browser global + node.
// due/last_review are epoch-ms; review intervals are whole days.

const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
  1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
  1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
const DESIRED_RETENTION = 0.9;
const DECAY = -W[20];
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
const S_MIN = 0.001, S_MAX = 36500, D_MIN = 1, D_MAX = 10;
const DAY_MS = 86400000, MIN_MS = 60000;
const LEARN_STEPS = [1 * MIN_MS, 10 * MIN_MS];
const RELEARN_STEPS = [10 * MIN_MS];
const GRADES = { again: 1, hard: 2, good: 3, easy: 4 };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// A fresh, never-reviewed card. S/D are seeded on the first rating.
function newCard() {
  return { state: 'new', stability: 0, difficulty: 0,
    due: 0, last_review: 0, reps: 0, lapses: 0, step: 0 };
}

// Recall probability t days after the last review.
function retrievability(S, t) {
  return Math.pow(1 + FACTOR * t / S, DECAY);
}

// Whole days until recall drops to DESIRED_RETENTION; equals S at 0.9.
function nextInterval(S) {
  const ivl = (S / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(ivl), 1, S_MAX);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { newCard, retrievability, nextInterval,
    DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS };
}
