# Real Anki Queue Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc single-cap, single-learning-step, countdown-based session in `anki.js` with a real-Anki queue: two daily limits, `1m 10m` learning steps, learn-ahead, a 4am study-day rollover, and review-due-by-day — with the queue logic extracted into pure, node-testable modules.

**Architecture:** New pure modules `day.js` (rollover math), `config.js` (Anki-default options), and `queue.js` (the session queue) sit beside the existing pure `fsrs.js`. `fsrs.js` gains config-driven steps/retention and assigns review dues by study-day. `stats.js` gains a review-state counter and a review log. `anki.js` becomes thin DOM glue over `queue.js`.

**Tech Stack:** Vanilla ESM modules (browser global + node import), `node:test`, esbuild bundling. No new dependencies.

## Global Constraints

- **No new dependencies.** Vanilla ESM only, mirroring `kana.js`/`fsrs.js`.
- **Pure modules stay pure:** `day.js`, `config.js`, `queue.js`, `fsrs.js`, `stats.js` — no DOM, no `localStorage`, no `Date.now()` inside pure functions (callers pass `now`).
- **Comments ≤ 1 line, terse**, "why/what" not "how"; no ticket/branch refs.
- **No mocks in tests.** Drive real pure functions with real state and an explicit `now`; assert observable outcomes.
- **All tests pass** (`node test.js`) at the end of every task.
- **Test runner:** `node test.js`. Run a single test with `node --test-name-pattern '<substr>' test.js`.
- **Anki defaults (verbatim):** newPerDay 20, reviewsPerDay 200, learnSteps `[1, 10]` min, relearnSteps `[10]` min, desiredRetention 0.9, rolloverHour 4, learnAheadMins 20.
- **Non-destructive migration:** keep existing `anki-fsrs-v1` / `anki-stats-v2`; do not wipe.

## File Structure

- `src/day.js` — **new, pure.** `dayOf(ms, rolloverHour)`, `dayStart(day, rolloverHour)`.
- `src/config.js` — **new.** `DEFAULT_CONFIG`.
- `src/queue.js` — **new, pure.** `pickNext({cards, stats, config, now})`, `counts({cards, stats, config, now})`.
- `src/fsrs.js` — **modify.** Config-driven steps/retention; review dues via `day.js`.
- `src/stats.js` — **modify.** Review-state counter + `revDoneOn`; review log + `recordLog`.
- `src/anki.js` — **modify.** Wire `queue.js`/`config.js`/`day.js`; drop countdown; done screen.
- `src/anki.html` — **modify.** Remove the unused `#countdown` element.
- `test.js` — **modify.** New `day.js`/`queue.js` tests; rewrite affected `fsrs.js` tests; extend `stats.js` tests.

---

### Task 1: `day.js` — study-day rollover math

**Files:**
- Create: `src/day.js`
- Test: `test.js` (append day.js block)

**Interfaces:**
- Produces: `dayOf(ms, rolloverHour=0) -> int` (study-day index), `dayStart(day, rolloverHour=0) -> ms` (instant that study-day begins). Round-trip: `dayOf(dayStart(d, h), h) === d`.

- [ ] **Step 1: Write the failing tests**

Append to `test.js`:

```js
import { dayOf, dayStart } from './src/day.js';

test('day: rollover splits a calendar day at the rollover hour', () => {
  const base = dayStart(20000, 4);          // 04:00 local on study-day 20000
  // 3h after rollover is the same study-day; 21h after crosses into the next.
  assert.equal(dayOf(base + 3 * 3600000, 4), 20000);
  assert.equal(dayOf(base + 21 * 3600000, 4), 20001);
  // 1h before rollover still belongs to the previous study-day.
  assert.equal(dayOf(base - 3600000, 4), 19999);
});

test('day: dayStart is the inverse of dayOf and lands one day apart', () => {
  for (const d of [18000, 19999, 20000, 20377]) {
    assert.equal(dayOf(dayStart(d, 4), 4), d);
    assert.ok(dayStart(d + 1, 4) - dayStart(d, 4) >= 23 * 3600000); // ~1 day (DST-tolerant)
  }
});

test('day: a review due-dated to tomorrow surfaces only next study-day', () => {
  const T = dayStart(20000, 4) + 20 * 3600000; // late in study-day 20000
  const due = dayStart(dayOf(T, 4) + 1, 4);     // due "in 1 day"
  assert.ok(due > T);
  assert.equal(dayOf(due, 4), dayOf(T, 4) + 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test-name-pattern '^day:' test.js`
