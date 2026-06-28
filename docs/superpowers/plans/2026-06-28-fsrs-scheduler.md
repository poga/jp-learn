# FSRS Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SM-2 scheduler with FSRS-6 (4 grades, sub-day learning steps, interval fuzz, desired-retention), so the 五十音 practice page schedules like current Anki.

**Architecture:** A new pure `fsrs.js` (browser-global + `module.exports`, like `kana.js`) holds the FSRS-6 memory model and the new/learning/review/relearning state machine, scheduling on millisecond timestamps. `anki.js` is rewritten as the impure shell: localStorage, a wall-clock session queue with a learning-step countdown, and the four-grade UI. `stats.js` is untouched. `srs.js` is deleted.

**Tech Stack:** Plain browser JavaScript, no build step, runs via `file://`. Tests via `node --test` (node:test + assert).

## Global Constraints

- Work on branch `fsrs-scheduler` (already created off `main`). Never commit to `main`.
- No build step, no bundler, no dependencies. `fsrs.js` must stay pure: no DOM, no `localStorage`. Same dual export pattern as `srs.js`/`kana.js`.
- Comments: at most one line, ≤ 80 chars, minimal — explain why/what, not how.
- Tests: no mocks. Assert behavioral invariants and relationships, never the tunable weight values or `DESIRED_RETENTION`. A seeded `rng` passed to fuzz controls randomness, not behavior — allowed.
- FSRS-6 default weights, verbatim: `[0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]`. `DESIRED_RETENTION = 0.9`.
- Card state shape: `{ state, stability, difficulty, due, last_review, reps, lapses, step }`; `state ∈ new|learning|review|relearning`; `due`/`last_review` are epoch ms.
- Grades are the strings `again|hard|good|easy`, numeric `1|2|3|4`.
- Every commit message ends with these two trailer lines:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WmmoakJHV5SxXioT591kuA
  ```

## File Structure

- `fsrs.js` — **new**. Pure FSRS-6 scheduler. Built across Tasks 1–5.
- `test.js` — **modified**. FSRS tests added (Tasks 1–5); SM-2 tests removed (Task 6).
- `srs.js` — **deleted** (Task 6).
- `anki.html` — **modified** (Task 7): add Hard button + `#countdown`; swap script tag.
- `style.css` — **modified** (Task 7): Hard color, 4-button row, countdown.
- `anki.js` — **rewritten** (Task 7): timestamps, queue+countdown, full reset.

---

### Task 1: `fsrs.js` core — constants, retrievability, interval

**Files:**
- Create: `fsrs.js`
- Test: `test.js` (append FSRS section; add `fsrs` require)

**Interfaces:**
- Consumes: nothing.
- Produces: `newCard()`; `retrievability(S, t)` → recall prob; `nextInterval(S)` → integer days; constants `DAY_MS`, `MIN_MS`, `LEARN_STEPS`, `RELEARN_STEPS`.

- [ ] **Step 1: Write the failing tests** — add to the top of `test.js` after the existing requires:

```js
const fsrs = require('./fsrs.js');
```

and append at the end of `test.js`:

```js
test('fsrs: retrievability is 0.9 at t = S and decays', () => {
  for (const S of [1, 10, 100]) {
    assert.ok(Math.abs(fsrs.retrievability(S, S) - 0.9) < 1e-6);
  }
  assert.ok(fsrs.retrievability(10, 1) > fsrs.retrievability(10, 30));
});

test('fsrs: nextInterval equals stability at 0.9 retention', () => {
  assert.equal(fsrs.nextInterval(10), 10);
  assert.equal(fsrs.nextInterval(1), 1);
  assert.ok(fsrs.nextInterval(0.0001) >= 1); // clamped to >= 1 day
});

test('fsrs: a new card starts unseen', () => {
  const c = fsrs.newCard();
  assert.equal(c.state, 'new');
  assert.equal(c.reps, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `Cannot find module './fsrs.js'`.

- [ ] **Step 3: Create `fsrs.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS (existing SM-2/kana/stats tests plus the 3 new fsrs tests).

