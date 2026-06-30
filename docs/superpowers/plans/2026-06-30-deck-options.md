# Deck Options Settings Panel (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit the deck's scheduling options (limits, learning steps, target retention, rollover hour) from an inline panel on the page, persisted in localStorage and applied live.

**Architecture:** Pure parse/normalize logic added to `config.js` (node-tested). A native `<details>` options panel in `anki.html` + CSS, wired in `anki.js`: load config (normalize over defaults), save (read inputs → normalize → persist → rebuild session), reset.

**Tech Stack:** Vanilla ESM, `node:test`, esbuild. No new dependencies.

## Global Constraints

- **No new dependencies.** Vanilla ESM only.
- **`config.js` stays pure:** no DOM, no localStorage. Parse/normalize only; the load/save boundary lives in `anki.js`.
- **Comments ≤ 1 line, terse**, why/what not how; no ticket/branch refs.
- **No mocks.** Drive the pure config functions with real inputs; assert observable outcomes. All tests pass via `node test.js`.
- **Six exposed fields** (verbatim ranges): newPerDay int [0,9999]; reviewsPerDay int [0,9999]; learnSteps / relearnSteps = positive minutes, fall back to default when empty; desiredRetention clamp [0.80, 0.97] (UI shows it as a percent 80–97); rolloverHour int [0,23]. `learnAheadMins` is NOT exposed — keep the default.
- **Clamp on save, never reject mid-type.**
- **Non-destructive:** new key `anki-config-v1`; other keys untouched.
- **Live application:** saving rebuilds the session via `startSession()`; config is read live by Phase 1.

## File Structure

- `src/config.js` — **modify.** Add `parseSteps`, `formatSteps`, `normalizeConfig`; extend exports. Stays pure.
- `src/anki.html` — **modify.** Add the `<details class="options">` panel after the deck bar.
- `src/style.css` — **modify.** Style the options panel.
- `src/anki.js` — **modify.** Load/save config; `CONFIG` becomes `let`; fill/save/reset + button wiring.
- `test.js` — **modify.** Add the `config:` test block.

---

### Task 1: `config.js` — pure parse + normalize

**Files:**
- Modify: `src/config.js`
- Test: `test.js` (append config block)

**Interfaces:**
- Consumes: `DEFAULT_CONFIG` (existing).
- Produces: `parseSteps(str) -> number[]` (whitespace-split, positive finite only, `[]` when none); `formatSteps(arr) -> string` (space-joined); `normalizeConfig(raw={}) -> config` (merge over defaults + clamp every field; `learnAheadMins` kept from default).

- [ ] **Step 1: Write the failing tests**

Append to `test.js`:

```js
import { DEFAULT_CONFIG, parseSteps, formatSteps, normalizeConfig } from './src/config.js';

test('config: parseSteps reads space-separated positive minutes, else empty', () => {
  assert.deepEqual(parseSteps('1 10'), [1, 10]);
  assert.deepEqual(parseSteps('1  10'), [1, 10]);
  assert.deepEqual(parseSteps('  '), []);
  assert.deepEqual(parseSteps('x'), []);
  assert.deepEqual(parseSteps('1 -5 10'), [1, 10]);   // drops non-positive
});

test('config: formatSteps round-trips with parseSteps', () => {
  assert.equal(formatSteps([1, 10]), '1 10');
  assert.deepEqual(parseSteps(formatSteps([1, 10, 60])), [1, 10, 60]);
});

test('config: normalizeConfig clamps each field to its valid range', () => {
  assert.equal(normalizeConfig({ desiredRetention: 1.5 }).desiredRetention, 0.97);
  assert.equal(normalizeConfig({ desiredRetention: 0.1 }).desiredRetention, 0.80);
  assert.equal(normalizeConfig({ newPerDay: -5 }).newPerDay, 0);
  assert.equal(normalizeConfig({ newPerDay: 12.6 }).newPerDay, 13);   // rounded int
  assert.equal(normalizeConfig({ rolloverHour: 30 }).rolloverHour, 23);
  assert.deepEqual(normalizeConfig({ learnSteps: [] }).learnSteps, DEFAULT_CONFIG.learnSteps);
  assert.deepEqual(normalizeConfig({ learnSteps: [0, -1] }).learnSteps, DEFAULT_CONFIG.learnSteps);
});

test('config: normalizeConfig merges a partial blob over defaults', () => {
  const c = normalizeConfig({ newPerDay: 30 });
  assert.equal(c.newPerDay, 30);
  assert.equal(c.reviewsPerDay, DEFAULT_CONFIG.reviewsPerDay);
  assert.equal(c.rolloverHour, DEFAULT_CONFIG.rolloverHour);
  assert.equal(c.learnAheadMins, DEFAULT_CONFIG.learnAheadMins);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test-name-pattern '^config:' test.js`
Expected: FAIL — `parseSteps`/`formatSteps`/`normalizeConfig` are not exported.

