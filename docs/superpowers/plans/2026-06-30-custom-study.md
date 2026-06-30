# Custom Study / Cram (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After finishing the day's scheduled cards, let the user keep going via two Custom Study modes on the done screen: "study more new" (reschedules) and "cram / free practice" (no schedule change).

**Architecture:** One pure reducer `cramAdvance` in `queue.js` (tested) plus a mode layer in `anki.js` — a `mode`/`extraNew`/`cramQueue` trio, `sessionConfig()` that raises the new limit, and cram/done wiring. "Study more new" reuses `pickNext` with a bumped `newPerDay`; cram drives a shuffled list with a no-write grade path.

**Tech Stack:** Vanilla ESM, `node:test`, esbuild. No new dependencies.

## Global Constraints

- **No new dependencies.** Vanilla ESM only. Comments ≤ 1 line, terse; no ticket/branch refs.
- **`queue.js` stays pure** (no DOM/localStorage/Date.now; `now` passed in). No mocks; assert observable outcomes. All tests pass via `node test.js`.
- **Cram changes nothing**: in cram mode, grading must NOT call `fsrs.schedule`, `recordNew`, `recordReview`, `recordLog`, `saveStore`, or `saveStats`. The card store and stats stay byte-for-byte unchanged.
- **Study more new reschedules normally**: it is the normal grade path with the session's `newPerDay` raised by `STUDY_MORE_N` (10).
- **Custom study is in-memory / per-session**: `startSession()` resets `mode='normal'` and `extraNew=0`; a reload returns to the normal schedule.
- **Buttons live on the done screen** only.

## File Structure

- `src/queue.js` — **modify.** Add pure `cramAdvance(queue, grade)`; extend exports.
- `src/anki.js` — **modify.** Mode layer: state, `sessionConfig()`, cram/study-more wiring, done buttons, cram branches in `next`/`flip`/`grade`/`updateStats`.
- `src/style.css` — **modify.** Stack the done-screen buttons.
- `test.js` — **modify.** Add `cramAdvance` to the queue import; add two `queue:` tests.

---

### Task 1: `queue.js` — `cramAdvance` + study-more-new contract

**Files:**
- Modify: `src/queue.js` (add `cramAdvance`, extend exports)
- Test: `test.js` (queue import + two tests)

**Interfaces:**
- Consumes: existing `pickNext`, and the queue-test helpers already in `test.js` (`QDAY`, `QNOW`, `cfg`, `newC`, plus imported `newStats`, `recordNew`).
- Produces: `cramAdvance(queue, grade) -> string[]` — returns the queue minus its front card, or with the front moved to the back when `grade === 'again'`.

- [ ] **Step 1: Write the failing tests**

In `test.js`, change the existing queue import to add `cramAdvance`:

```js
import { pickNext, counts, cramAdvance } from './src/queue.js';
```

Then append to the queue test block (the `QDAY`/`QNOW`/`cfg`/`newC` helpers are already defined there):

```js
test('queue: cramAdvance drops the front card; Again re-drills it at the back', () => {
  assert.deepEqual(cramAdvance(['a', 'b', 'c'], 'good'), ['b', 'c']);
  assert.deepEqual(cramAdvance(['a', 'b', 'c'], 'easy'), ['b', 'c']);
  assert.deepEqual(cramAdvance(['a', 'b', 'c'], 'again'), ['b', 'c', 'a']);
  let q = ['a', 'b'];
  q = cramAdvance(q, 'again');   // ['b','a'] — re-drill a
  q = cramAdvance(q, 'good');    // ['a']
  q = cramAdvance(q, 'good');    // []
  assert.deepEqual(q, []);       // drains to empty
});

test('queue: raising newPerDay past the spent cap reopens new cards (study more)', () => {
  const stats = newStats();
  recordNew(stats, QDAY); recordNew(stats, QDAY);   // 2 new done == base cap (cfg.newPerDay is 2)
  const cards = [newC('n1')];
  assert.equal(pickNext({ cards, stats, config: cfg, now: QNOW }).kind, 'done'); // cap spent
  const bumped = { ...cfg, newPerDay: cfg.newPerDay + 10 };
  assert.deepEqual(pickNext({ cards, stats, config: bumped, now: QNOW }),
    { kind: 'card', id: 'n1' });                     // bump reopens the new card
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test-name-pattern 'cramAdvance|raising newPerDay' test.js`
Expected: FAIL — `cramAdvance` is not exported (the second test may error on the same missing import).

- [ ] **Step 3: Add `cramAdvance` to `src/queue.js`**

Add the function near the top-level helpers (e.g. after `isLearn`):

```js
// Cram drill step: drop the front card, or re-drill it at the back on Again.
function cramAdvance(queue, grade) {
  const [head, ...rest] = queue;
  return grade === 'again' ? [...rest, head] : rest;
}
```

