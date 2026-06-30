# Real Anki Queue Foundation (Phase 1) — Design

## Goal

The FSRS card math (`fsrs.js`) is already Anki-faithful. The *session* around it is
not: a single 1-minute learning step, one hardcoded `NEW_PER_DAY = 40` cap, no
review limit, a live per-second countdown, and queue logic tangled into the DOM.

Phase 1 rebuilds the **session/queue model** to behave like real Anki on the
existing kana deck: two daily limits, multi-step learning, even interleaving of new
and review cards, **learn-ahead** (no ticking countdown), and a **4am study-day
rollover**. The queue logic moves into a pure, unit-testable module mirroring how
real Anki keeps scheduling out of the UI.

This is the load-bearing phase of a trimmed 1–3 roadmap (queue → deck options →
custom study). No multi-deck, note types, or import — the kana deck stays the only
deck, so no collection rewrite and no IndexedDB (208 cards fit localStorage).

## Decisions (locked during brainstorm)

- **Scope**: real Anki *experience* on the fixed kana deck. Phases 1–3 only.
- **Two daily limits**: new/day and reviews/day, Anki defaults **20 / 200**.
  Learning/relearning cards count against neither (already introduced).
- **Real learning steps `1m 10m`** (relearn `10m`): a new card is seen twice before
  it graduates, replacing today's single 1-minute step.
- **Learn-ahead, not a countdown**: when only learning cards remain, show the next
  one *now* if it ripens within the **20-minute** learn-ahead window; otherwise show
  the done screen noting how many cards are still in learning. No per-second timer.
- **4am study-day rollover** (Anki default), replacing local-midnight. A late-night
  session counts toward the day it began.
- **Review due by day, learning due by timestamp**: a review card due "in N days"
  becomes available at the *start of its due day* (respecting the 4am rollover), not
  exactly N×24h after the review. Learning steps stay sub-day timestamps.
- **Config object with Anki defaults**, consumed by `fsrs.js` and `queue.js`. The
  settings UI that edits it is Phase 2; Phase 1 ships the defaults.
- **Non-destructive migration**: existing localStorage progress is kept, not wiped.

## Architecture

Real Anki keeps the scheduler pure and the queue separate from the UI. We mirror
that. Four modules, two of them pure and node-testable like `fsrs.js`:

- **`fsrs.js`** — card math. **Change**: learning/relearn steps and desired
  retention stop being module constants and become parameters threaded through
  `schedule` / `previewIntervals` (so Phase 2 options can drive them). Review-due
  timestamp assignment moves out to the caller (see Due semantics). Otherwise the
  S/D/R model, fuzz, and monotone intervals are unchanged.
- **`day.js`** *(new, pure)* — the day-number helper. `dayOf(ms, rolloverHour)` and
  `dayStart(day, rolloverHour)` implement the 4am-rollover day index and its inverse.
  One concept, isolated, so both `queue.js` and the glue share one definition.
- **`queue.js`** *(new, pure)* — the heart. Given `{cards, stats, config, now}` it
  returns the next action: a card to show, or a done descriptor. No DOM, no storage.
  This is the new testable core.
- **`config.js`** *(new)* — the deck-options object with Anki defaults. A plain
  module export in Phase 1; Phase 2 adds load/save + UI.
- **`stats.js`** — **add a review log** (`revlog`): one record per grade
  `{id, t, grade, state, lastIvl, ivl}`. Append-only, capped/rolling. Enables
  Phase 3 "study forgotten" and honest stats. Existing aggregate counters stay.
- **`anki.js`** — becomes thin glue: load store/stats/config → call `queue.js` for
  the next action → render the card or the done/learn-ahead screen → on grade, call
  `fsrs.schedule`, append revlog, save, re-pick.

## Queue behavior (`queue.js`)

`pickNext({cards, stats, config, now})` returns one of:

- `{kind: 'card', id}` — show this card.
- `{kind: 'done', learning, dueDay}` — nothing to show now; `learning` = count of
  cards still in their learning phase (beyond the learn-ahead window), `dueDay` =
  earliest day anything (new-cap permitting) is next available, for the "next due in
  N days" line.

Selection order, evaluated each call (so re-queued `Again` cards reappear correctly):

1. **Ready learning** — any learning/relearning card with `due <= now`: pick the
   earliest. Learning is always most urgent.
