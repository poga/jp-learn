# FSRS Scheduler — Design

## Goal

Replace the hand-rolled SM-2 scheduler (`srs.js`) with **FSRS-6**, the algorithm
current Anki ships by default. This makes the 五十音 practice page schedule like
real Anki: a Difficulty/Stability/Retrievability memory model, four grades,
sub-day learning steps, interval fuzz, and a desired-retention target. Fuzz and a
monotonic-interval guarantee fix the two flaws found in the SM-2 version (same-day
cohort clumping; Good and Easy collapsing to the same interval at small values).

## Decisions (locked during brainstorm)

- **Four grades**: Again / Hard / Good / Easy, keyboard 1 / 2 / 3 / 4 (Space = Good).
- **Default weights only**: ship FSRS-6's published default parameters. No
  optimizer / training on the user's own history.
- **Sub-day learning steps** (1m / 10m): scheduling moves from day-numbers to real
  **timestamps (ms)**.
- **Full reset**: old SM-2 progress and stats are discarded under new storage keys.
  No SM-2 → FSRS migration.
- **Session model A** (faithful wall-clock): always show the earliest card whose
  due time has passed; when only future learning cards remain, show a countdown
  until the next one ripens.
- **FSRS-6** specifically (21 weights), `desiredRetention = 0.9` (hardcoded, easily
  exposed later).

## Files

- `fsrs.js` — **new** pure scheduler, replaces `srs.js` (which is deleted). No DOM,
  no localStorage. Browser global + node `module.exports`, mirroring `kana.js`.
  The testable core.
- `anki.html` — add the **Hard** button; swap the `srs.js` script tag for `fsrs.js`.
- `anki.js` — timestamps, four-grade glue, the wall-clock learning queue + countdown,
  full-reset of legacy keys, new storage key.
- `stats.js` — **unchanged**. It buckets by day-number; the glue passes
  `floor(now / 86_400_000)`. Streaks / retention / breakdown keep working.
- `style.css` — four-button grade row, countdown styling.
- `test.js` — drop SM-2 tests, add FSRS invariant tests. Kana + stats tests stay.

## Card identity

Unchanged: a card is a `(kana entry, script)` pair, id `${entry.id}:${script}`
(e.g. `a:hira`). あ and ア are separate cards.

## Memory model & state — `fsrs.js`

State per card:

```
{ state, stability, difficulty, due, last_review, reps, lapses, step }
```

- `state` ∈ `new | learning | review | relearning`.
- `stability` `S` — days for recall probability to fall to 90%. Clamp `[0.001, 36500]`.
- `difficulty` `D` — intrinsic hardness, clamp `[1, 10]`.
- `due`, `last_review` — **epoch ms timestamps** (not day-numbers).
- `reps`, `lapses`, `step` (index into the current learning/relearning step array).

`newCard()` → `{ state:'new', stability:0, difficulty:0, due:0, last_review:0,
reps:0, lapses:0, step:0 }` (S/D are seeded on the first rating).

### Constants

```
W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
     1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
     1.8729, 0.5425, 0.0912, 0.0658, 0.1542]              // FSRS-6 defaults
DESIRED_RETENTION = 0.9
DECAY  = -W[20]                       // -0.1542
FACTOR = Math.pow(0.9, 1/DECAY) - 1   // R(S,S) = 0.9 anchor holds for any decay
S_MIN = 0.001, S_MAX = 36500, D_MIN = 1, D_MAX = 10
LEARN_STEPS_MS   = [1, 10].map(m => m*60_000)   // 1m, 10m
RELEARN_STEPS_MS = [10].map(m => m*60_000)      // 10m
DAY_MS = 86_400_000
NEW_PER_SESSION = 20
```

Grade is the numeric rating `G ∈ {1:again, 2:hard, 3:good, 4:easy}`.

### Formulas (verified against Anki `fsrs-rs` source)

Retrievability after `t` days since last review:
```
R(t, S) = (1 + FACTOR * t / S) ^ DECAY
```

Interval from stability (then round, clamp `[1, S_MAX]`, fuzz):
```
nextInterval(S) = (S / FACTOR) * (DESIRED_RETENTION ^ (1/DECAY) - 1)
```
At 0.9 this equals `S`.

Initial stability / difficulty (first rating, `G`):
```
S0(G) = clamp(W[G-1], S_MIN, S_MAX)
D0(G) = clamp(W[4] - exp(W[5] * (G-1)) + 1, 1, 10)
```

Difficulty update (every rating after the first):
```
dD    = -W[6] * (G - 3)
Dg    = D + dD * (10 - D) / 9                 // linear damping
D'    = W[7] * (D0(4) - Dg) + Dg              // mean-reversion toward D0(Easy)
D_new = clamp(D', 1, 10)
```

Stability on **success** (review state, `G ≥ 2`, elapsed ≥ 1 day):
```
hardPenalty = (G == 2) ? W[15] : 1
easyBonus   = (G == 4) ? W[16] : 1
S' = S * (1 + exp(W[8]) * (11 - D) * S^(-W[9])
              * (exp(W[10] * (1 - R)) - 1) * hardPenalty * easyBonus)
```

Stability on **lapse** (review state, `G == 1`):
```
S_fail = W[11] * D^(-W[12]) * ((S+1)^W[13] - 1) * exp(W[14] * (1 - R))
S'     = clamp(min(S_fail, S / exp(W[17]*W[18])), S_MIN, S_MAX)   // never rises
```

Stability on **same-day** review (learning / relearning states):
```
SInc = exp(W[17] * (G - 3 + W[18])) * S^(-W[19])
S'   = (G >= 2) ? S * max(SInc, 1) : S * SInc      // success can't shrink S
```

