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

// Stability seeded by the first rating g (1..4).
function initStability(g) {
  return clamp(W[g - 1], S_MIN, S_MAX);
}

// Difficulty seeded by the first rating g; also the mean-reversion anchor.
function initDifficulty(g) {
  return clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, D_MIN, D_MAX);
}

// Difficulty after a rating, with linear damping and mean reversion.
function nextDifficulty(D, g) {
  const dD = -W[6] * (g - 3);
  const damped = D + dD * (10 - D) / 9;
  const reverted = W[7] * (initDifficulty(4) - damped) + damped;
  return clamp(reverted, D_MIN, D_MAX);
}

// Stability after a successful cross-day review (g >= 2). R = recall now.
function successStability(S, D, R, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  const inc = Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9])
    * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy;
  return clamp(S * (1 + inc), S_MIN, S_MAX);
}

// Stability after a lapse (g === 1); capped so it never rises above S.
function lapseStability(S, D, R) {
  const sFail = W[11] * Math.pow(D, -W[12])
    * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R));
  return clamp(Math.min(sFail, S / Math.exp(W[17] * W[18])), S_MIN, S_MAX);
}

// Stability after a same-day (learning/relearning) review.
function sameDayStability(S, g) {
  const inc = Math.exp(W[17] * (g - 3 + W[18])) * Math.pow(S, -W[19]);
  return clamp(g >= 2 ? S * Math.max(inc, 1) : S * inc, S_MIN, S_MAX);
}

const FUZZ_RANGES = [[2.5, 7, 0.15], [7, 20, 0.10], [20, Infinity, 0.05]];

// Inclusive [min,max] day band Anki randomizes an interval within.
function fuzzRange(interval) {
  if (interval < 2.5) return { min: interval, max: interval };
  let delta = 1;
  for (const [start, end, f] of FUZZ_RANGES)
    delta += f * Math.max(0, Math.min(interval, end) - start);
  return { min: Math.max(1, Math.round(interval - delta)),
    max: Math.round(interval + delta) };
}

// An integer interval picked from the fuzz band using rng in [0,1).
function applyFuzz(interval, rng) {
  const { min, max } = fuzzRange(interval);
  return min + Math.floor(rng() * (max - min + 1));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { newCard, retrievability, nextInterval,
    initStability, initDifficulty, nextDifficulty,
    successStability, lapseStability, sameDayStability,
    fuzzRange, applyFuzz,
    DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS };
}