- [ ] **Step 3: Modify `src/config.js`**

Update the header comment (no longer "Phase 2 adds…") and add the functions + exports. The file becomes:

```js
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
  const learn = Array.isArray(c.learnSteps) ? c.learnSteps.filter(n => n > 0) : [];
  const relearn = Array.isArray(c.relearnSteps) ? c.relearnSteps.filter(n => n > 0) : [];
  return {
    newPerDay: isNaN(c.newPerDay) ? DEFAULT_CONFIG.newPerDay : clampInt(c.newPerDay, 0, 9999),
    reviewsPerDay: isNaN(c.reviewsPerDay) ? DEFAULT_CONFIG.reviewsPerDay : clampInt(c.reviewsPerDay, 0, 9999),
    learnSteps: learn.length ? learn : DEFAULT_CONFIG.learnSteps,
    relearnSteps: relearn.length ? relearn : DEFAULT_CONFIG.relearnSteps,
    desiredRetention: isNaN(c.desiredRetention) ? DEFAULT_CONFIG.desiredRetention
      : Math.min(0.97, Math.max(0.80, Number(c.desiredRetention))),
    rolloverHour: isNaN(c.rolloverHour) ? DEFAULT_CONFIG.rolloverHour : clampInt(c.rolloverHour, 0, 23),
    learnAheadMins: DEFAULT_CONFIG.learnAheadMins,
  };
}

export { DEFAULT_CONFIG, parseSteps, formatSteps, normalizeConfig };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test-name-pattern '^config:' test.js`
Expected: PASS (4 tests). Then `node test.js` — all green (52 + 4 = 56).

- [ ] **Step 5: Commit**

```bash
git add src/config.js test.js
git commit -m "feat: config.js — pure step parsing + option normalization/clamping"
```

---

### Task 2: options panel — markup, style, glue

**Files:**
- Modify: `src/anki.html` (add panel after the deck bar)
- Modify: `src/style.css` (panel styles)
- Modify: `src/anki.js` (load/save/reset config + wiring)
- Test: existing `build:` tests + manual browser verification

**Interfaces:**
- Consumes: `normalizeConfig`, `parseSteps`, `formatSteps` (Task 1); existing `startSession`, `updateStreak`, `today`.
- Produces: none (page leaf).

- [ ] **Step 1: Add the panel markup to `src/anki.html`**

Insert directly after the `</div>` that closes `#deck-bar` (currently followed by the `#streak` paragraph):

```html
    <details class="options" id="options">
      <summary>⚙ options</summary>
      <div class="options-grid">
        <label>new cards/day <input type="number" id="opt-new" min="0" max="9999"></label>
        <label>max reviews/day <input type="number" id="opt-rev" min="0" max="9999"></label>
        <label>learning steps (min) <input type="text" id="opt-learn"></label>
        <label>relearning steps (min) <input type="text" id="opt-relearn"></label>
        <label>target retention % <input type="number" id="opt-retention" min="80" max="97"></label>
        <label>day rollover hour <input type="number" id="opt-rollover" min="0" max="23"></label>
      </div>
      <div class="options-actions">
        <button id="opt-save" class="opt-btn">save</button>
        <button id="opt-reset" class="opt-btn">reset to defaults</button>
      </div>
    </details>
```

- [ ] **Step 2: Add the panel styles to `src/style.css`**

Append:

```css
.options { max-width: 22rem; margin: 0 auto 1.25rem; font-size: .9rem; }
.options summary { cursor: pointer; text-align: center; opacity: .55; list-style: none; }
.options summary::-webkit-details-marker { display: none; }
.options summary:hover { opacity: .9; }
.options-grid { display: grid; gap: .5rem; margin: .75rem 0; }
.options-grid label { display: flex; justify-content: space-between; align-items: center; gap: .75rem; }
.options-grid input {
  width: 6rem; font: inherit; padding: .25rem .4rem;
  border: 1px solid var(--line); border-radius: .4rem;
  background: var(--cell); color: var(--text);
}
.options-actions { display: flex; justify-content: center; gap: .75rem; }
.opt-btn {
  font: inherit; font-size: .8rem; color: var(--text); background: none;
  border: 1px solid var(--line); border-radius: .5rem; padding: .4rem .9rem;
  cursor: pointer; opacity: .7;
}
.opt-btn:hover { opacity: 1; }
```

- [ ] **Step 3: Load config from localStorage in `src/anki.js`**

Change the config import line (currently `import { DEFAULT_CONFIG } from './config.js';`):

```js
import { DEFAULT_CONFIG, normalizeConfig, parseSteps, formatSteps } from './config.js';
```

Replace `const CONFIG = DEFAULT_CONFIG;` with a loader and a `let`:

```js
const CONFIG_KEY = 'anki-config-v1';
function loadConfig() {
  try { return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}); }
  catch (e) { return normalizeConfig({}); }
}
let CONFIG = loadConfig();
```

