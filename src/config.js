// Deck options + pure normalization. Anki-faithful defaults. Step lists are minutes.
// Browser global + node. The load/save boundary lives in the page glue, not here.

const DEFAULT_CONFIG = {
  newPerDay: 20,
  reviewsPerDay: 200,
  learnSteps: [1, 10],
  relearnSteps: [10],
  desiredRetention: 0.9,
  rolloverHour: 4,
  learnAheadMins: 20,
  leechThreshold: 8,
};

// Whitespace-separated minutes -> positive numbers; [] when none parse.
function parseSteps(str) {
  return String(str).trim().split(/\s+/).map(Number)
    .filter(n => Number.isFinite(n) && n > 0);
}

// Step minutes -> a single-space-separated string.
function formatSteps(arr) {
  return arr.join(' ');
}

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n))));

// Merge raw over the defaults, clamping every exposed field to a valid value.
function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG, ...raw };
  const ok = n => Number.isFinite(n) && n > 0;
  const learn = Array.isArray(c.learnSteps) ? c.learnSteps.filter(ok) : [];
  const relearn = Array.isArray(c.relearnSteps) ? c.relearnSteps.filter(ok) : [];
  return {
    newPerDay: isNaN(c.newPerDay) ? DEFAULT_CONFIG.newPerDay : clampInt(c.newPerDay, 0, 9999),
    reviewsPerDay: isNaN(c.reviewsPerDay) ? DEFAULT_CONFIG.reviewsPerDay : clampInt(c.reviewsPerDay, 0, 9999),
    learnSteps: learn.length ? learn : DEFAULT_CONFIG.learnSteps.slice(),
    relearnSteps: relearn.length ? relearn : DEFAULT_CONFIG.relearnSteps.slice(),
    desiredRetention: isNaN(c.desiredRetention) ? DEFAULT_CONFIG.desiredRetention
      : Math.min(0.97, Math.max(0.80, Number(c.desiredRetention))),
    rolloverHour: isNaN(c.rolloverHour) ? DEFAULT_CONFIG.rolloverHour : clampInt(c.rolloverHour, 0, 23),
    learnAheadMins: DEFAULT_CONFIG.learnAheadMins,
    leechThreshold: DEFAULT_CONFIG.leechThreshold,
  };
}

export { DEFAULT_CONFIG, parseSteps, formatSteps, normalizeConfig };