Expected: FAIL — `Cannot find module './src/day.js'`.

- [ ] **Step 3: Write `src/day.js`**

```js
// Study-day math with a configurable rollover hour. Pure. Browser global + node.
// Day N begins at `rolloverHour` local (Anki's default 4am), so a late-night
// session counts toward the day it started.

const DAY_MS = 86400000, HOUR_MS = 3600000;

// Local study-day index for an epoch-ms instant.
function dayOf(ms, rolloverHour = 0) {
  const off = new Date(ms).getTimezoneOffset() * 60000;
  return Math.floor((ms - off - rolloverHour * HOUR_MS) / DAY_MS);
}

// Epoch-ms instant a study-day begins (inverse of dayOf, modulo DST seams).
function dayStart(day, rolloverHour = 0) {
  const guess = day * DAY_MS + rolloverHour * HOUR_MS;
  const off = new Date(guess).getTimezoneOffset() * 60000;
  return guess + off;
}

export { dayOf, dayStart, DAY_MS, HOUR_MS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test-name-pattern '^day:' test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/day.js test.js
git commit -m "feat: day.js — study-day index with a configurable rollover hour"
```

---

### Task 2: `config.js` + config-driven `fsrs.js` with review-due-by-day

**Files:**
- Create: `src/config.js`
- Modify: `src/fsrs.js` (imports, `nextInterval`, `transition`, `schedule`, `previewIntervals`, exports)
- Test: `test.js` (rewrite the four affected fsrs tests)

**Interfaces:**
- Consumes: `dayOf`, `dayStart` from `day.js` (Task 1).
- Produces: `DEFAULT_CONFIG = { newPerDay, reviewsPerDay, learnSteps, relearnSteps, desiredRetention, rolloverHour, learnAheadMins }`. `schedule(card, grade, now, config?, rng?)`, `previewIntervals(card, now, config?)`, `nextInterval(S, retention?)`. Review-state graduations get `due = dayStart(dayOf(now,h) + fuzz(days), h)`; learning/relearning dues stay `now + stepMs`. `LEARN_STEPS`/`RELEARN_STEPS` exports are removed.

- [ ] **Step 1: Create `src/config.js`**

```js
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
```

- [ ] **Step 2: Rewrite the affected fsrs tests (failing)**

In `test.js`, replace the four tests currently at the `LEARN_STEPS`/`RELEARN_STEPS`/`due - T >= DAY_MS` block (the tests named *"a new card graduates on Good; Again keeps it learning"*, *"Good graduates a lapsed-into-learning card to a day interval"*, *"Easy graduates a new card immediately"*, *"Again on a review card lapses into relearning"*) with:

```js
const MIN = 60000;

test('fsrs: a new card takes two Goods to graduate; Again resets to step 0', () => {
  const g1 = fsrs.schedule(fsrs.newCard(), 'good', T);
  assert.equal(g1.state, 'learning');
  assert.equal(g1.due - T, 10 * MIN);            // advanced to the 10m step, not graduated
  const g2 = fsrs.schedule(g1, 'good', T + 10 * MIN);
  assert.equal(g2.state, 'review');              // second Good graduates
  assert.ok(dayOf(g2.due, 4) > dayOf(T, 4));
  const again = fsrs.schedule(fsrs.newCard(), 'again', T);
  assert.equal(again.state, 'learning');
  assert.equal(again.due - T, 1 * MIN);          // back to the first step (1m)
});

test('fsrs: Good through both learning steps graduates to a later study-day', () => {
  const s0 = fsrs.schedule(fsrs.newCard(), 'again', T);     // learning, step 0
  const s1 = fsrs.schedule(s0, 'good', T + 1 * MIN);        // -> 10m step
  assert.equal(s1.state, 'learning');
  const grad = fsrs.schedule(s1, 'good', T + 11 * MIN);     // graduates
  assert.equal(grad.state, 'review');
  assert.ok(dayOf(grad.due, 4) > dayOf(T, 4));
});

test('fsrs: Easy graduates a new card immediately to a later study-day', () => {
  const easy = fsrs.schedule(fsrs.newCard(), 'easy', T);
  assert.equal(easy.state, 'review');
  assert.ok(dayOf(easy.due, 4) > dayOf(T, 4));
});

test('fsrs: Again on a review card lapses into relearning at the 10m step', () => {
  const card = { state: 'review', stability: 20, difficulty: 5,
    due: T, last_review: T - 20 * fsrs.DAY_MS, reps: 3, lapses: 0, step: 0 };
  const lapsed = fsrs.schedule(card, 'again', T);
  assert.equal(lapsed.state, 'relearning');
  assert.equal(lapsed.due - T, 10 * MIN);
});
```