Update the export line to add `cramAdvance`:

```js
export { pickNext, counts, cramAdvance };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test-name-pattern 'cramAdvance|raising newPerDay' test.js`
Expected: PASS (2 tests). Then `node test.js` — all green (56 + 2 = 58).

- [ ] **Step 5: Commit**

```bash
git add src/queue.js test.js
git commit -m "feat: queue.js — cramAdvance reducer for cram drilling"
```

---

### Task 2: `anki.js` + `style.css` — Custom Study mode layer

**Files:**
- Modify: `src/anki.js` (state, `sessionConfig`, `next`/`flip`/`grade`/`updateStats` cram branches, done buttons, cram functions)
- Modify: `src/style.css` (done-screen button stacking)
- Test: existing `build:` tests + manual browser verification

**Interfaces:**
- Consumes: `cramAdvance` (Task 1); existing `pickNext`, `queueCounts`, `shuffle`, `deckCards`, `deckBreakdown`, `startSession`, `render`, `parseCard`, `previewIntervals`.
- Produces: none (page leaf).

- [ ] **Step 1: Add `cramAdvance` to the queue import in `src/anki.js`**

Change:

```js
import { pickNext, counts as queueCounts } from './queue.js';
```

to:

```js
import { pickNext, counts as queueCounts, cramAdvance } from './queue.js';
```

- [ ] **Step 2: Add mode state + `sessionConfig` in `src/anki.js`**

Replace the session-state line:

```js
let active = [], current = null, flipped = false, reviewed = 0;
```

with:

```js
let active = [], current = null, flipped = false, reviewed = 0;
let mode = 'normal', extraNew = 0, cramQueue = [], crammed = 0;
const STUDY_MORE_N = 10;

// Effective config for the session: Custom Study can raise today's new limit.
const sessionConfig = () => ({ ...CONFIG, newPerDay: CONFIG.newPerDay + extraNew });
```

- [ ] **Step 3: Branch `next` for cram, and use `sessionConfig()` in `src/anki.js`**

Replace `next`:

```js
function next() {
  flipped = false;
  if (mode === 'cram') {
    if (!cramQueue.length) { current = null; return showCramDone(); }
    current = cramQueue[0];
    return render();
  }
  const pick = pickNext({ cards: sessionCards(), stats, config: sessionConfig(), now: now() });
  if (pick.kind === 'card') { current = pick.id; return render(); }
  current = null;
  showDone(pick);
}
```

- [ ] **Step 4: Branch `flip` (no previews in cram) and thread CONFIG in `src/anki.js`**

Replace `flip` (this also fixes a latent gap: the normal preview now uses `CONFIG`, not the default config):

```js
function flip() {
  if (flipped || !current) return;
  flipped = true;
  cardEl.classList.add('flipped');
  hintEl.hidden = true;
  if (mode === 'cram') {
    for (const g of ['again', 'hard', 'good', 'easy']) iv[g].textContent = '';
  } else {
    const p = previewIntervals(stateFor(current), now(), CONFIG);
    for (const g of ['again', 'hard', 'good', 'easy']) iv[g].textContent = fmtIv(p[g]);
  }
  gradesEl.hidden = false;
}
```

- [ ] **Step 5: Branch `grade` for cram (no writes) in `src/anki.js`**

Replace `grade`:

```js
function grade(g) {
  if (!flipped || !current) return;
  if (mode === 'cram') {
    cramQueue = cramAdvance(cramQueue, g);
    crammed++;
    return next();
  }
  const before = stateFor(current);
  const t = now();
  store[current] = schedule(before, g, t, CONFIG);
  const day = dayOf(t, CONFIG.rolloverHour);
  if (before.state === 'new') recordNew(stats, day);
  recordReview(stats, g, day, before.state === 'review');
  recordLog(stats, { id: current, t, grade: g, state: before.state });
  saveStore(); saveStats();
  reviewed++;
  updateStreak();
  next();
}
```

- [ ] **Step 6: Branch `updateStats` for cram, use `sessionConfig()` in `src/anki.js`**

Replace `updateStats`:

```js
function updateStats() {
  if (mode === 'cram') {
    statsEl.innerHTML = `<span class="ct-learn">cram · ${cramQueue.length} left</span>`;
    return;
  }
  const c = queueCounts({ cards: sessionCards(), stats, config: sessionConfig(), now: now() });
  statsEl.innerHTML = `<span class="ct-new">${c.newLeft} new</span> · ` +
    `<span class="ct-learn">${c.learning} learning</span> · ` +
    `<span class="ct-due">${c.due} due</span>`;
}
```

- [ ] **Step 7: Add the Custom Study buttons to `showDone`, and the cram functions in `src/anki.js`**

