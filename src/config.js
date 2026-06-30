// Deck options. Anki-faithful defaults; Phase 2 adds load/save + a settings UI.
// Step lists are in minutes.

const DEFAULT_CONFIG = {
  newPerDay: 20,
  reviewsPerDay: 200,
  learnSteps: [1, 10],
  relearnSteps: [10],
  desiredRetention: 0.9,
  rolloverHour: 4,
  learnAheadMins: 20,
};

export { DEFAULT_CONFIG };
