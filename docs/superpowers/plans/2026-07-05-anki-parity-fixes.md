# Anki Parity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five real-Anki behavior gaps found in the audit: Hard-step repeat, undo, leech auto-suspend, honest done screen, and the retention range.

**Architecture:** Pure modules keep their boundaries — `fsrs.js` (scheduling math + leech predicate), `queue.js` (selection honors `suspended`, honest done payload), `stats.js` (new pure inverses), `config.js` (clamps). `anki.js` stays thin glue: undo stack, leech suspension, done-screen copy.

**Tech Stack:** Vanilla ES modules, `node:test` via `npm test`, esbuild via `npm run build`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-05-anki-parity-design.md`

## Global Constraints

- Comments never exceed 1 line / 80 chars; keep them minimal.
- NO MOCKS — test pure functions with real data via `npm test`.
- Pure modules (`fsrs.js`, `queue.js`, `stats.js`, `config.js`, `day.js`) must stay DOM-free and node-importable.
- Card blobs gain optional `suspended: true`; absent means active (no migration).
- Anki defaults are fixed, not UI-exposed: leech threshold 8, learn-ahead 20 min.
- Run the full suite before every commit; all tests must pass.

---

### Task 1: Hard repeats the current learning step (`fsrs.js`)

**Files:**
- Modify: `src/fsrs.js:129-134` (the `g === 2` learning branch)
- Test: `test.js` (add after the relearning test around line 260)

**Interfaces:**
- Consumes: existing `fsrs.schedule(card, grade, now, cfg)`.
- Produces: no signature change; Hard on learning/relearning steps now delays by Anki's rule (step 0 of ≥2 steps → average of first two; lone step → ×1.5; later steps → repeat the current step).

- [ ] **Step 1: Write the failing test**

Add to `test.js` after the `'fsrs: Again on a review card lapses into relearning at the 10m step'` test:

```js
test('fsrs: Hard repeats the current learning step; lone step is x1.5', () => {
  const cfg3 = { newPerDay: 20, reviewsPerDay: 200, learnSteps: [1, 10, 60],
    relearnSteps: [10], desiredRetention: 0.9, rolloverHour: 4, learnAheadMins: 20 };
  const mid = { state: 'learning', stability: 1, difficulty: 5,
    due: T, last_review: T - MIN, reps: 0, lapses: 0, step: 1 };
  const h = fsrs.schedule(mid, 'hard', T, cfg3);
  assert.equal(h.due - T, 10 * MIN);                // repeats the 10m step
  assert.equal(h.step, 1);                          // Hard never advances
  const lone = fsrs.schedule(fsrs.newCard(), 'hard', T,
    { ...cfg3, learnSteps: [10] });
  assert.equal(lone.due - T, 15 * MIN);             // lone step x1.5
  const first = fsrs.schedule(fsrs.newCard(), 'hard', T); // default steps 1 10
  assert.equal(first.due - T, 5.5 * MIN);           // first of two: average
});
```

`T` and `MIN` already exist in `test.js` (lines 214–216).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 "Hard repeats"`
Expected: FAIL — actual delay is `35 * MIN` (old code averages steps 10 and 60).

- [ ] **Step 3: Fix the `g === 2` branch in `src/fsrs.js`**

Replace:

```js
    else if (g === 2) {
      const delay = i + 1 < steps.length
        ? (steps[i] + steps[i + 1]) / 2 : steps[i] * 1.5;
      c.step = i; c.due = now + delay;
    }
```

with:

