# Anki parity fixes — design

Audit of the kana SRS against real Anki (FSRS, v3 scheduler) found five behavior
gaps. This spec closes them. Everything else checked — FSRS-6 math and weights,
fuzz bands, 4am rollover, learn-ahead, daily limits, new/review interleave,
relearning, deck options, custom study — already matches Anki. Sibling burying
is off by default in modern Anki, so its absence is not a gap.

## Scope

In: the five fixes below. Out (kept at Anki defaults or Anki-optional):
manual suspend/bury UI, burying options, configurable leech threshold /
learn-ahead / max interval (fixed at 8 / 20min / 36500d), card browser,
filtered-deck options beyond the existing cram, undo of non-answer operations.

## 1. Hard repeats the current learning step (`fsrs.js`)

Anki's rule for Hard on a learning/relearning card:

- step 0, ≥2 steps: delay = average of the first two steps
- step 0, single step: delay = step × 1.5
- step > 0: delay = the current step, repeated

The app instead averages `steps[i]` and `steps[i+1]` on every non-final step
and uses ×1.5 on the final step. With steps `1 10 60`, Hard on the 10m step
gives 35m; Anki gives 10m. Fix the `g === 2` branch to the Anki rule. `step`
stays unchanged (Hard never advances).

## 2. Undo the last answer (`anki.js`, inverse helpers in `stats.js`)

Session-only, in-memory stack, capped at 100 entries.

- Normal grade pushes `{ id, prev: <card snapshot before scheduling>, day,
  grade, wasNew, wasReview, autoSuspended }`. Cram grade pushes
  `{ mode: 'cram', queue: <queue before cramAdvance> }`.
- Undo pops one entry. Normal: restore `store[id] = prev`, reverse the stats
  via pure inverses, drop the matching log tail entry, `reviewed--`, set
  `current = id`, render front-side-up, persist. Cram: restore the queue and
  `crammed--`. Works from the done screen too — undo returns to the stage,
  like Anki.
- `stats.js` gains pure inverses `unrecordReview(stats, grade, day, wasReview)`,
  `unrecordNew(stats, day)`, `unrecordLog(stats)`; each exactly reverses its
  record counterpart (day buckets decrement, never go negative, and an emptied
  bucket may remain at zeros — reads treat missing and zero alike).
- UI: `z` and Ctrl+Z keys, plus a small "↩ undo" button near the stats line,
  hidden while the stack is empty. The stack clears on config save / deck
  change / session rebuild (the snapshots' day and queue context is stale).

## 3. Leeches: auto-suspend at the Anki threshold (`fsrs.js`, `queue.js`, `anki.js`)

- `fsrs.js` exports pure `isLeech(lapses, threshold = 8)` implementing Anki's
  trigger: `lapses >= threshold && (lapses - threshold) % max(1,
  floor(threshold / 2)) === 0` — fires at 8, 12, 16… with the default.
- In `grade()`: when Again lapses a review card and `isLeech(card.lapses)`,
  set `suspended: true` on the stored card (recorded in the undo entry so
  undo also unsuspends).
- `queue.partition` skips suspended cards entirely, which removes them from
  picks, counts, and `nextDueDay`. Cram excludes them too (Anki filtered
  decks skip suspended cards). `deckBreakdown` counts them separately.
- Surfacing: stats panel and done screen show "N leeches suspended" plus an
  "unsuspend all" button that clears every `suspended` flag, saves, and
  rebuilds the session. No per-card browser (out of scope).
- `DEFAULT_CONFIG.leechThreshold: 8`, normalized like `learnAheadMins`
  (always forced to the default; not in the options panel).

## 4. Honest done screen when the review limit hides cards (`queue.js`, `anki.js`)

- `nextDueDay` gains the spent-limit context: when due reviews remain but
  `revDone >= reviewsPerDay`, they contribute `today + 1`, not `today` — the
  hint no longer vanishes.
- `pickNext`'s done payload gains `revHidden`: the count of due reviews
  blocked by the spent limit. The done screen renders Anki's message for it:
  "daily review limit reached — N waiting". The existing "study more new"
  button already covers the new-card side.

## 5. Retention range matches Anki (`config.js`, `anki.html`)

Clamp `desiredRetention` to [0.70, 0.99] (was [0.80, 0.97]); input
`min="70" max="99"`.

## Data flow / compatibility

Card blobs gain optional `suspended: true`; absent means active, so existing
`anki-fsrs-v1` stores load unchanged. Stats shape is untouched (inverses only
mutate existing counters). No storage migrations.

## Error handling

Undo with an empty stack is a no-op. Unsuspend-all with none suspended never
renders (button only shows when count > 0). Stats inverses floor at zero so a
corrupt store cannot drive counters negative.

## Testing

Pure-function tests in `test.js`, no mocks, real flows:

- fsrs: Hard on a middle step repeats it; lone step ×1.5; first-of-two
  averages (existing behavior pinned); `isLeech` fires at 8 and 12, not 7/9.
- queue: a suspended card is never picked, counted, nor drives `nextDueDay`;
  `nextDueDay` reports tomorrow when dues remain past the spent limit;
  done payload carries `revHidden`.
- stats: record→unrecord round-trips reviews/new/log, including the
  again-counter split; floors at zero.
- config: retention clamps to 0.70/0.99 at the edges.