2. **New / review interleave** — with `newLeft = max(0, newPerDay − newDoneToday)`
   and `reviewsLeft = max(0, reviewsPerDay − reviewsDoneToday)`:
   - both a fresh new card and a due review available, both limits open → pick a
     **new** card when it is behind its proportional pace
     (`newDoneToday / newPerDay <= reviewsDoneToday / reviewsPerDay`), else the
     earliest-due review. This spreads ~1 new card per `reviewsPerDay/newPerDay`
     reviews, evenly across the session, like Anki's new-card spread. (Exact rule is
     a tunable; the invariant is *even interleave*, not new-then-reviews.)
   - only one side available/open → take it.
3. **Learn-ahead** — only learning cards remain (limits spent or nothing else due).
   Next learning `due` within `config.learnAheadMins` of `now` → show it now
   (`kind: 'card'`). Otherwise `kind: 'done'` with the learning count.
4. **Done** — nothing left → `kind: 'done'`.

`counts({cards, stats, config, now})` returns the header tallies
`{newLeft, learning, due}`, limit-capped, for the live `N new · N learning · N due`
display. Derived from the same inputs so the header and the queue never disagree.

## Due semantics & day rollover

- **`day.js`**: `dayOf(ms, h) = floor((ms − tzOffsetMs(ms) − h·3600000) / DAY_MS)`.
  `dayStart(day, h)` is its inverse → the epoch-ms instant the given study-day begins.
- **Review cards** graduate/advance to `due = dayStart(today + interval, rollover)`,
  assigned by the glue (using the interval `fsrs.schedule` already returns) so the
  card surfaces at the next rollover of its due day, not a rolling wall-clock offset.
  "Due today" = `dayOf(card.due) <= today`.
- **Learning/relearning cards** keep sub-day **timestamp** dues (`now + step`),
  compared directly against `now`. Unchanged from today.
- **Daily counters** (`newDoneToday`, `reviewsDoneToday`) read from `stats` bucketed
  by `dayOf(now, rollover)`; they reset naturally at the 4am boundary.

## Config (`config.js`)

```
{ newPerDay: 20, reviewsPerDay: 200,
  learnSteps: [1, 10], relearnSteps: [10],   // minutes
  desiredRetention: 0.9, rolloverHour: 4, learnAheadMins: 20 }
```

Phase 1 exports these defaults and threads them into `fsrs.js`/`queue.js`. The kana
deck is 208 cards, so 20 new/day introduces the full deck over ~10 days — faithful,
and raisable in Phase 2's settings panel.

## Testing strategy (no mocks, real behavior)

`queue.js` and `day.js` are pure → drive them directly in `test.js` with real card
states, real `stats`, an explicit `now`, and assert observable outcomes:

- **State-machine / queue invariants**: ready-learning preempts new and review;
  new and review interleave evenly (not all-new-then-reviews); a card graded `Again`
  re-enters the learning queue and reappears; new stops at `newPerDay`, reviews at
  `reviewsPerDay`; learning cards ignore both limits.
- **Learn-ahead boundary**: next learning card just inside 20 min → returned now;
  just outside → `kind: 'done'` with the right learning count. Drive to the
  boundary, assert the transition, not a fixed clock value.
- **Day rollover**: `dayOf` puts 3am and 5am on opposite study-days across a 4am
  boundary; a review due "in 1 day" first appears at the next 4am, not 24h later;
  daily counters reset across the boundary.
- **Multi-step learning end-to-end**: a new card driven `Good → Good` is seen twice
  then lands in `review` with a multi-day interval (real order, not a shortcut).

`fsrs.js` parameter-threading keeps its existing invariant tests green. Build tests
unchanged. All tests must pass.

## Migration

Non-destructive — no reset, unlike past upgrades. Existing `anki-fsrs-v1` card
states load unchanged; their stored review `due` timestamps stay valid (treated as
already-due day-wise the first time seen, which is correct). `revlog` starts empty.
`anki-stats-v2` keeps working; the per-day buckets it already records supply
`newDoneToday`/`reviewsDoneToday`.

## Out of scope (Phase 1)

- Settings UI (Phase 2), Custom Study / cram (Phase 3).
- Multiple decks, note types, add/edit cards, import/export.
- FSRS parameter optimization / training on user history.

## Roadmap (locked 1–3)

1. **This spec** — queue foundation.
2. **Deck options** — settings panel editing `config.js` (incl. rollover hour),
   per the values above.
3. **Custom Study / cram** — practice beyond limits (extra new, review ahead, study
   forgotten via `revlog`) through a temporary filtered queue that does not disturb
   the FSRS schedule.