```js
    else if (g === 2) {
      // Hard repeats the step; step 0 averages the first two, lone step x1.5.
      const delay = i === 0
        ? (steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[0] * 1.5)
        : steps[i];
      c.step = i; c.due = now + delay;
    }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass (60 total).

- [ ] **Step 5: Commit**

```bash
git add src/fsrs.js test.js
git commit -m "fix: Hard repeats the current learning step like Anki"
```

---

### Task 2: `isLeech` predicate + `leechThreshold` config

**Files:**
- Modify: `src/fsrs.js` (add function + export)
- Modify: `src/config.js` (DEFAULT_CONFIG + normalizeConfig)
- Test: `test.js`

**Interfaces:**
- Produces: `isLeech(lapses, threshold = 8) -> boolean` exported from `src/fsrs.js`; `DEFAULT_CONFIG.leechThreshold === 8`, forced to default by `normalizeConfig` (like `learnAheadMins`). Task 7 consumes both.

- [ ] **Step 1: Write the failing tests**

Add to `test.js` after the Task 1 test:

```js
test('fsrs: isLeech trips at the threshold and every half-threshold after', () => {
  assert.equal(fsrs.isLeech(7), false);
  assert.equal(fsrs.isLeech(8), true);
  assert.equal(fsrs.isLeech(9), false);
  assert.equal(fsrs.isLeech(12), true);
  assert.equal(fsrs.isLeech(16), true);
  assert.equal(fsrs.isLeech(3, 4), false);
  assert.equal(fsrs.isLeech(4, 4), true);
  assert.equal(fsrs.isLeech(6, 4), true);
});
```

And extend the existing `'config: normalizeConfig merges a partial blob over defaults'` test with one line:

```js
  assert.equal(normalizeConfig({ leechThreshold: 3 }).leechThreshold, 8);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -B1 -A3 "isLeech\|merges a partial"`
Expected: FAIL — `fsrs.isLeech is not a function`, and `leechThreshold` is `3` (raw value leaks through the spread; the field must be forced to the default).

- [ ] **Step 3: Implement**

In `src/fsrs.js`, add after `sameDayStability`:

```js
// Anki leech check: trips at the threshold, then every half-threshold after.
function isLeech(lapses, threshold = 8) {
  if (lapses < threshold) return false;
  return (lapses - threshold) % Math.max(1, Math.floor(threshold / 2)) === 0;
}
```

and add `isLeech` to the export list.

In `src/config.js`, add to `DEFAULT_CONFIG`:

```js
  leechThreshold: 8,
```

and to the object returned by `normalizeConfig`:

```js
    leechThreshold: DEFAULT_CONFIG.leechThreshold,
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/fsrs.js src/config.js test.js
git commit -m "feat: isLeech predicate + fixed leechThreshold config"
```

---

### Task 3: Retention range matches Anki (0.70–0.99)

**Files:**
- Modify: `src/config.js:39` (clamp bounds)
- Modify: `src/anki.html:36` (input min/max)
- Test: `test.js:501-502` (existing clamp expectations)

**Interfaces:**
- Produces: `normalizeConfig` clamps `desiredRetention` to `[0.70, 0.99]`.

- [ ] **Step 1: Update the existing test to the Anki bounds**

In `'config: normalizeConfig clamps each field to its valid range'`, change:

```js
  assert.equal(normalizeConfig({ desiredRetention: 1.5 }).desiredRetention, 0.99);
  assert.equal(normalizeConfig({ desiredRetention: 0.1 }).desiredRetention, 0.70);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A4 "clamps each field"`
Expected: FAIL — clamp still returns 0.97 / 0.80.

- [ ] **Step 3: Implement**

In `src/config.js` change the `desiredRetention` line to:

```js
    desiredRetention: isNaN(c.desiredRetention) ? DEFAULT_CONFIG.desiredRetention
      : Math.min(0.99, Math.max(0.70, Number(c.desiredRetention))),