In `showDone`, replace the final innerHTML + listener block (currently ending with the `#restart` listener):

```js
  let extra = '';
  if (deckBreakdown().fresh > 0)
    extra += `<button id="more-new" class="grade hard">study ${STUDY_MORE_N} more new</button>`;
  extra += '<button id="cram" class="grade">cram (free practice)</button>';
  doneEl.innerHTML = `<div class="done-mark">${head}</div>` +
    `<p class="done-note">${body}</p>` + statsPanel() +
    '<button id="restart" class="grade good">study again</button>' + extra;
  $('restart').addEventListener('click', startSession);
  if ($('more-new')) $('more-new').addEventListener('click', studyMoreNew);
  $('cram').addEventListener('click', startCram);
```

Add the Custom Study functions right after `startSession`:

```js
// Custom Study: raise today's new limit and keep going (reschedules normally).
function studyMoreNew() {
  extraNew += STUDY_MORE_N;
  stage.hidden = false; doneEl.hidden = true;
  next();
}

// Cram: drill the whole deck, shuffled, with no effect on the schedule.
function startCram() {
  mode = 'cram'; cramQueue = shuffle(deckCards()); crammed = 0;
  stage.hidden = false; doneEl.hidden = true;
  next();
}

function showCramDone() {
  stage.hidden = true; doneEl.hidden = false;
  doneEl.innerHTML = '<div class="done-mark">済</div>' +
    `<p class="done-note">cram complete — ${crammed} drilled.</p>` +
    '<button id="cram-again" class="grade good">cram again</button>' +
    '<button id="cram-back" class="grade">back</button>';
  $('cram-again').addEventListener('click', startCram);
  $('cram-back').addEventListener('click', startSession);
}
```

- [ ] **Step 8: Reset mode/extraNew in `startSession` (`src/anki.js`)**

Replace `startSession`:

```js
function startSession() {
  mode = 'normal'; extraNew = 0;
  stage.hidden = false; doneEl.hidden = true;
  buildSession();
}
```

- [ ] **Step 9: Stack the done-screen buttons in `src/style.css`**

Append:

```css
.done .grade { display: block; width: 100%; max-width: 16rem; margin: .5rem auto 0; }
```

- [ ] **Step 10: Verify build + bundle**

Run: `node test.js`
Expected: PASS — all unit tests plus the `build:` tests (which bundle `anki.js` and would fail on a bad import or syntax error).

Run: `npm run build`
Expected: `built dist/ · <N> files` with no error.

- [ ] **Step 11: Manual browser verification (controller does this)**

The implementer should NOT attempt the browser step. The controller will: serve `dist/`, exhaust the day (or prime stats so the done screen shows), then:
- **cram**: snapshot `localStorage['anki-fsrs-v1']` and `['anki-stats-v2']`, enter cram, grade several cards (Again re-queues — the same card returns after the others; Good advances), exit at cram-done, and confirm both localStorage values are unchanged (cram wrote nothing).
- **study more new**: with new cards remaining, click "study 10 more new" and confirm new cards appear past the cap and grading them DOES update the store.

- [ ] **Step 12: Commit**

```bash
git add src/anki.js src/style.css
git commit -m "feat: Custom Study on the done screen — study more new + cram (free practice)"
```

---

## Self-Review

**Spec coverage:**
- Study more new (reschedules) → Task 2 `studyMoreNew` + `sessionConfig` newPerDay bump; mechanism locked by Task 1's queue test. ✓
- Cram (no schedule change) → Task 2 `startCram` + `grade` cram branch (no store/stats writes) + Task 1 `cramAdvance`. ✓
- Again re-drills, others drop → Task 1 `cramAdvance`; cram ends when queue empties → `next`→`showCramDone`. ✓
- Interval previews hidden in cram → Task 2 `flip` cram branch. ✓
- Buttons on the done screen only → Task 2 `showDone`. ✓
- In-memory/per-session; reload returns to normal → Task 2 `startSession` resets `mode`/`extraNew`. ✓

**Placeholder scan:** none — every step has full code or an exact command.

**Type consistency:** `cramAdvance(queue, grade)` defined in Task 1, imported and called in Task 2 with the same shape. `mode`/`extraNew`/`cramQueue`/`crammed`/`STUDY_MORE_N`/`sessionConfig` declared in Task 2 Step 2 and used consistently across `next`/`grade`/`updateStats`/`flip`/`studyMoreNew`/`startCram`/`showCramDone`/`startSession`. `sessionConfig()` is passed to `pickNext`/`queueCounts` (Steps 3, 6); `CONFIG` stays for `schedule`/`previewIntervals` (Steps 4, 5). Done-screen button IDs (`more-new`, `cram`, `restart`, `cram-again`, `cram-back`) are each wired to a listener. ✓