Interval **fuzz** (applied to day-intervals before setting `due`):
```
ranges = [[2.5,7,0.15], [7,20,0.10], [20,Infinity,0.05]]
if interval < 2.5: no fuzz
delta = 1 + Σ factor * max(0, min(interval, end) - start)
band  = [round(interval - delta), round(interval + delta)]   // clamp ≥ 1
fuzzed = random integer in band
```

### Scheduler API

- `schedule(card, grade, now, rng = Math.random)` → next state. Pure. `now` is a
  timestamp; `rng` is injected so fuzz is testable without mocks.
- `previewIntervals(card, now)` → `{ again, hard, good, easy }` of the next `due`
  delta for each grade (used for button labels; computed with fuzz off so labels
  are stable). Formatted by the glue (`1m`, `10m`, `4d`, `2mo`).
- `fuzzRange(interval)` → `{ min, max }` — pure, no randomness; directly testable.
- `retrievability(card, now)`, `nextInterval(S)` — exported helpers.

### State machine

`schedule` branches on `card.state` and `grade`. Difficulty updates on every
rating after the first. Review-state ratings use the success/lapse stability
formulas; learning/relearning ratings use the same-day formula. A **monotonic
clamp** on the projected (preview) intervals keeps the four buttons strictly
increasing (`again < hard < good < easy`), matching Anki.

- **new** (first rating): seed `S = S0(G)`, `D = D0(G)`.
  - Easy → graduate straight to `review`, `due = now + nextInterval(S)·DAY`.
  - Again/Hard/Good → enter `learning`; Good advances `step`, Again/Hard sit at
    `step` (Again resets to 0); `due = now + LEARN_STEPS_MS[step]`.
- **learning** / **relearning**: update `D`, update `S` (same-day formula).
  - Again → `step = 0`, `due = now + STEPS[0]`.
  - Hard → stay at `step`, `due = now + STEPS[step]`.
  - Good → `step += 1`; if past the last step, graduate to `review`
    (`due = now + nextInterval(S)·DAY`, fuzzed), else `due = now + STEPS[step]`.
  - Easy → graduate to `review` immediately (fuzzed interval).
- **review** (`t = (now − last_review)/DAY`, `R = retrievability`):
  - Again → lapse: `lapses += 1`, `S = lapseStability`, enter `relearning`,
    `step = 0`, `due = now + RELEARN_STEPS_MS[0]`.
  - Hard/Good/Easy → `S = successStability`, `interval = nextInterval(S)` fuzzed,
    `due = now + interval·DAY`, `reps += 1`.

Every rating sets `last_review = now`.

## Session & learning queue (anki.js) — model A

1. Build the active set: for every selected deck card, load its state (unseen →
   `newCard()`).
2. Each render tick choose the next card by priority among those with `due ≤ now`:
   overdue learning/relearning (earliest `due` first), then due reviews, then up to
   `NEW_PER_SESSION` new cards.
3. If nothing is due now but learning/relearning cards are due in the future, show a
   **countdown** (`next card in M:SS`, `setInterval` tick) until the earliest ripens,
   then render it.
4. If nothing is due now and nothing is scheduled for later this session (no future
   learning cards, new cap reached, no due reviews) → done screen.
5. Flip reveals the reading and the four `previewIntervals` labels. Grading calls
   `schedule`, persists, records the review (`recordReview(stats, grade,
   floor(now/DAY_MS))`), updates the streak. A re-shown learning card resurfaces
   naturally when its timestamp ripens — no manual re-queue.

The done screen, stats panel, streak line, and deck breakdown carry over; the
breakdown's new/learning/mature split now keys off FSRS `state` + interval
(mature = interval ≥ 21 days).

## Persistence & reset

- `localStorage['anki-fsrs-v1']` = `{ version: 1, cards: { [id]: state } }`.
- Stats bumped to `localStorage['anki-stats-v2']` so old stats are not read.
- On first load of this version, `removeItem` the legacy `anki-srs-v1` and
  `anki-stats-v1` keys (full reset). The script-toggle pref (`anki-deck-v1`) is a
  harmless UI preference and is kept.
- Reads/writes stay in `anki.js`; `fsrs.js` stays pure and node-testable.

## UI

- Add the **Hard** button between Again and Good. Grade row becomes four buttons.
- Keys: `1`=Again, `2`=Hard, `3`=Good, `4`=Easy; Space/Enter flips, Space = Good
  after flip.
- Flip shows each button's projected next interval via `previewIntervals`.
- Countdown element shown when the queue is waiting on a learning step.

## Testing (`test.js`)

`node --test`. FSRS invariants only, no mocks (a seeded `rng` is injected for fuzz,
which controls randomness, not behavior):

- `retrievability`: `R ≈ 0.9` at `t = S`; strictly decreasing in `t`.
- `nextInterval(S) ≈ S` at retention 0.9.
- Initial `S0`/`D0` match the formula per grade; `D0` highest for Again.
- Difficulty stays in `[1,10]`; Again raises D, Easy lowers it.
- Stability grows on success and grows more for Easy than Good than Hard.
- Lapse never increases stability (`S' ≤ S`).
- Same-day success never shrinks stability.
- `fuzzRange`: no fuzz below 2.5 d; band widens with interval per the range table.
- Monotonic projected intervals: `again < hard < good < easy`.
- Learning walk: new + Good steps through 1m → 10m → day-scale graduation; Again
  resets to step 0; Easy graduates immediately.

Does NOT assert the default weight values, `DESIRED_RETENTION`, or other tunable
constants.

## Aesthetic

Unchanged warm-minimal palette and dark-mode variables. Large centered card, calm
grade buttons (now four), small stats line, countdown rendered in the same muted
hint style.