```

In `src/anki.html` change the retention input to:

```html
        <label>target retention % <input type="number" id="opt-retention" min="70" max="99"></label>
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/anki.html test.js
git commit -m "feat: retention range 70-99% to match Anki"
```

---

### Task 4: Queue skips suspended cards (`queue.js`)

**Files:**
- Modify: `src/queue.js` (`partition` and `nextDueDay` loops)
- Test: `test.js` (queue section, after the counts test)

**Interfaces:**
- Consumes: card field `suspended?: true` (set by Task 7's glue; any truthy value).
- Produces: suspended cards are invisible to `pickNext`, `counts`, and `nextDueDay`.

- [ ] **Step 1: Write the failing test**

Add to `test.js` after `'queue: counts are limit-capped and agree with the queue'`:

```js
test('queue: suspended cards are invisible to picks, counts, and due hints', () => {
  const cards = [{ ...newC('n1'), suspended: true },
    { ...learnC('l1', QNOW - 1000), suspended: true },
    { ...revC('r1', QNOW - 1000), suspended: true }];
  const p = pickNext({ cards, stats: newStats(), config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');
  assert.equal(p.learning, 0);
  assert.equal(p.dueDay, null);                     // nothing upcoming either
  const c = counts({ cards, stats: newStats(), config: cfg, now: QNOW });
  assert.deepEqual(c, { newLeft: 0, learning: 0, due: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A4 "suspended cards"`
Expected: FAIL — the suspended learning card is picked.

- [ ] **Step 3: Implement**

In `src/queue.js` `partition`, make the first loop line a skip:

```js
  for (const c of cards) {
    if (c.suspended) continue;
```

In `nextDueDay`, add the same skip as the first line of its `for` loop:

```js
  for (const c of cards) {
    if (c.suspended) continue;
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/queue.js test.js
git commit -m "feat: queue treats suspended cards as invisible"
```

---

### Task 5: Honest done screen when the review limit hides cards

**Files:**
- Modify: `src/queue.js` (`nextDueDay` signature, `pickNext` done payload)
- Modify: `src/anki.js` (`showDone` copy)
- Test: `test.js` (queue section)

**Interfaces:**
- Produces: `pickNext` done payload is `{ kind: 'done', learning, revHidden, dueDay }` where `revHidden` counts due reviews blocked by the spent daily limit; `nextDueDay(cards, cfg, today, newDone, revDone)` gains the fifth param. `showDone` renders the message.

- [ ] **Step 1: Write the failing test**

Add to `test.js` after the Task 4 test:

```js
test('queue: a spent review limit reports hidden reviews due tomorrow', () => {
  const stats = newStats();
  recordReview(stats, 'good', QDAY, true);
  recordReview(stats, 'good', QDAY, true);          // review cap (2) spent
  const cards = [revC('r1', QNOW - 2000), revC('r2', QNOW - 1000)];
  const p = pickNext({ cards, stats, config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');
  assert.equal(p.revHidden, 2);
  assert.equal(p.dueDay, QDAY + 1);                 // hint says tomorrow, not silence
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A4 "spent review limit"`
Expected: FAIL — `revHidden` is `undefined` and `dueDay` is `QDAY` (today).

- [ ] **Step 3: Implement the queue side**

In `src/queue.js`, replace `nextDueDay` with:

```js
// Earliest study-day with available work given spent limits, or null. Learning
// is handled separately via the done `learning` count, so it is excluded here.
function nextDueDay(cards, cfg, today, newDone, revDone) {
  const canNew = newDone < cfg.newPerDay;
  const canRev = revDone < cfg.reviewsPerDay;
  let min = null;
  for (const c of cards) {
    if (c.suspended) continue;
    let d = null;
    if (c.state === 'new') d = canNew ? today : today + 1;
    else if (c.state === 'review') {
      const dd = dayOf(c.due, cfg.rolloverHour);
      d = dd > today ? dd : canRev ? today : today + 1;
    }
    if (d != null && (min == null || d < min)) min = d;
  }
  return min;
}
```

In `pickNext`, replace the final `return` with:

```js
  return { kind: 'done', learning: pendingLearn.length,
    revHidden: revDone >= config.reviewsPerDay ? dueRev.length : 0,
    dueDay: nextDueDay(cards, config, today, newDone, revDone) };
```

- [ ] **Step 4: Run the queue tests**

Run: `npm test`
Expected: all pass (the older done-shape tests assert per-field, not deepEqual).

- [ ] **Step 5: Render the message in `src/anki.js`**

Change `showDone`'s signature and body:

```js
function showDone(done = { learning: 0, dueDay: null, revHidden: 0 }) {
```

and after the `when` computation add:

```js
  const capped = done.revHidden > 0
    ? ` daily review limit reached — ${done.revHidden} waiting.` : '';
```

then include it in both body strings:

```js
  const body = reviewed > 0
    ? `${reviewed} card${reviewed === 1 ? '' : 's'} reviewed.${capped}${when}`
    : `nothing due right now.${capped}${when}`;
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/queue.js src/anki.js test.js
git commit -m "feat: done screen reports reviews hidden by the daily limit"
```

---

### Task 6: Pure stats inverses (`stats.js`)

**Files:**
- Modify: `src/stats.js` (three new functions + exports)
- Test: `test.js` (stats section, extend the import at the top)

**Interfaces:**
- Produces: `unrecordReview(stats, grade, day, wasReview = false)`,
  `unrecordNew(stats, day)`, `unrecordLog(stats)` — each exactly reverses its
  record counterpart as seen by every reader, flooring at zero. Task 8 consumes
  all three.

- [ ] **Step 1: Write the failing tests**

Extend the stats import at the top of `test.js` with `unrecordReview, unrecordNew, unrecordLog` (and `revDoneOn` if not already imported). Add after the review-log tests:

```js
test('stats: unrecord* reverses record* as seen by every reader', () => {
  const s = newStats();
  recordReview(s, 'good', 10, true);
  recordNew(s, 10);
  recordReview(s, 'again', 10, false);
  recordLog(s, { id: 'x', t: 1, grade: 'again', state: 'new' });
  unrecordLog(s);
  unrecordReview(s, 'again', 10, false);
  unrecordNew(s, 10);
  assert.equal(s.reviews, 1);
  assert.equal(s.again, 0);
  assert.equal(reviewsOn(s, 10), 1);
  assert.equal(revDoneOn(s, 10), 1);
  assert.equal(newOn(s, 10), 0);
  assert.equal(s.log.length, 0);
  assert.equal(retention(s), 1);      // the lapse vanished from retention
});

test('stats: unrecord floors at zero on empty stats', () => {
  const s = newStats();
  unrecordReview(s, 'again', 5, true);
  unrecordNew(s, 5);
  unrecordLog(s);
  assert.equal(s.reviews, 0);
  assert.equal(s.again, 0);
  assert.equal(reviewsOn(s, 5), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A3 "unrecord"`
Expected: FAIL — `unrecordReview is not a function` (import error surfaces first).

- [ ] **Step 3: Implement**

Add to `src/stats.js` after `recordLog` and export all three:

```js
// Reverse one recorded review; floors at zero so undo can't go negative.
function unrecordReview(stats, grade, day, wasReview = false) {
  stats.reviews = Math.max(0, stats.reviews - 1);
  if (grade === 'again') stats.again = Math.max(0, stats.again - 1);
  const d = stats.days[day];
  if (!d) return stats;
  d.n = Math.max(0, d.n - 1);
  if (wasReview) d.rev = Math.max(0, (d.rev || 0) - 1);
  if (grade === 'again') d.again = Math.max(0, d.again - 1);
  return stats;
}

// Reverse one recorded new-card introduction.
function unrecordNew(stats, day) {
  const d = stats.days[day];
  if (d && d.new) d.new -= 1;
  return stats;
}

// Drop the most recent log entry.
function unrecordLog(stats) {
  if (Array.isArray(stats.log)) stats.log.pop();
  return stats;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/stats.js test.js
git commit -m "feat: stats — pure unrecord inverses for undo"
```

---

### Task 7: Leech auto-suspend + unsuspend surfacing (`anki.js`)

**Files:**
- Modify: `src/anki.js` (`grade`, `deckBreakdown`, `statsPanel`, `showDone`, `startCram`, new `unsuspendAll`)

**Interfaces:**
- Consumes: `isLeech` from `src/fsrs.js` (Task 2), `CONFIG.leechThreshold`
  (Task 2), queue invisibility of `suspended` (Task 4).
- Produces: stored cards may carry `suspended: true`; done-screen stats panel
  shows the count with an `#unsuspend` button.

This is DOM glue — the pure pieces were test-driven in Tasks 2 and 4; the repo
has no DOM harness, so these steps go straight to implementation and rely on
the suite for regressions.

- [ ] **Step 1: Suspend on a leech lapse in `grade()`**

Add `isLeech` to the fsrs import in `src/anki.js`:

```js
import { newCard, schedule, previewIntervals, isLeech, DAY_MS } from './fsrs.js';
```

Replace the scheduling lines in `grade()`:

```js
  const before = stateFor(current);
  const t = now();
  const after = schedule(before, g, t, CONFIG);
  if (before.state === 'review' && g === 'again'
      && isLeech(after.lapses, CONFIG.leechThreshold)) after.suspended = true;
  store[current] = after;
```

- [ ] **Step 2: Count suspended cards in `deckBreakdown`**

```js
// Split the selected deck into new / learning / mature, à la Anki's counts.
function deckBreakdown() {
  let fresh = 0, learning = 0, mature = 0, suspended = 0;
  const ids = deckCards();
  for (const id of ids) {
    const st = stateFor(id);
    if (st.suspended) suspended++;
    else if (st.state === 'new') fresh++;
    else if (st.state === 'review' && st.stability >= MATURE_DAYS) mature++;
    else learning++;
  }
  return { fresh, learning, mature, suspended, total: ids.length };
}
```

- [ ] **Step 3: Surface the count in `statsPanel` and wire unsuspend**

Append to the string `statsPanel` returns (after the progress-label `<p>`):

```js
    + (bd.suspended > 0
      ? `<p class="progress-label">⚠ ${bd.suspended} leech${bd.suspended > 1 ? 'es' : ''} suspended
        <button id="unsuspend" class="opt-btn">unsuspend all</button></p>`
      : '');
```

In `showDone`, after the cram button wiring, add:

```js
  if ($('unsuspend')) $('unsuspend').addEventListener('click', unsuspendAll);
```

Add the handler near `startCram`:

```js
// Clear every leech suspension and fold the cards back into the schedule.
function unsuspendAll() {
  for (const id of Object.keys(store)) delete store[id].suspended;
  saveStore();
  startSession();
}
```

- [ ] **Step 4: Exclude suspended cards from cram**

In `startCram`:

```js
  mode = 'cram'; cramQueue = shuffle(deckCards().filter(id => !stateFor(id).suspended));
  crammed = 0;
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass (glue has no node tests; suite guards the pure modules).

- [ ] **Step 6: Commit**

```bash
git add src/anki.js
git commit -m "feat: leeches auto-suspend at the Anki threshold, unsuspend on the done screen"
```

---

### Task 8: Undo the last answer (`anki.js`, `anki.html`, `style.css`)

**Files:**
- Modify: `src/anki.js` (undo stack, `grade`, `startSession`, `startCram`, keyboard handler, wiring)
- Modify: `src/anki.html` (undo button after the stats line)
- Modify: `src/style.css` (`.undo-btn`, after the `.reset-btn` rules)

**Interfaces:**
- Consumes: `unrecordReview`, `unrecordNew`, `unrecordLog` from Task 6.
- Produces: session-only undo of the last answer via `z` / Ctrl+Z or the `#undo` button; works from the done screen; cram answers restore the queue.

Glue task — pure inverses were test-driven in Task 6.

- [ ] **Step 1: Add the button to `src/anki.html`**

After `<p class="stats" id="stats"></p>`:

```html
    <button id="undo" class="undo-btn" hidden>↩ undo</button>
```

- [ ] **Step 2: Style it in `src/style.css`**

After the `.reset-btn` rules:

```css
.undo-btn {
  display: block;
  margin: -.75rem auto .75rem;
  font: inherit;
  font-size: .8rem;
  color: var(--text);
  background: none;
  border: 1px solid var(--line);
  border-radius: .5rem;
  padding: .25rem .8rem;
  opacity: .5;
  cursor: pointer;
}
.undo-btn:hover { opacity: .8; }
```

- [ ] **Step 3: Add the stack and undo to `src/anki.js`**

Import the inverses:

```js
import { newStats, recordReview, recordNew, reviewsOn, recordLog,
  unrecordReview, unrecordNew, unrecordLog,
  currentStreak, bestStreak, retention } from './stats.js';
```

Add near the other session state (`let active = ...`):

```js
let undoStack = [];
const UNDO_CAP = 100;
const undoBtn = $('undo');
```

Note: place these after the `$` helper definitions since `undoBtn` uses `$`.

Add the helpers:

```js
function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_CAP) undoStack.shift();
  undoBtn.hidden = false;
}

function clearUndo() { undoStack = []; undoBtn.hidden = true; }

// Anki-style undo: restore the card, reverse the stats, show it again.
function undo() {
  const e = undoStack.pop();
  if (!e) return;
  undoBtn.hidden = undoStack.length === 0;
  stage.hidden = false; doneEl.hidden = true;
  flipped = false;
  if (e.kind === 'cram') {
    cramQueue = e.queue;
    crammed = Math.max(0, crammed - 1);
    current = cramQueue[0];
    return render();
  }
  store[e.id] = e.prev;
  unrecordReview(stats, e.grade, e.day, e.wasReview);
  if (e.wasNew) unrecordNew(stats, e.day);
  unrecordLog(stats);
  saveStore(); saveStats();
  reviewed = Math.max(0, reviewed - 1);
  current = e.id;
  updateStreak();
  render();
}
```

Restoring `e.prev` also reverses a leech auto-suspension — the snapshot
predates the `suspended` flag.

- [ ] **Step 4: Push entries in `grade()`**

Cram branch:

```js
  if (mode === 'cram') {
    pushUndo({ kind: 'cram', queue: cramQueue });
    cramQueue = cramAdvance(cramQueue, g);
    crammed++;
    return next();
  }
```

Normal branch — compute `day` right after `t`, push before mutating. The
complete `grade()` after this task (Task 7's suspend line included):

```js
function grade(g) {
  if (!flipped || !current) return;
  if (mode === 'cram') {
    pushUndo({ kind: 'cram', queue: cramQueue });
    cramQueue = cramAdvance(cramQueue, g);
    crammed++;
    return next();
  }
  const before = stateFor(current);
  const t = now();
  const day = dayOf(t, CONFIG.rolloverHour);
  pushUndo({ kind: 'grade', id: current, prev: { ...before }, day, grade: g,
    wasNew: before.state === 'new', wasReview: before.state === 'review' });
  const after = schedule(before, g, t, CONFIG);
  if (before.state === 'review' && g === 'again'
      && isLeech(after.lapses, CONFIG.leechThreshold)) after.suspended = true;
  store[current] = after;
  if (before.state === 'new') recordNew(stats, day);
  recordReview(stats, g, day, before.state === 'review');
  recordLog(stats, { id: current, t, grade: g, state: before.state });
  saveStore(); saveStats();
  reviewed++;
  updateStreak();
  next(current);
}
```

- [ ] **Step 5: Clear the stack when its context goes stale**

First line of `startSession()` and of `startCram()`:

```js
  clearUndo();
```

- [ ] **Step 6: Wire the button and keys**

Near the other listeners:

```js
undoBtn.addEventListener('click', undo);
```

At the top of the `keydown` handler, before the existing guard:

```js
document.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT') return;
  if (ev.key === 'z' || ev.key === 'Z') { ev.preventDefault(); return undo(); }
  if (!doneEl.hidden || !current) return;
```

(The `INPUT` guard also stops Space/1–4 from grading while typing in the
options panel.)

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/anki.js src/anki.html src/style.css
git commit -m "feat: undo the last answer — z/Ctrl+Z or the undo button, cram included"
```

---

### Task 9: Final verification + docs

**Files:**
- Modify: `docs/anki-features.md` (move undo/leech/suspend into "Now shipped")

**Interfaces:** none — verification and docs only.

- [ ] **Step 1: Full suite + build**

Run: `npm test && npm run build`
Expected: every test passes; `dist/` builds clean.

- [ ] **Step 2: Update `docs/anki-features.md`**

Add to the "Now shipped" list:

```markdown
- **Undo last answer** (z / Ctrl+Z), **leech auto-suspend** at 8 lapses with
  unsuspend-all, Anki Hard-step behavior, honest daily-limit done screen
```

Remove the now-shipped "Undo last answer" bullet from "Reviewing & answering"
and the "Leech detection" / "Suspend / bury" bullet's leech half from
"Scheduling & algorithm" (keep manual suspend/bury as a future idea).

- [ ] **Step 3: Review the whole diff against the spec**

Run: `git diff main --stat && git log --oneline main..HEAD`
Check each spec section (1–5) has a matching commit.

- [ ] **Step 4: Commit**

```bash
git add docs/anki-features.md
git commit -m "docs: mark undo, leeches, and Anki parity fixes as shipped"
```