Note: the `dayOf` import was added in Task 1. Leave the unchanged fsrs tests (`retrievability`, `nextInterval`, `fuzzRange`, `previewIntervals`, etc.) as-is.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test-name-pattern 'fsrs: a new card takes two Goods|fsrs: Good through both|fsrs: Easy graduates|fsrs: Again on a review' test.js`
Expected: FAIL — current single-step `fsrs.js` graduates on the first Good and dues reviews by wall-clock.

- [ ] **Step 4: Modify `src/fsrs.js`**

Add imports at the top (after the opening comment):

```js
import { dayOf, dayStart } from './day.js';
import { DEFAULT_CONFIG } from './config.js';
```

Delete the two module-level constants:

```js
const LEARN_STEPS = [1 * MIN_MS];
const RELEARN_STEPS = [10 * MIN_MS];
```

Change `nextInterval` to take desired retention:

```js
// Whole days until recall drops to `retention`; equals S at 0.9.
function nextInterval(S, retention = DESIRED_RETENTION) {
  const ivl = (S / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(ivl), 1, S_MAX);
}
```

Change `transition` to accept config and derive steps/retention from it:

```js
function transition(card, grade, now, cfg = DEFAULT_CONFIG) {
  const g = GRADES[grade];
  const from = card.state;
  const c = { ...card, last_review: now };

  if (from === 'new') {
    c.stability = initStability(g);
    c.difficulty = initDifficulty(g);
  } else {
    c.difficulty = nextDifficulty(card.difficulty, g);
    if (from === 'review') {
      const t = Math.max(0, (now - card.last_review) / DAY_MS);
      const R = retrievability(card.stability, t);
      c.stability = g === 1
        ? lapseStability(card.stability, card.difficulty, R)
        : successStability(card.stability, card.difficulty, R, g);
    } else {
      c.stability = sameDayStability(card.stability, g);
    }
  }

  let days = null;
  const graduate = () => {
    c.state = 'review'; c.step = 0; c.reps = card.reps + 1;
    days = nextInterval(c.stability, cfg.desiredRetention);
    c.due = now + days * DAY_MS;
  };

  if (g === 4 && from !== 'review') {
    graduate();
  } else if (from === 'new' || from === 'learning' || from === 'relearning') {
    const mins = from === 'relearning' ? cfg.relearnSteps : cfg.learnSteps;
    const steps = mins.map(m => m * MIN_MS);
    c.state = from === 'relearning' ? 'relearning' : 'learning';
    const i = from === 'new' ? 0 : card.step;
    if (g === 1) { c.step = 0; c.due = now + steps[0]; }
    else if (g === 2) {
      const delay = i + 1 < steps.length
        ? (steps[i] + steps[i + 1]) / 2 : steps[i] * 1.5;
      c.step = i; c.due = now + delay;
    } else {
      c.step = i + 1;
      if (c.step >= steps.length) graduate();
      else c.due = now + steps[c.step];
    }
  } else {
    if (g === 1) {
      c.state = 'relearning'; c.step = 0; c.lapses = card.lapses + 1;
      c.due = now + cfg.relearnSteps[0] * MIN_MS;
    } else {
      c.state = 'review'; c.reps = card.reps + 1;
      days = nextInterval(c.stability, cfg.desiredRetention);
      c.due = now + days * DAY_MS;
    }
  }
  return { card: c, days };
}
```

Change `schedule` to thread config and due reviews by study-day:

```js
// Apply a grade at `now`; review graduations are fuzzed and dued by study-day.
function schedule(card, grade, now, cfg = DEFAULT_CONFIG, rng = Math.random) {
  const { card: c, days } = transition(card, grade, now, cfg);
  if (days != null) {
    const day = dayOf(now, cfg.rolloverHour) + applyFuzz(days, rng);
    c.due = dayStart(day, cfg.rolloverHour);
  }
  return c;
}
```

Change `previewIntervals` to thread config (it uses `transition`'s provisional wall-clock due, so labels stay clean day-multiples):

```js
// Next-due deltas (ms) per grade, unfuzzed and strictly increasing.
function previewIntervals(card, now, cfg = DEFAULT_CONFIG) {
  const d = g => transition(card, g, now, cfg).card.due - now;
  return monotone({ again: d('again'), hard: d('hard'),
    good: d('good'), easy: d('easy') });
}
```

Update the export line — drop `LEARN_STEPS, RELEARN_STEPS`:

```js
export { newCard, schedule, previewIntervals,
  retrievability, nextInterval, fuzzRange, applyFuzz,
  initStability, initDifficulty, nextDifficulty,
  successStability, lapseStability, sameDayStability,
  DAY_MS, MIN_MS };