- [ ] **Step 5: Commit**

```bash
git add fsrs.js test.js
git commit -m "feat: fsrs.js core — retrievability and interval" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WmmoakJHV5SxXioT591kuA"
```

---

### Task 2: Initial stability/difficulty + difficulty update

**Files:**
- Modify: `fsrs.js`
- Test: `test.js`

**Interfaces:**
- Consumes: `W`, `clamp`, `D_MIN`, `D_MAX`, `S_MIN`, `S_MAX` from Task 1.
- Produces: `initStability(g)`, `initDifficulty(g)`, `nextDifficulty(D, g)` (g numeric 1–4).

- [ ] **Step 1: Write the failing tests** — append to `test.js`:

```js
test('fsrs: initial stability rises with a better first grade', () => {
  const s = [1, 2, 3, 4].map(g => fsrs.initStability(g));
  assert.ok(s[0] < s[1] && s[1] < s[2] && s[2] < s[3]);
});

test('fsrs: initial difficulty is highest for Again, all within [1,10]', () => {
  const d = [1, 2, 3, 4].map(g => fsrs.initDifficulty(g));
  assert.ok(d[0] > d[3]);
  for (const x of d) assert.ok(x >= 1 && x <= 10);
});

test('fsrs: Again raises difficulty, Easy lowers it, stays in [1,10]', () => {
  assert.ok(fsrs.nextDifficulty(5, 1) > 5);
  assert.ok(fsrs.nextDifficulty(5, 4) < 5);
  assert.ok(fsrs.nextDifficulty(9.9, 1) <= 10);
  assert.ok(fsrs.nextDifficulty(1.1, 4) >= 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `fsrs.initStability is not a function`.

- [ ] **Step 3: Implement** — add these functions immediately above the `if (typeof module` block in `fsrs.js`:

```js
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
```

and replace the `module.exports` object with:

```js
  module.exports = { newCard, retrievability, nextInterval,
    initStability, initDifficulty, nextDifficulty,
    DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fsrs.js test.js
git commit -m "feat: fsrs.js initial S/D and difficulty update" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WmmoakJHV5SxXioT591kuA"
```

---

### Task 3: Stability updates — success, lapse, same-day

**Files:**
- Modify: `fsrs.js`
- Test: `test.js`

**Interfaces:**
- Consumes: `W`, `clamp`, `S_MIN`, `S_MAX` from Task 1.
- Produces: `successStability(S, D, R, g)`, `lapseStability(S, D, R)`, `sameDayStability(S, g)`.

- [ ] **Step 1: Write the failing tests** — append to `test.js`:

```js
test('fsrs: success grows stability, more for Easy than Good than Hard', () => {
  const hard = fsrs.successStability(10, 5, 0.9, 2);
  const good = fsrs.successStability(10, 5, 0.9, 3);
  const easy = fsrs.successStability(10, 5, 0.9, 4);
  assert.ok(hard > 10 && hard < good && good < easy);
});

test('fsrs: a lapse never increases stability', () => {
  assert.ok(fsrs.lapseStability(10, 5, 0.9) < 10);
  assert.ok(fsrs.lapseStability(2, 8, 0.5) <= 2);
});

test('fsrs: a same-day success does not shrink stability', () => {
  assert.ok(fsrs.sameDayStability(2, 3) >= 2);
  assert.ok(fsrs.sameDayStability(2, 4) >= 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `fsrs.successStability is not a function`.

- [ ] **Step 3: Implement** — add above the `if (typeof module` block:

```js
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
```

and replace the `module.exports` object with:

```js
  module.exports = { newCard, retrievability, nextInterval,
    initStability, initDifficulty, nextDifficulty,
    successStability, lapseStability, sameDayStability,
    DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fsrs.js test.js
git commit -m "feat: fsrs.js stability updates (success/lapse/same-day)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WmmoakJHV5SxXioT591kuA"
```

---

### Task 4: Interval fuzz

**Files:**
- Modify: `fsrs.js`
- Test: `test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `fuzzRange(interval)` → `{min, max}` (pure); `applyFuzz(interval, rng)` → integer days in band.

- [ ] **Step 1: Write the failing tests** — append to `test.js`:

```js
test('fsrs: no fuzz below 2.5 days; band widens with interval', () => {
  const small = fsrs.fuzzRange(2);
  assert.equal(small.min, 2);
  assert.equal(small.max, 2);
  const w10 = fsrs.fuzzRange(10), w100 = fsrs.fuzzRange(100);
  assert.ok(w10.min < 10 && w10.max > 10);
  assert.ok((w100.max - w100.min) > (w10.max - w10.min));
});

test('fsrs: applyFuzz stays inside the band', () => {
  const { min, max } = fsrs.fuzzRange(100);
  assert.equal(fsrs.applyFuzz(100, () => 0), min);
  assert.equal(fsrs.applyFuzz(100, () => 0.999999), max);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `fsrs.fuzzRange is not a function`.

- [ ] **Step 3: Implement** — add above the `if (typeof module` block:

```js
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
```

and replace the `module.exports` object with:

```js
  module.exports = { newCard, retrievability, nextInterval,
    initStability, initDifficulty, nextDifficulty,
    successStability, lapseStability, sameDayStability,
    fuzzRange, applyFuzz,
    DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fsrs.js test.js
git commit -m "feat: fsrs.js interval fuzz" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WmmoakJHV5SxXioT591kuA"
```

---

### Task 5: State machine — `schedule` + `previewIntervals`

**Files:**
- Modify: `fsrs.js`
- Test: `test.js`

**Interfaces:**
- Consumes: every function from Tasks 1–4, plus `GRADES`, `DAY_MS`, `LEARN_STEPS`, `RELEARN_STEPS`.
- Produces: `schedule(card, grade, now, rng = Math.random)` → next card state; `previewIntervals(card, now)` → `{again, hard, good, easy}` ms deltas, strictly increasing.

- [ ] **Step 1: Write the failing tests** — append to `test.js`:

```js
const T = 1_700_000_000_000; // a fixed timestamp for deterministic tests

test('fsrs: a new card enters learning; Good advances, Again resets', () => {
  const good = fsrs.schedule(fsrs.newCard(), 'good', T);
  assert.equal(good.state, 'learning');
  assert.equal(good.due - T, fsrs.LEARN_STEPS[1]); // second step (10m)
  const again = fsrs.schedule(fsrs.newCard(), 'again', T);
  assert.equal(again.due - T, fsrs.LEARN_STEPS[0]); // first step (1m)
});

test('fsrs: Good past the last learning step graduates to a day interval', () => {
  const learning = fsrs.schedule(fsrs.newCard(), 'good', T); // at step 1
  const grad = fsrs.schedule(learning, 'good', T + fsrs.LEARN_STEPS[1]);
  assert.equal(grad.state, 'review');
  assert.ok(grad.due - (T + fsrs.LEARN_STEPS[1]) >= fsrs.DAY_MS);
});

test('fsrs: Easy graduates a new card immediately', () => {
  const easy = fsrs.schedule(fsrs.newCard(), 'easy', T);
  assert.equal(easy.state, 'review');
  assert.ok(easy.due - T >= fsrs.DAY_MS);
});

test('fsrs: Again on a review card lapses into relearning', () => {
  const card = { state: 'review', stability: 20, difficulty: 5,
    due: T, last_review: T - 20 * fsrs.DAY_MS, reps: 3, lapses: 0, step: 0 };
  const lapsed = fsrs.schedule(card, 'again', T);
  assert.equal(lapsed.state, 'relearning');
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due - T, fsrs.RELEARN_STEPS[0]);
});

test('fsrs: preview intervals are strictly increasing (no Good/Easy tie)', () => {
  const card = { state: 'review', stability: 1, difficulty: 5,
    due: T, last_review: T - fsrs.DAY_MS, reps: 2, lapses: 0, step: 0 };
  const p = fsrs.previewIntervals(card, T);
  assert.ok(p.again < p.hard && p.hard < p.good && p.good < p.easy);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `fsrs.schedule is not a function`.

- [ ] **Step 3: Implement** — add above the `if (typeof module` block:

```js
// Next state with the review interval left UNFUZZED. Returns the card and the
// graduated day-interval (or null) so schedule() can fuzz it.
function transition(card, grade, now) {
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
    days = nextInterval(c.stability);
    c.due = now + days * DAY_MS;
  };

  if (g === 4 && from !== 'review') {
    graduate();
  } else if (from === 'new' || from === 'learning' || from === 'relearning') {
    const steps = from === 'relearning' ? RELEARN_STEPS : LEARN_STEPS;
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
      c.due = now + RELEARN_STEPS[0];
    } else {
      c.state = 'review'; c.reps = card.reps + 1;
      days = nextInterval(c.stability);
      c.due = now + days * DAY_MS;
    }
  }
  return { card: c, days };
}

// Apply a grade at timestamp now; review graduations are fuzzed via rng.
function schedule(card, grade, now, rng = Math.random) {
  const { card: c, days } = transition(card, grade, now);
  if (days != null) c.due = now + applyFuzz(days, rng) * DAY_MS;
  return c;
}

// Force the four projected intervals strictly increasing, like Anki.
function monotone(iv) {
  const order = ['again', 'hard', 'good', 'easy'];
  for (let i = 1; i < order.length; i++) {
    const prev = iv[order[i - 1]];
    if (iv[order[i]] <= prev) iv[order[i]] = prev + (prev >= DAY_MS ? DAY_MS : MIN_MS);
  }
  return iv;
}

// Next-due deltas (ms) for each grade, unfuzzed and strictly increasing.
function previewIntervals(card, now) {
  const d = g => transition(card, g, now).card.due - now;
  return monotone({ again: d('again'), hard: d('hard'),
    good: d('good'), easy: d('easy') });
}
```

and replace the `module.exports` object with:

```js
  module.exports = { newCard, schedule, previewIntervals,
    retrievability, nextInterval, fuzzRange, applyFuzz,
    initStability, initDifficulty, nextDifficulty,
    successStability, lapseStability, sameDayStability,
    DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all fsrs state-machine tests green.

- [ ] **Step 5: Commit**

```bash
git add fsrs.js test.js
git commit -m "feat: fsrs.js scheduler state machine and previews" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WmmoakJHV5SxXioT591kuA"
```

---

### Task 6: Remove the SM-2 scheduler

**Files:**
- Delete: `srs.js`
- Modify: `test.js` (drop the `srs.js` require and SM-2 test cases)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (cleanup).

- [ ] **Step 1: Remove the SM-2 require from `test.js`**

Delete this line near the top of `test.js`:

```js
const { newCard, schedule, isDue, MIN_EASE } = require('./srs.js');
```

- [ ] **Step 2: Remove the SM-2 test cases from `test.js`**

Delete these six tests in full (the ones that call the SM-2 `schedule`/`isDue`/`newCard`/`MIN_EASE`):
- `'first success graduates to 1 day (good) or 4 days (easy)'`
- `'review good multiplies interval by ease'`
- `'easy raises ease and jumps further than good'`
- `'again resets reps and lowers review ease, never below the floor'`
- `'again on a never-learned card keeps it due without penalizing ease'`
- `'new cards are always due; reviews due only on or after their date'`

(Keep all `matchRomaji`, `KANA`/`LAYOUT`, `stats`, and `fsrs:` tests.)

- [ ] **Step 3: Delete `srs.js`**

```bash
git rm srs.js
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — no `Cannot find module './srs.js'`, no SM-2 tests, fsrs/kana/stats tests green.

- [ ] **Step 5: Commit**

```bash
git add test.js
git commit -m "refactor: remove SM-2 scheduler in favor of fsrs.js" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WmmoakJHV5SxXioT591kuA"
```

---

### Task 7: Glue cutover — `anki.html`, `style.css`, `anki.js`

**Files:**
- Modify: `anki.html` (Hard button, `#countdown`, script tag)
- Modify: `style.css` (Hard color, countdown)
- Modify: `anki.js` (full rewrite)

**Interfaces:**
- Consumes: `fsrs.js` globals (`newCard`, `schedule`, `previewIntervals`, `DAY_MS`); `stats.js` globals (`newStats`, `recordReview`, `reviewsOn`, `currentStreak`, `bestStreak`, `retention`); `kana.js` global (`KANA`).
- Produces: the working page (no automated tests — verified by `node --check` + manual smoke).

- [ ] **Step 1: Update `anki.html`** — replace the `<div class="grade-buttons" ...>` block (lines 34–44) with the four-grade row plus a countdown element, and change the script tag.

Replace the grades block with:

```html
      <div class="prompt-hint" id="countdown" hidden></div>

      <div class="grade-buttons" id="grades" hidden>
        <button class="grade again" data-grade="again">
          <span>Again</span><small id="iv-again"></small>
        </button>
        <button class="grade hard" data-grade="hard">
          <span>Hard</span><small id="iv-hard"></small>
        </button>
        <button class="grade good" data-grade="good">
          <span>Good</span><small id="iv-good"></small>
        </button>
        <button class="grade easy" data-grade="easy">
          <span>Easy</span><small id="iv-easy"></small>
        </button>
      </div>
```

Change `<script src="srs.js"></script>` to:

```html
  <script src="fsrs.js"></script>
```

- [ ] **Step 2: Update `style.css`** — add the Hard color variable and rule, and tighten the 4-button row.

In the `:root` block (lines 111–115) add `--hard`:

```css
:root {
  --again: #e06a5a;
  --hard: #d99a3c;
  --good: #4a9d6e;
  --easy: #5a86e0;
}
```

After `.grade.again { background: var(--again); }` (line 214) add:

```css
.grade.hard { background: var(--hard); }
```

Replace `.grade-buttons { display: flex; gap: .6rem; margin-top: 1.25rem; }` with a tighter gap so four fit at 480px:

```css
.grade-buttons { display: flex; gap: .4rem; margin-top: 1.25rem; }
```

- [ ] **Step 3: Rewrite `anki.js`** — replace the entire file with:

```js
// Page glue around the pure fsrs.js scheduler: localStorage, the wall-clock
// session queue with a learning countdown, and the flip/grade UI. Browser-only.

const STORE_KEY = 'anki-fsrs-v1';
const STATS_KEY = 'anki-stats-v2';
const PREF_KEY = 'anki-deck-v1';
const NEW_PER_SESSION = 20;
const MATURE_DAYS = 21;
const DAY_MS = 86400000;

// drop legacy SM-2 progress and stats (full reset on upgrade)
try { localStorage.removeItem('anki-srs-v1'); localStorage.removeItem('anki-stats-v1'); }
catch (e) {}

const now = () => Date.now();
const dayOf = ms => Math.floor(ms / DAY_MS);
const byId = Object.fromEntries(KANA.map(e => [e.id, e]));

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)).cards || {}; }
  catch (e) { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, cards: store })); }
  catch (e) {}
}
const store = loadStore();

function loadStats() {
  try { return Object.assign(newStats(), JSON.parse(localStorage.getItem(STATS_KEY))); }
  catch (e) { return newStats(); }
}
function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
}
const stats = loadStats();

const cardId = (entryId, script) => `${entryId}:${script}`;
const stateFor = id => store[id] || newCard();
function parseCard(id) {
  const [entryId, script] = id.split(':');
  const e = byId[entryId];
  return { e, script, glyph: script === 'hira' ? e.hira : e.kata };
}

const $ = id => document.getElementById(id);
const deckBar = $('deck-bar'), statsEl = $('stats'), streakEl = $('streak');
const stage = $('stage'), countdownEl = $('countdown');
const doneEl = $('done'), cardEl = $('card'), hintEl = $('hint');
const gradesEl = $('grades'), scriptEl = $('card-script');
const frontEl = $('card-front'), readingEl = $('card-reading');
const iv = { again: $('iv-again'), hard: $('iv-hard'),
  good: $('iv-good'), easy: $('iv-easy') };

function selectedScripts() {
  return [...deckBar.querySelectorAll('input[name="script"]:checked')]
    .map(c => c.value);
}
function deckCards() {
  const ids = [];
  for (const e of KANA)
    for (const s of selectedScripts()) ids.push(cardId(e.id, s));
  return ids;
}

function savePref() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(selectedScripts())); }
  catch (e) {}
}
function applyPref() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) {}
  if (!Array.isArray(saved)) return;
  for (const c of deckBar.querySelectorAll('input[name="script"]'))
    c.checked = saved.includes(c.value);
}

let active = [], newSeen = 0, current = null, flipped = false, reviewed = 0;
let timer = null;

function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }

function buildSession() {
  active = deckCards();
  newSeen = 0; reviewed = 0;
  next();
}

// next card to show, or a wait (ms) until the soonest learning card ripens.
function pickDue(t) {
  let due = null, dueAt = Infinity, fresh = null;
  for (const id of active) {
    const st = stateFor(id);
    if (st.state === 'new') {
      if (fresh == null && newSeen < NEW_PER_SESSION) fresh = id;
    } else if (st.due <= t && st.due < dueAt) { due = id; dueAt = st.due; }
  }
  if (due) return { id: due };
  if (fresh) return { id: fresh };
  let soon = Infinity;
  for (const id of active) {
    const st = stateFor(id);
    if ((st.state === 'learning' || st.state === 'relearning') && st.due > t)
      soon = Math.min(soon, st.due);
  }
  return soon < Infinity ? { wait: soon - t } : null;
}

function next() {
  flipped = false;
  clearTimer();
  const pick = pickDue(now());
  if (!pick) { current = null; return showDone(); }
  if (pick.id) { current = pick.id; return render(); }
  current = null;
  showCountdown(pick.wait);
}

function fmtIv(ms) {
  if (ms < DAY_MS) {
    const m = Math.round(ms / 60000);
    return m < 60 ? m + 'm' : Math.round(m / 60) + 'h';
  }
  const d = Math.round(ms / DAY_MS);
  if (d < 30) return d + 'd';
  if (d < 365) return Math.round(d / 30) + 'mo';
  return Math.round(d / 365) + 'y';
}

function render() {
  countdownEl.hidden = true;
  cardEl.hidden = false;
  const { e, script, glyph } = parseCard(current);
  scriptEl.textContent = script === 'hira' ? 'ひらがな' : 'カタカナ';
  frontEl.textContent = glyph;
  readingEl.textContent = e.romaji;
  cardEl.classList.remove('flipped');
  gradesEl.hidden = true;
  hintEl.hidden = false;
  updateStats();
}

function showCountdown(ms) {
  stage.hidden = false; doneEl.hidden = true;
  cardEl.hidden = true; gradesEl.hidden = true; hintEl.hidden = true;
  countdownEl.hidden = false;
  let remain = Math.ceil(ms / 1000);
  const tick = () => {
    if (remain <= 0) { clearTimer(); return next(); }
    const m = Math.floor(remain / 60), s = String(remain % 60).padStart(2, '0');
    countdownEl.textContent = `next card in ${m}:${s}`;
    remain--;
  };
  tick();
  timer = setInterval(tick, 1000);
}

function flip() {
  if (flipped || !current) return;
  flipped = true;
  cardEl.classList.add('flipped');
  hintEl.hidden = true;
  const p = previewIntervals(stateFor(current), now());
  for (const g of ['again', 'hard', 'good', 'easy']) iv[g].textContent = fmtIv(p[g]);
  gradesEl.hidden = false;
}

function grade(g) {
  if (!flipped || !current) return;
  const before = stateFor(current);
  store[current] = schedule(before, g, now());
  if (before.state === 'new') newSeen++;
  recordReview(stats, g, dayOf(now()));
  saveStore(); saveStats();
  reviewed++;
  updateStreak();
  next();
}

function sessionLeft() {
  const t = now();
  let dueCount = 0, fresh = 0;
  for (const id of active) {
    const st = stateFor(id);
    if (st.state === 'new') fresh++;
    else if (st.state === 'learning' || st.state === 'relearning') dueCount++;
    else if (st.due <= t) dueCount++;
  }
  return dueCount + Math.min(fresh, Math.max(0, NEW_PER_SESSION - newSeen));
}

function updateStats() {
  statsEl.textContent = `${reviewed} reviewed · ${sessionLeft()} left`;
}

function updateStreak() {
  const today = dayOf(now());
  const cur = currentStreak(stats, today), done = reviewsOn(stats, today);
  streakEl.textContent = cur > 0
    ? `🔥 ${cur}-day streak${done ? ` · ${done} today` : ''}`
    : 'study today to start a streak';
}

// Split the selected deck into new / learning / mature, à la Anki's counts.
function deckBreakdown() {
  let fresh = 0, learning = 0, mature = 0;
  const ids = deckCards();
  for (const id of ids) {
    const st = stateFor(id);
    if (st.state === 'new') fresh++;
    else if (st.state === 'review' && st.stability >= MATURE_DAYS) mature++;
    else learning++;
  }
  return { fresh, learning, mature, total: ids.length };
}

function statsPanel() {
  const today = dayOf(now());
  const ret = retention(stats);
  const retTxt = ret == null ? '—' : Math.round(ret * 100) + '%';
  const bd = deckBreakdown();
  const learned = bd.learning + bd.mature;
  const pct = bd.total ? Math.round(learned / bd.total * 100) : 0;
  return `<div class="stat-grid">
      <div class="stat"><b>🔥 ${currentStreak(stats, today)}</b><span>day streak</span></div>
      <div class="stat"><b>${bestStreak(stats)}</b><span>best</span></div>
      <div class="stat"><b>${reviewsOn(stats, today)}</b><span>today</span></div>
      <div class="stat"><b>${retTxt}</b><span>retention</span></div>
    </div>
    <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    <p class="progress-label">${learned} / ${bd.total} learned ·
      ${bd.fresh} new · ${bd.learning} learning · ${bd.mature} mature</p>`;
}

// Earliest day the deck has anything to study, or null if fully buried.
function nextDueDay() {
  const t = now();
  let min = null;
  for (const id of deckCards()) {
    const st = stateFor(id);
    if (st.state === 'new') return dayOf(t);
    if (st.due > t && (min == null || st.due < min)) min = st.due;
  }
  return min == null ? null : dayOf(min);
}

function showDone() {
  clearTimer();
  stage.hidden = true; doneEl.hidden = false;
  if (deckCards().length === 0) {
    doneEl.innerHTML = '<p class="done-note">tick 平仮名 or 片仮名 above.</p>';
    return;
  }
  const today = dayOf(now()), upcoming = nextDueDay();
  const days = upcoming == null || upcoming <= today ? 0 : upcoming - today;
  const when = days > 0 ? ` Next due in ${days} day${days > 1 ? 's' : ''}.` : '';
  const head = reviewed > 0 ? '完了' : 'all caught up';
  const body = reviewed > 0
    ? `${reviewed} card${reviewed === 1 ? '' : 's'} reviewed.${when}`
    : `nothing due right now.${when}`;
  doneEl.innerHTML = `<div class="done-mark">${head}</div>` +
    `<p class="done-note">${body}</p>` + statsPanel() +
    '<button id="restart" class="grade good">study again</button>';
  $('restart').addEventListener('click', startSession);
}

function startSession() {
  clearTimer();
  stage.hidden = false; doneEl.hidden = true;
  buildSession();
}

cardEl.addEventListener('click', flip);
gradesEl.querySelectorAll('button').forEach(b =>
  b.addEventListener('click', () => grade(b.dataset.grade)));
deckBar.querySelectorAll('input').forEach(i =>
  i.addEventListener('change', () => { savePref(); startSession(); }));

document.addEventListener('keydown', ev => {
  if (!doneEl.hidden || !current) return;
  if (!flipped) {
    if (ev.code === 'Space' || ev.code === 'Enter') { ev.preventDefault(); flip(); }
    return;
  }
  if (ev.code === 'Space' || ev.key === '3') { ev.preventDefault(); grade('good'); }
  else if (ev.key === '1') grade('again');
  else if (ev.key === '2') grade('hard');
  else if (ev.key === '4') grade('easy');
});

applyPref();
updateStreak();
startSession();
```

- [ ] **Step 4: Syntax-check the JS**

Run: `node --check fsrs.js && node --check anki.js && echo OK`
Expected: `OK` (no syntax errors). `node --test` still passes.

- [ ] **Step 5: Manual smoke test** — open `anki.html` via `file://` in a browser and confirm:
  - Four grade buttons render: Again / Hard / Good / Easy, in that order, with distinct colors.
  - A new card: flip shows four ascending intervals (e.g. `1m` / `6m` / `10m` / `~8d`) — Good and Easy are never equal.
  - Press Good on a new card → it leaves; after the queue drains to only that card's step, a `next card in M:SS` countdown shows, then the card returns.
  - Keys: Space/Enter flips; 1/2/3/4 grade; Space grades Good.
  - Reload the page → progress persists; streak line and end-of-session stats panel render; mature/learning/new counts look sane.
  - First load after upgrade: old SM-2 progress is gone (full reset), no console errors.

- [ ] **Step 6: Commit**

```bash
git add anki.html style.css anki.js
git commit -m "feat: FSRS glue — 4 grades, timestamp queue, learning countdown" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WmmoakJHV5SxXioT591kuA"
```

---

## Self-Review

**Spec coverage:**
- FSRS-6 memory model + exact formulas → Tasks 1–3. ✓
- Default weights / DESIRED_RETENTION → Task 1 constants. ✓
- 4 grades (Again/Hard/Good/Easy, keys 1–4, Space=Good) → Task 7. ✓
- Sub-day learning steps (1m/10m) + relearn (10m), timestamp due → Tasks 1, 5, 7. ✓
- Interval fuzz → Task 4, applied in Task 5 `schedule`. ✓
- Monotonic preview intervals → Task 5 `monotone`. ✓
- Session model A (wall-clock queue + countdown) → Task 7 `pickDue`/`showCountdown`. ✓
- Full reset, new keys (`anki-fsrs-v1`, `anki-stats-v2`), legacy keys removed → Task 7. ✓
- `stats.js` unchanged; day-number bucketing via `dayOf` → Task 7. ✓
- Deck breakdown mature = stability ≥ 21 → Task 7 `deckBreakdown`. ✓
- Delete `srs.js`, drop SM-2 tests → Task 6. ✓
- FSRS invariant tests, no mocks, seeded rng → Tasks 1–5. ✓

**Placeholder scan:** none — every step has full code or exact commands.

**Type consistency:** `schedule(card, grade, now, rng)`, `previewIntervals(card, now)`, `fuzzRange`/`applyFuzz`, and the `{state, stability, difficulty, due, last_review, reps, lapses, step}` shape are used identically across `fsrs.js` and `anki.js`. Grade strings `again|hard|good|easy` map to `GRADES` 1–4 consistently. Element ids (`iv-hard`, `countdown`) defined in Task 7 HTML match `anki.js` lookups.