(`DEFAULT_CONFIG` is still imported — `normalizeConfig` uses it internally; the import line keeps it for clarity even though `anki.js` no longer references it directly. If a lint/review flags `DEFAULT_CONFIG` as unused in anki.js, drop it from this import — `normalizeConfig({})` already yields defaults.)

- [ ] **Step 4: Add panel input refs in `src/anki.js`**

After the existing `const iv = {...};` ref block, add:

```js
const opt = { new: $('opt-new'), rev: $('opt-rev'), learn: $('opt-learn'),
  relearn: $('opt-relearn'), retention: $('opt-retention'), rollover: $('opt-rollover') };
```

- [ ] **Step 5: Add fill/save/reset functions in `src/anki.js`**

Add these near `startSession` (they reference it):

```js
// Write CONFIG into the panel inputs (retention shown as a percent).
function fillOptions() {
  opt.new.value = CONFIG.newPerDay;
  opt.rev.value = CONFIG.reviewsPerDay;
  opt.learn.value = formatSteps(CONFIG.learnSteps);
  opt.relearn.value = formatSteps(CONFIG.relearnSteps);
  opt.retention.value = Math.round(CONFIG.desiredRetention * 100);
  opt.rollover.value = CONFIG.rolloverHour;
}

// Persist CONFIG and apply it to the live session.
function applyConfig() {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG)); } catch (e) {}
  fillOptions();        // reflect clamped values back to the inputs
  updateStreak();       // rollover may have shifted the day
  startSession();
}

// Read the panel, normalize, and apply.
function saveConfig() {
  CONFIG = normalizeConfig({
    newPerDay: Number(opt.new.value),
    reviewsPerDay: Number(opt.rev.value),
    learnSteps: parseSteps(opt.learn.value),
    relearnSteps: parseSteps(opt.relearn.value),
    desiredRetention: Number(opt.retention.value) / 100,
    rolloverHour: Number(opt.rollover.value),
  });
  applyConfig();
}

function resetConfig() { CONFIG = normalizeConfig({}); applyConfig(); }
```

- [ ] **Step 6: Wire buttons and fill on load in `src/anki.js`**

At the bottom of the file, where it currently ends with `applyPref(); updateStreak(); startSession();`, add the button listeners and an initial `fillOptions()`:

```js
$('opt-save').addEventListener('click', saveConfig);
$('opt-reset').addEventListener('click', resetConfig);

fillOptions();
applyPref();
updateStreak();
startSession();
```

- [ ] **Step 7: Verify build + bundle**

Run: `node test.js`
Expected: PASS — all unit tests plus the `build:` tests (which bundle `anki.js` and would fail on a bad import or syntax error).

Run: `npm run build`
Expected: `built dist/ · <N> files` with no error.

- [ ] **Step 8: Manual browser verification (controller does this)**

The implementer should NOT attempt the browser step. The controller will: serve `dist/`, open `anki.html`, expand **⚙ options**, change new cards/day to a small number and a learning step, click **save**, and confirm: the header reflects the new new-card limit, a graded new card uses the new learning step, an out-of-range value (e.g. retention 200) clamps to 97 on save, and **reset to defaults** restores `20 / 200 / 1 10 / 10 / 90 / 4`.

- [ ] **Step 9: Commit**

```bash
git add src/anki.html src/style.css src/anki.js
git commit -m "feat: inline deck-options panel — edit limits/steps/retention/rollover, persisted"
```

---

## Self-Review

**Spec coverage:**
- Six fields + ranges → Task 1 `normalizeConfig`, Task 2 markup. ✓
- Inline `<details>` panel (not modal) → Task 2 Step 1. ✓
- Steps as space-separated minutes → Task 1 `parseSteps`/`formatSteps`, Task 2 `opt-learn`/`opt-relearn` text inputs. ✓
- Clamp on save → Task 1 `normalizeConfig`; `saveConfig` re-fills inputs with clamped values. ✓
- Live application → Task 2 `applyConfig` → `startSession()` + `updateStreak()`. ✓
- config.js stays pure → Task 1 (no DOM/localStorage); load/save in anki.js. ✓
- Non-destructive `anki-config-v1` → Task 2 Step 3; absent → `normalizeConfig({})` = defaults. ✓
- Reset to defaults → Task 2 `resetConfig`. ✓

**Placeholder scan:** none — every step has full code or an exact command.

**Type consistency:** `normalizeConfig(raw)`, `parseSteps(str)`, `formatSteps(arr)` defined in Task 1 and called with matching shapes in Task 2 (`saveConfig` builds a raw object of the same field names; `fillOptions` reads the normalized config). `CONFIG` is `let` (reassigned in save/reset) and read live by `today()`/`pickNext`/`schedule`/`queueCounts`. Panel IDs in the markup (`opt-new`…`opt-rollover`, `opt-save`, `opt-reset`) match the `opt` ref object and the `$()` listener lookups. ✓