```

- [ ] **Step 5: Run the full suite to verify it passes**

Run: `node test.js`
Expected: PASS — all tests, including the rewritten fsrs block. (`nextInterval(10)` still returns 10 via the default retention.)

- [ ] **Step 6: Commit**

```bash
git add src/config.js src/fsrs.js test.js
git commit -m "feat: config-driven fsrs steps/retention; review dues by study-day"
```

---

### Task 3: `stats.js` — review-state counter + review log

**Files:**
- Modify: `src/stats.js` (`newStats`, `recordReview`, add `revDoneOn`, add `recordLog`, exports)
- Test: `test.js` (extend the stats block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `recordReview(stats, grade, today, wasReview=false)` — bumps `day.rev` when `wasReview`. `revDoneOn(stats, day) -> int` (review-state cards answered that day). `recordLog(stats, entry, cap=5000)` — append to `stats.log`, trimmed to the last `cap`. `newStats()` now includes `log: []`.

- [ ] **Step 1: Write the failing tests**

Add to the stats block in `test.js`:

```js
test('stats: only review-state grades count toward the review limit', () => {
  const s = newStats();
  recordReview(s, 'good', 7, true);   // a review card
  recordReview(s, 'good', 7, false);  // a new/learning card
  recordReview(s, 'again', 7, true);  // a review card that lapsed
  assert.equal(revDoneOn(s, 7), 2);
  assert.equal(reviewsOn(s, 7), 3);   // total studied that day is still 3
  assert.equal(revDoneOn(s, 99), 0);
});

test('stats: the review log appends and keeps only the most recent cap', () => {
  const s = newStats();
  recordLog(s, { id: 'a:hira', t: 1, grade: 'good', state: 'new' });
  recordLog(s, { id: 'a:hira', t: 2, grade: 'again', state: 'review' });
  assert.equal(s.log.length, 2);
  assert.equal(s.log[1].grade, 'again');
  for (let i = 0; i < 10; i++) recordLog(s, { id: 'x', t: i, grade: 'good', state: 'new' }, 5);
  assert.equal(s.log.length, 5);
  assert.equal(s.log[0].t, 5);        // oldest trimmed, newest kept
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test-name-pattern '^stats:' test.js`
Expected: FAIL — `revDoneOn`/`recordLog` are not exported.

- [ ] **Step 3: Modify `src/stats.js`**

Add `log: []` to `newStats`:

```js
function newStats() {
  return { reviews: 0, again: 0, days: {}, log: [] };
}
```

Replace `recordReview` to track review-state answers:

```js
// Fold one graded review into the log for `today`. `wasReview` marks a card that
// came from the review queue, so it counts against the daily review limit.
function recordReview(stats, grade, today, wasReview = false) {
  stats.reviews += 1;
  const day = stats.days[today] || { n: 0, again: 0 };
  day.n += 1;
  if (wasReview) day.rev = (day.rev || 0) + 1;
  if (grade === 'again') { stats.again += 1; day.again += 1; }
  stats.days[today] = day;
  return stats;
}
```

Add `revDoneOn` next to `newOn`:

```js
// Review-queue cards answered on a given day; drives the daily review limit.
function revDoneOn(stats, day) {
  return stats.days[day] && stats.days[day].rev ? stats.days[day].rev : 0;
}
```

Add `recordLog` (place after `recordNew`):

```js
// Append one review-log entry, keeping only the most recent `cap`.
function recordLog(stats, entry, cap = 5000) {
  stats.log.push(entry);
  if (stats.log.length > cap) stats.log.splice(0, stats.log.length - cap);
  return stats;
}
```

Update the export to add `revDoneOn, recordLog`:

```js
export { newStats, recordReview, recordNew, newOn, revDoneOn, reviewsOn,
  recordLog, currentStreak, bestStreak, retention };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test-name-pattern '^stats:' test.js`
Expected: PASS, and `node test.js` stays green (existing `recordReview(s, 'good', 4)` calls default `wasReview=false`).

- [ ] **Step 5: Commit**

```bash
git add src/stats.js test.js
git commit -m "feat: stats — review-state counter and a capped review log"
```

---

### Task 4: `queue.js` — the session queue

**Files:**
- Create: `src/queue.js`
- Test: `test.js` (append queue block)

**Interfaces:**
- Consumes: `dayOf` (Task 1), `newOn`/`revDoneOn` (Task 3), `DEFAULT_CONFIG` (Task 2).
- Produces:
  - `pickNext({cards, stats, config, now}) -> {kind:'card', id} | {kind:'done', learning, dueDay}` where `cards` is an array of `{id, state, due, ...}` (stored state plus id), `dueDay` is the earliest study-day with available work (or null).
  - `counts({cards, stats, config, now}) -> {newLeft, learning, due}` — limit-capped header tallies.

- [ ] **Step 1: Write the failing tests**

Append to `test.js`:

```js
import { pickNext, counts } from './src/queue.js';

const QDAY = 20000;
const QNOW = dayStart(QDAY, 4) + 12 * 3600000; // midday on study-day 20000
const cfg = { newPerDay: 2, reviewsPerDay: 2, learnSteps: [1, 10],
  relearnSteps: [10], desiredRetention: 0.9, rolloverHour: 4, learnAheadMins: 20 };
const newC = id => ({ id, state: 'new', due: 0, stability: 0, difficulty: 0, step: 0 });
const learnC = (id, due) => ({ id, state: 'learning', due, step: 0 });
const revC = (id, due) => ({ id, state: 'review', due, stability: 10, difficulty: 5 });

test('queue: a ready learning card preempts new and due reviews', () => {
  const cards = [newC('n1'), revC('r1', QNOW - 1000), learnC('l1', QNOW - 1000)];
  assert.deepEqual(pickNext({ cards, stats: newStats(), config: cfg, now: QNOW }),
    { kind: 'card', id: 'l1' });
});

test('queue: new and review interleave instead of all-new-then-reviews', () => {
  const cards = [newC('n1'), newC('n2'), revC('r1', QNOW - 2000), revC('r2', QNOW - 1000)];
  const stats = newStats();
  const order = [];
  for (let i = 0; i < 4; i++) {
    const p = pickNext({ cards, stats, config: cfg, now: QNOW });
    order.push(p.id);
    // simulate answering: drop the card, record its kind
    const c = cards.find(x => x.id === p.id);
    cards.splice(cards.indexOf(c), 1);
    if (c.state === 'new') recordNew(stats, QDAY);
    recordReview(stats, 'good', QDAY, c.state === 'review');
  }
  assert.ok(order.includes('n1') && order.includes('r1'));
  assert.notDeepEqual(order.slice(0, 2), ['n1', 'n2']); // not both new first
});

test('queue: new stops at newPerDay, reviews stop at reviewsPerDay', () => {
  const stats = newStats();
  recordNew(stats, QDAY); recordNew(stats, QDAY);           // 2 new done == cap
  recordReview(stats, 'good', QDAY, true);
  recordReview(stats, 'good', QDAY, true);                  // 2 reviews done == cap
  const cards = [newC('n1'), revC('r1', QNOW - 1000)];
  const p = pickNext({ cards, stats, config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');                             // both limits spent
});

test('queue: learning cards ignore the daily limits', () => {
  const stats = newStats();
  recordNew(stats, QDAY); recordNew(stats, QDAY);
  recordReview(stats, 'good', QDAY, true); recordReview(stats, 'good', QDAY, true);
  const cards = [learnC('l1', QNOW - 1000)];                // limits spent, learning still shows
  assert.deepEqual(pickNext({ cards, stats, config: cfg, now: QNOW }),
    { kind: 'card', id: 'l1' });
});

test('queue: learn-ahead shows a soon card now, else reports done', () => {
  const inside = [learnC('l1', QNOW + 10 * 60000)];         // 10m away, inside 20m window
  assert.deepEqual(pickNext({ cards: inside, stats: newStats(), config: cfg, now: QNOW }),
    { kind: 'card', id: 'l1' });
  const outside = [learnC('l2', QNOW + 40 * 60000)];        // 40m away, outside window
  const p = pickNext({ cards: outside, stats: newStats(), config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');
  assert.equal(p.learning, 1);
});

test('queue: done reports the next due day from blocked new and future reviews', () => {
  const stats = newStats();
  recordNew(stats, QDAY); recordNew(stats, QDAY);           // new cap spent -> new available tomorrow
  const cards = [newC('n1'), revC('r1', dayStart(QDAY + 3, 4))];
  const p = pickNext({ cards, stats, config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');
  assert.equal(p.dueDay, QDAY + 1);                         // soonest is the blocked new card
});

test('queue: counts are limit-capped and agree with the queue', () => {
  const stats = newStats();
  recordNew(stats, QDAY);                                   // 1 of 2 new used
  const cards = [newC('n1'), newC('n2'), newC('n3'),
    learnC('l1', QNOW + 5 * 60000), revC('r1', QNOW - 1000), revC('r2', QNOW - 1000),
    revC('r3', QNOW - 1000)];
  const c = counts({ cards, stats, config: cfg, now: QNOW });
  assert.equal(c.newLeft, 1);                               // cap 2 minus 1 used
  assert.equal(c.learning, 1);
  assert.equal(c.due, 2);                                   // 3 due reviews capped at 2
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test-name-pattern '^queue:' test.js`
Expected: FAIL — `Cannot find module './src/queue.js'`.

- [ ] **Step 3: Write `src/queue.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test-name-pattern '^queue:' test.js`
Expected: PASS (7 tests). Then `node test.js` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/queue.js test.js
git commit -m "feat: queue.js — Anki new/learning/review interleave with limits + learn-ahead"
```

---

### Task 5: `anki.js` glue — wire the queue, drop the countdown

**Files:**
- Modify: `src/anki.js` (imports, config, `dayOf`, `next`, `grade`, counts/streak, `showDone`; remove `pickDue`/`sessionCounts`/`nextDueDay`/`showCountdown`/timer)
- Modify: `src/anki.html` (remove the `#countdown` element)
- Test: existing `build:` tests (transitive bundle) + manual verification

**Interfaces:**
- Consumes: `pickNext`, `counts` (Task 4); `DEFAULT_CONFIG` (Task 2); `dayOf` (Task 1); `revDoneOn`, `recordLog` (Task 3); `schedule`, `previewIntervals`, `DAY_MS` (fsrs).
- Produces: none (DOM glue, page leaf).

- [ ] **Step 1: Update imports and constants in `src/anki.js`**

Replace the top import block and the `NEW_PER_DAY`/`dayOf` definitions.

Old (lines ~1-22):

```js
import { KANA } from './kana.js';
import { newCard, schedule, previewIntervals, DAY_MS } from './fsrs.js';
import { newStats, recordReview, recordNew, newOn, reviewsOn,
  currentStreak, bestStreak, retention } from './stats.js';
import './pwa.js';
...
const STORE_KEY = 'anki-fsrs-v1';
const STATS_KEY = 'anki-stats-v2';
const PREF_KEY = 'anki-deck-v1';
const NEW_PER_DAY = 40;
const MATURE_DAYS = 21;
...
const now = () => Date.now();
// local-day index: shift by the zone offset so the day rolls at local midnight
const dayOf = ms => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / DAY_MS);
```

New:

```js
import { KANA } from './kana.js';
import { newCard, schedule, previewIntervals, DAY_MS } from './fsrs.js';
import { newStats, recordReview, recordNew, reviewsOn, revDoneOn, recordLog,
  currentStreak, bestStreak, retention } from './stats.js';
import { pickNext, counts as queueCounts } from './queue.js';
import { dayOf } from './day.js';
import { DEFAULT_CONFIG } from './config.js';
import './pwa.js';
...
const STORE_KEY = 'anki-fsrs-v1';
const STATS_KEY = 'anki-stats-v2';
const PREF_KEY = 'anki-deck-v1';
const CONFIG = DEFAULT_CONFIG;
const MATURE_DAYS = 21;
...
const now = () => Date.now();
const today = () => dayOf(now(), CONFIG.rolloverHour);
```

(Keep `byId`, `loadStore`/`saveStore`/`store`, `loadStats`/`saveStats`/`stats`, `cardId`, `stateFor`, `parseCard` unchanged.)

- [ ] **Step 2: Replace the queue glue — `next`, remove `pickDue`/`showCountdown`/timer**

Remove `let timer = null;`, `clearTimer`, `pickDue`, `showCountdown`. Keep `active`, `current`, `flipped`, `reviewed`, `shuffle`, `buildSession`.

Replace `buildSession`/`next` with:

```js
function buildSession() {
  active = shuffle(deckCards());
  reviewed = 0;
  next();
}

// All deck cards as {id, ...state} for the pure queue.
function sessionCards() {
  return active.map(id => ({ id, ...stateFor(id) }));
}

function next() {
  flipped = false;
  const pick = pickNext({ cards: sessionCards(), stats, config: CONFIG, now: now() });
  if (pick.kind === 'card') { current = pick.id; return render(); }
  current = null;
  showDone(pick);
}
```

In `render`, drop the `countdownEl.hidden = true;` line (the element is gone); keep the rest. Remove the `countdownEl` lookup from the `$` block at the top (`const stage = $('stage'), countdownEl = $('countdown');` → `const stage = $('stage');`).

- [ ] **Step 3: Update `grade`, counts, streak, and `showDone`**

`grade` — thread config, record the review-state flag, append the log:

```js
function grade(g) {
  if (!flipped || !current) return;
  const before = stateFor(current);
  store[current] = schedule(before, g, now(), CONFIG);
  const day = today();
  if (before.state === 'new') recordNew(stats, day);
  recordReview(stats, g, day, before.state === 'review');
  recordLog(stats, { id: current, t: now(), grade: g, state: before.state });
  saveStore(); saveStats();
  reviewed++;
  updateStreak();
  next();
}
```

Replace `sessionCounts` usage in `updateStats` with the pure `queueCounts`:

```js
function updateStats() {
  const c = queueCounts({ cards: sessionCards(), stats, config: CONFIG, now: now() });
  statsEl.innerHTML = `<span class="ct-new">${c.newLeft} new</span> · ` +
    `<span class="ct-learn">${c.learning} learning</span> · ` +
    `<span class="ct-due">${c.due} due</span>`;
}
```

Delete the old `sessionCounts` function.

`updateStreak` — use `today()`:

```js
function updateStreak() {
  const t = today();
  const cur = currentStreak(stats, t), done = reviewsOn(stats, t);
  streakEl.textContent = cur > 0
    ? `🔥 ${cur}-day streak${done ? ` · ${done} today` : ''}`
    : 'study today to start a streak';
}
```

`statsPanel` — replace `dayOf(now())` with `today()`; leave `deckBreakdown`/`retention` as-is.

Delete the standalone `nextDueDay` function. Replace `showDone` to consume the queue's done descriptor (learning count + dueDay):

```js
function showDone(done = { learning: 0, dueDay: null }) {
  stage.hidden = true; doneEl.hidden = false;
  if (deckCards().length === 0) {
    doneEl.innerHTML = '<p class="done-note">tick 平仮名 or 片仮名 above.</p>';
    return;
  }
  const t = today();
  const days = done.dueDay == null || done.dueDay <= t ? 0 : done.dueDay - t;
  const when = days > 0 ? ` Next due in ${days} day${days > 1 ? 's' : ''}.`
    : done.learning > 0
      ? ` ${done.learning} still in learning — come back soon.` : '';
  const head = reviewed > 0 ? '完了' : 'all caught up';
  const body = reviewed > 0
    ? `${reviewed} card${reviewed === 1 ? '' : 's'} reviewed.${when}`
    : `nothing due right now.${when}`;
  doneEl.innerHTML = `<div class="done-mark">${head}</div>` +
    `<p class="done-note">${body}</p>` + statsPanel() +
    '<button id="restart" class="grade good">study again</button>';
  $('restart').addEventListener('click', startSession);
}
```

In `startSession`, drop `clearTimer();` (no timer remains):

```js
function startSession() {
  stage.hidden = false; doneEl.hidden = true;
  buildSession();
}
```

In the `resume` path, the visibility/`pageshow` handlers stay as-is — they call `next()`, which now re-picks (a learning card that ripened shows immediately). Remove any remaining `clearTimer()` references.

- [ ] **Step 4: Remove the `#countdown` element from `src/anki.html`**

Delete this line (around line 42):

```html
      <div class="prompt-hint" id="countdown" hidden></div>
```

- [ ] **Step 5: Run the full suite**

Run: `node test.js`
Expected: PASS — all unit tests plus the `build:` tests ("page entries bundle cleanly as ESM", "pages reference only files present in dist", etc.), which transitively bundle `anki.js → queue.js/day.js/config.js` through esbuild and would fail on any bad import or syntax error.

- [ ] **Step 6: Manual verification (real app)**

Run: `npm run build` then serve `dist/` (or open `src/anki.html` via the dev flow in `README.md`). In the browser, with a fresh profile (or after "reset progress"):
- Confirm a new card answered **Good** reappears ~10 min later (second step) rather than graduating immediately — or, since you're out of other cards, reappears right away via learn-ahead.
- Confirm the header reads `N new · N learning · N due` and that **new** stops at 20 for the day.
- Confirm finishing shows the done screen with no ticking countdown, and the "next due in N days" / "still in learning" line.

Expected: behaviors match. Capture anything off as a follow-up; do not edit during verification.

- [ ] **Step 7: Commit**

```bash
git add src/anki.js src/anki.html
git commit -m "feat: anki.js — drive the real-Anki queue; drop the per-second countdown"
```

---

## Self-Review

**Spec coverage:**
- Two daily limits → Task 4 (`pickNext` gates `newPerDay`/`reviewsPerDay`), Task 3 (`revDoneOn`). ✓
- `1m 10m` learning steps → Task 2 (config-driven `transition`), tests rewritten. ✓
- Learn-ahead replaces countdown → Task 4 (`learnAheadMins` branch), Task 5 (removes `showCountdown`/timer/`#countdown`). ✓
- 4am rollover → Task 1 (`dayOf`/`dayStart`), threaded everywhere via `CONFIG.rolloverHour`. ✓
- Review-due-by-day → Task 2 (`schedule` uses `dayStart`). ✓
- Pure `queue.js`/`day.js`, thin glue → Tasks 1/4/5. ✓
- Config object with Anki defaults → Task 2 (`config.js`). ✓
- Review log → Task 3 (`recordLog`), Task 5 (wired in `grade`). ✓
- Non-destructive migration → no key changes, no wipe; existing `recordReview` calls default `wasReview=false`; `loadStats` merges over `newStats()` so `log`/`rev` default in. ✓

**Deviation from spec (intentional, YAGNI):** the review-log entry is `{id, t, grade, state}` — the spec listed `lastIvl`/`ivl` too. Those serve interval-history graphs not in scope for Phases 1–3; "study forgotten" (Phase 3) only needs `state`/`grade`. The schema is append-only, so Phase 3 can add fields without migration. Flag to the user.

**Placeholder scan:** none — every step has full code or an exact command.

**Type consistency:** `pickNext`/`counts` take `{cards, stats, config, now}` consistently (Task 4 def, Task 5 calls). `recordReview(stats, grade, today, wasReview)` consistent (Task 3 def, Task 5 call). `dayOf(ms, rolloverHour)` consistent across Tasks 1/2/4/5. `schedule(card, grade, now, cfg, rng)` consistent (Task 2 def, Task 5 call). `cards` element shape `{id, ...state}` matches `partition`'s reads (`state`, `due`). ✓
