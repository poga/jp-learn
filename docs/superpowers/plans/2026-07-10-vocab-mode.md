# Vocab Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JLPT vocabulary trainer (`vocab.html`) beside the kana trainer, riding the same FSRS engine, with furigana-annotated meaning-recall cards.

**Architecture:** Extract the generic SRS shell out of `anki.js` into `trainer.js` (`createTrainer(spec)`). Kana and vocab each become a thin deck spec. Vocab data is generated at build time from vendored open-licensed CSVs into a committed `src/vocab-data.js`. Furigana is pre-aligned at build time and rendered with native `<ruby>`.

**Tech Stack:** Vanilla ESM, esbuild (only dependency), `node:test`, localStorage, static PWA.

## Global Constraints

- Comments never exceed one line (≤80 chars); keep them minimal, explain "why".
- No runtime dependencies. esbuild is the only devDependency.
- NO MOCKS. Tests exercise real data and real functions. All tests must pass.
- Build stays offline and reproducible: the generated `src/vocab-data.js` is committed; `npm run build` never fetches.
- Card ids are stable and namespaced: kana `entryId:script`, vocab `v:<guid>`.
- Vocab uses its own localStorage namespace: `vocab-fsrs-v1`, `vocab-stats-v2`, `vocab-deck-v1`, `vocab-config-v1`. Zero interaction with kana keys.
- Preserve kana behavior exactly through the refactor.

---

## File Structure

**Create:**
- `src/furigana.js` — pure: `alignFurigana`, `escapeHtml`, `rubyHTML`.
- `src/vocab-deck.js` — pure: `LEVELS`, `idsForLevels`.
- `scripts/gen-vocab.js` — CSV → `src/vocab-data.js`; exports `parseCsv`, `buildVocab`, `generate`.
- `data/jlpt/n5.csv`…`n1.csv` — vendored source lists.
- `data/jlpt/CREDITS.md` — source + license note.
- `src/vocab-data.js` — GENERATED, committed.
- `src/trainer.js` — `createTrainer(spec)`, the extracted shell.
- `src/vocab.js` — vocab deck spec (browser glue).
- `src/vocab.html` — vocab page.

**Modify:**
- `src/anki.js` — reduce to a thin kana deck spec.
- `src/anki.html` — add nav link to vocab + footer credit.
- `src/style.css` — vocab-scoped card sizing + ruby.
- `build.js` — add `vocab.html` page + `vocab.js` entry.
- `package.json` — add `gen:vocab` script.
- `test.js` — new tests.

---

## Task 1: Furigana module (pure)

**Files:**
- Create: `src/furigana.js`
- Test: `test.js`

**Interfaces:**
- Produces:
  - `alignFurigana(word: string, reading: string) -> {t: string, r: string}[]` — ruby segments; `r === ''` means render `t` plain.
  - `escapeHtml(s: string) -> string`
  - `rubyHTML(segs: {t,r}[]) -> string` — `<ruby><rt>` markup; kana-only segments render plain.

- [ ] **Step 1: Write the failing tests**

Append to `test.js`:

```js
import { alignFurigana, rubyHTML, escapeHtml } from './src/furigana.js';

test('furigana: peels okurigana so only the kanji core carries reading', () => {
  assert.deepEqual(alignFurigana('会う', 'あう'), [{ t: '会', r: 'あ' }, { t: 'う', r: '' }]);
});

test('furigana: single kanji takes the whole reading', () => {
  assert.deepEqual(alignFurigana('水', 'みず'), [{ t: '水', r: 'みず' }]);
});

test('furigana: all-kana word gets no ruby', () => {
  assert.deepEqual(alignFurigana('ああ', 'ああ'), [{ t: 'ああ', r: '' }]);
});

test('furigana: multi-kanji block gets one ruby span', () => {
  assert.deepEqual(alignFurigana('日本', 'にほん'), [{ t: '日本', r: 'にほん' }]);
});

test('rubyHTML renders ruby for kanji and plain text for kana', () => {
  assert.equal(rubyHTML(alignFurigana('会う', 'あう')), '<ruby>会<rt>あ</rt></ruby>う');
  assert.equal(rubyHTML(alignFurigana('ああ', 'ああ')), 'ああ');
});

test('escapeHtml neutralizes meaning punctuation', () => {
  assert.equal(escapeHtml('to be <x> & "y"'), 'to be &lt;x&gt; &amp; &quot;y&quot;');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './src/furigana.js'`.

- [ ] **Step 3: Write `src/furigana.js`**

```js
// Furigana ruby: build-time alignment + runtime render. Pure, no deps.

const isKana = ch => /[぀-ヿ]/.test(ch);  // hiragana + katakana blocks

// Peel matching kana off both ends so only the kanji core carries furigana.
export function alignFurigana(word, reading) {
  let s = 0, e = word.length, rs = 0, re = reading.length;
  while (s < e && isKana(word[s]) && word[s] === reading[rs]) { s++; rs++; }
  while (e > s && isKana(word[e - 1]) && word[e - 1] === reading[re - 1]) { e--; re--; }
  const segs = [];
  if (s > 0) segs.push({ t: word.slice(0, s), r: '' });
  const core = word.slice(s, e), coreR = reading.slice(rs, re);
  if (core) segs.push({ t: core, r: [...core].every(isKana) ? '' : coreR });
  if (e < word.length) segs.push({ t: word.slice(e), r: '' });
  return segs.length ? segs : [{ t: word, r: '' }];
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Segments -> <ruby> markup; kana-only segments render as plain text.
export function rubyHTML(segs) {
  return segs.map(({ t, r }) => r
    ? `<ruby>${escapeHtml(t)}<rt>${escapeHtml(r)}</rt></ruby>`
    : escapeHtml(t)).join('');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all prior tests + the 6 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/furigana.js test.js
git commit -m "feat: furigana alignment + ruby render"
```

---

## Task 2: Vocab data pipeline

**Files:**
- Create: `data/jlpt/n5.csv`…`n1.csv`, `data/jlpt/CREDITS.md`
- Create: `scripts/gen-vocab.js`
- Create (generated): `src/vocab-data.js`
- Test: `test.js`

**Interfaces:**
- Consumes: `alignFurigana` from `src/furigana.js`.
- Produces:
  - `parseCsv(text: string) -> string[][]`
  - `buildVocab(fileRows: {level: string, rows: string[][]}[]) -> Entry[]` where `Entry = {id, word, reading, meaning, level, furigana}`.
  - `generate(dir: string) -> Entry[]`
  - `src/vocab-data.js` exporting `VOCAB: Entry[]`.

- [ ] **Step 1: Vendor the CSVs**

```bash
mkdir -p data/jlpt
base="https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src"
for n in 5 4 3 2 1; do curl -fsSL "$base/n$n.csv" -o "data/jlpt/n$n.csv"; done
head -1 data/jlpt/n5.csv
```
Expected header: `expression,reading,meaning,tags,guid`

- [ ] **Step 2: Write `data/jlpt/CREDITS.md`**

```markdown
# Vocabulary data credits

JLPT vocabulary lists vendored from
[jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks).

The word data derives from JMdict (Electronic Dictionary Research and
Development Group) and the Tanos JLPT lists, licensed **CC BY-SA 4.0**.
This project redistributes it under the same license.
```

- [ ] **Step 3: Write the failing tests**

Append to `test.js`:

```js
import { parseCsv, buildVocab, generate } from './scripts/gen-vocab.js';

test('parseCsv keeps commas inside quoted fields', () => {
  const rows = parseCsv('a,b,c\n会う,あう,"to meet, to see"\n');
  assert.deepEqual(rows[1], ['会う', 'あう', 'to meet, to see']);
});

test('buildVocab dedupes by guid and keeps the easiest level', () => {
  const header = ['expression', 'reading', 'meaning', 'tags', 'guid'];
  const v = buildVocab([
    { level: 'N5', rows: [header, ['水', 'みず', 'water', 't', 'G1']] },
    { level: 'N3', rows: [header, ['水', 'みず', 'water', 't', 'G1']] },
  ]);
  assert.equal(v.length, 1);
  assert.equal(v[0].level, 'N5');
  assert.deepEqual(v[0], {
    id: 'v:G1', word: '水', reading: 'みず', meaning: 'water', level: 'N5',
    furigana: [{ t: '水', r: 'みず' }],
  });
});

test('generate produces well-formed, uniquely-ided entries from real CSVs', () => {
  const v = generate('./data/jlpt');
  assert.ok(v.length > 5000, `expected >5000 entries, got ${v.length}`);
  assert.equal(new Set(v.map(e => e.id)).size, v.length, 'ids unique');
  for (const e of v.slice(0, 50)) {
    assert.match(e.id, /^v:/);
    assert.ok(e.word && e.reading && e.meaning);
    assert.match(e.level, /^N[1-5]$/);
    assert.ok(Array.isArray(e.furigana) && e.furigana.length > 0);
  }
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './scripts/gen-vocab.js'`.

- [ ] **Step 5: Write `scripts/gen-vocab.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { alignFurigana } from '../src/furigana.js';

const FILES = [['n5.csv', 'N5'], ['n4.csv', 'N4'], ['n3.csv', 'N3'],
  ['n2.csv', 'N2'], ['n1.csv', 'N1']];
const RANK = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };  // lower = easier

// Minimal RFC-4180-ish CSV: quoted fields with commas + "" escapes.
export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Rows -> deduped entries; a guid keeps its easiest level (files run easy->hard).
export function buildVocab(fileRows) {
  const byGuid = new Map();
  for (const { level, rows } of fileRows) {
    const [header, ...data] = rows;
    const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    for (const r of data) {
      if (r.length < header.length) continue;
      const guid = r[col.guid];
      if (!guid) continue;
      const prev = byGuid.get(guid);
      if (prev && RANK[prev.level] <= RANK[level]) continue;
      const word = r[col.expression], reading = r[col.reading];
      byGuid.set(guid, {
        id: 'v:' + guid, word, reading, meaning: r[col.meaning], level,
        furigana: alignFurigana(word, reading),
      });
    }
  }
  return [...byGuid.values()];
}

export function generate(dir) {
  return buildVocab(FILES.map(([file, level]) => ({
    level, rows: parseCsv(fs.readFileSync(path.join(dir, file), 'utf8')),
  })));
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename;
if (isMain) {
  const root = path.join(import.meta.dirname, '..');
  const vocab = generate(path.join(root, 'data', 'jlpt'));
  const out = '// GENERATED by scripts/gen-vocab.js — do not edit. Run: npm run gen:vocab\n'
    + `export const VOCAB = ${JSON.stringify(vocab)};\n`;
  fs.writeFileSync(path.join(root, 'src', 'vocab-data.js'), out);
  console.log('wrote src/vocab-data.js ·', vocab.length, 'entries');
}
```

- [ ] **Step 6: Add the `gen:vocab` npm script**

In `package.json` `scripts`, add:
```json
    "gen:vocab": "node scripts/gen-vocab.js",
```

- [ ] **Step 7: Generate the data file**

Run: `npm run gen:vocab`
Expected: `wrote src/vocab-data.js · <N> entries` (N > 5000).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add data/jlpt scripts/gen-vocab.js src/vocab-data.js package.json test.js
git commit -m "feat: vendor JLPT vocab + build-time data generator"
```

---

## Task 3: Level deck filter (pure)

**Files:**
- Create: `src/vocab-deck.js`
- Test: `test.js`

**Interfaces:**
- Produces:
  - `LEVELS: string[]` — `['N5','N4','N3','N2','N1']`.
  - `idsForLevels(cards: {id,level}[], levels: string[]) -> string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `test.js`:

```js
import { VOCAB } from './src/vocab-data.js';
import { LEVELS, idsForLevels } from './src/vocab-deck.js';

test('idsForLevels selects only the requested levels, over real data', () => {
  const n5 = idsForLevels(VOCAB, ['N5']);
  assert.ok(n5.length > 0);
  assert.ok(n5.every(id => VOCAB.find(v => v.id === id).level === 'N5'));
  assert.equal(idsForLevels(VOCAB, []).length, 0);
  assert.equal(idsForLevels(VOCAB, ['N5', 'N4']).length,
    idsForLevels(VOCAB, ['N5']).length + idsForLevels(VOCAB, ['N4']).length);
});

test('LEVELS covers N5 through N1', () => {
  assert.deepEqual(LEVELS, ['N5', 'N4', 'N3', 'N2', 'N1']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './src/vocab-deck.js'`.

- [ ] **Step 3: Write `src/vocab-deck.js`**

```js
// Vocab deck: JLPT levels and the pure level -> card-id filter.
export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

export function idsForLevels(cards, levels) {
  return cards.filter(c => levels.includes(c.level)).map(c => c.id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vocab-deck.js test.js
git commit -m "feat: vocab level deck filter"
```

---

## Task 4: Extract the trainer core

Move the generic SRS shell out of `anki.js` into `trainer.js`, and reduce `anki.js` to a kana deck spec. Behavior must be byte-for-byte identical for kana.

**Files:**
- Create: `src/trainer.js`
- Modify: `src/anki.js` (replace entire file)

**Interfaces:**
- Produces: `createTrainer(spec) -> void`, where `spec` is:
  - `keys: {store, stats, pref, config}` — localStorage keys.
  - `cardById: Record<id, entry>` — every renderable card.
  - `migrate?(): void` — one-time legacy cleanup.
  - `selectedIds(): id[]` — currently-selected deck.
  - `setupDeckBar(onChange: () => void): void` — wire deck-bar inputs + persist.
  - `applyPref(): void` — restore saved deck-bar selection.
  - `renderCard(entry) -> {badge: string, front: string, back: string}` — `front`/`back` are HTML.
  - `emptyDeckHint: string` — done-screen HTML when nothing is selected.

- [ ] **Step 1: Create `src/trainer.js`**

```js
import { newCard, schedule, previewIntervals, isLeech, DAY_MS } from './fsrs.js';
import { newStats, recordReview, recordNew, reviewsOn, recordLog,
  unrecordReview, unrecordNew, unrecordLog,
  currentStreak, bestStreak, retention } from './stats.js';
import { pickNext, counts as queueCounts, cramAdvance } from './queue.js';
import { dayOf } from './day.js';
import { normalizeConfig, parseSteps, formatSteps } from './config.js';
import './pwa.js';

// Generic Anki-style trainer shell. A deck spec supplies data, deck-bar, render.
export function createTrainer(spec) {
  const STORE_KEY = spec.keys.store, STATS_KEY = spec.keys.stats;
  const PREF_KEY = spec.keys.pref, CONFIG_KEY = spec.keys.config;
  const MATURE_DAYS = 21, STUDY_MORE_N = 10, UNDO_CAP = 100;

  function loadConfig() {
    try { return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}); }
    catch (e) { return normalizeConfig({}); }
  }
  let CONFIG = loadConfig();

  spec.migrate?.();

  const now = () => Date.now();
  const today = () => dayOf(now(), CONFIG.rolloverHour);
  const byId = spec.cardById;

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

  const stateFor = id => store[id] || newCard();

  const $ = id => document.getElementById(id);
  const statsEl = $('stats'), streakEl = $('streak');
  const stage = $('stage');
  const doneEl = $('done'), cardEl = $('card'), hintEl = $('hint');
  const gradesEl = $('grades'), scriptEl = $('card-script');
  const frontEl = $('card-front'), readingEl = $('card-reading');
  const iv = { again: $('iv-again'), hard: $('iv-hard'),
    good: $('iv-good'), easy: $('iv-easy') };
  const opt = { new: $('opt-new'), rev: $('opt-rev'), learn: $('opt-learn'),
    relearn: $('opt-relearn'), retention: $('opt-retention'), rollover: $('opt-rollover') };

  const deckCards = () => spec.selectedIds();

  let active = [], current = null, flipped = false, reviewed = 0;
  let mode = 'normal', extraNew = 0, cramQueue = [], crammed = 0;
  let undoStack = [];
  const undoBtn = $('undo');

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

  // Effective config: Custom Study can raise today's new limit.
  const sessionConfig = () => ({ ...CONFIG, newPerDay: CONFIG.newPerDay + extraNew });

  // Fisher-Yates; randomizes new-card order so the deck isn't strictly ordered.
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildSession() {
    active = shuffle(deckCards());
    reviewed = 0;
    next();
  }

  // All deck cards as {id, ...state} for the pure queue.
  function sessionCards() {
    return active.map(id => ({ id, ...stateFor(id) }));
  }

  function next(lastId = null) {
    flipped = false;
    if (mode === 'cram') {
      if (!cramQueue.length) { current = null; return showCramDone(); }
      current = cramQueue[0];
      return render();
    }
    const pick = pickNext({ cards: sessionCards(), stats, config: sessionConfig(), now: now(), lastId });
    if (pick.kind === 'card') { current = pick.id; return render(); }
    current = null;
    showDone(pick);
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
    cardEl.hidden = false;
    const { badge, front, back } = spec.renderCard(byId[current]);
    scriptEl.textContent = badge;
    frontEl.innerHTML = front;
    readingEl.innerHTML = back;
    cardEl.classList.remove('flipped');
    gradesEl.hidden = true;
    hintEl.hidden = false;
    updateStats();
  }

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

  function updateStreak() {
    const t = today();
    const cur = currentStreak(stats, t), done = reviewsOn(stats, t);
    streakEl.textContent = cur > 0
      ? `🔥 ${cur}-day streak${done ? ` · ${done} today` : ''}`
      : 'study today to start a streak';
  }

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

  function statsPanel() {
    const t = today();
    const ret = retention(stats);
    const retTxt = ret == null ? '—' : Math.round(ret * 100) + '%';
    const bd = deckBreakdown();
    const learned = bd.learning + bd.mature;
    const pct = bd.total ? Math.round(learned / bd.total * 100) : 0;
    return `<div class="stat-grid">
        <div class="stat"><b>🔥 ${currentStreak(stats, t)}</b><span>day streak</span></div>
        <div class="stat"><b>${bestStreak(stats)}</b><span>best</span></div>
        <div class="stat"><b>${reviewsOn(stats, t)}</b><span>today</span></div>
        <div class="stat"><b>${retTxt}</b><span>retention</span></div>
      </div>
      <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
      <p class="progress-label">${learned} / ${bd.total} learned ·
        ${bd.fresh} new · ${bd.learning} learning · ${bd.mature} mature</p>`
      + (bd.suspended > 0
        ? `<p class="progress-label">⚠ ${bd.suspended} leech${bd.suspended > 1 ? 'es' : ''} suspended
          <button id="unsuspend" class="opt-btn">unsuspend all</button></p>`
        : '');
  }

  function showDone(done = { learning: 0, dueDay: null, revHidden: 0 }) {
    stage.hidden = true; doneEl.hidden = false;
    if (deckCards().length === 0) {
      doneEl.innerHTML = spec.emptyDeckHint;
      return;
    }
    const t = today();
    const days = done.dueDay == null || done.dueDay <= t ? 0 : done.dueDay - t;
    const when = days > 0 ? ` Next due in ${days} day${days > 1 ? 's' : ''}.`
      : done.learning > 0
        ? ` ${done.learning} still in learning — come back soon.` : '';
    const capped = done.revHidden > 0
      ? ` daily review limit reached — ${done.revHidden} waiting.` : '';
    const head = reviewed > 0 ? '完了' : 'all caught up';
    const body = reviewed > 0
      ? `${reviewed} card${reviewed === 1 ? '' : 's'} reviewed.${capped}${when}`
      : `nothing due right now.${capped}${when}`;
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
    if ($('unsuspend')) $('unsuspend').addEventListener('click', unsuspendAll);
  }

  function startSession() {
    clearUndo();
    mode = 'normal'; extraNew = 0;
    stage.hidden = false; doneEl.hidden = true;
    buildSession();
  }

  // Custom Study: raise today's new limit and keep going (reschedules normally).
  function studyMoreNew() {
    extraNew += STUDY_MORE_N;
    stage.hidden = false; doneEl.hidden = true;
    next();
  }

  // Cram: drill the whole deck, shuffled, with no effect on the schedule.
  function startCram() {
    clearUndo();
    mode = 'cram'; cramQueue = shuffle(deckCards().filter(id => !stateFor(id).suspended));
    crammed = 0;
    stage.hidden = false; doneEl.hidden = true;
    next();
  }

  // Clear every leech suspension and fold the cards back into the schedule.
  function unsuspendAll() {
    for (const id of Object.keys(store)) delete store[id].suspended;
    saveStore();
    startSession();
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
    fillOptions();
    updateStreak();
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

  cardEl.addEventListener('click', flip);
  gradesEl.querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => grade(b.dataset.grade)));
  spec.setupDeckBar(startSession);
  undoBtn.addEventListener('click', undo);

  document.addEventListener('keydown', ev => {
    if (ev.target.closest('.options')) return;
    if ((ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) {
      ev.preventDefault(); return undo();
    }
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

  // On foreground return re-pick: a learning card ripened while asleep shows at once.
  function resume() {
    if (doneEl.hidden && !current) next();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
  window.addEventListener('pageshow', resume);

  // Two-tap wipe: first tap arms, a second within the window clears all data.
  const resetBtn = $('reset');
  let resetArm = null;
  resetBtn.addEventListener('click', () => {
    if (resetArm) {
      clearTimeout(resetArm);
      try { localStorage.clear(); } catch (e) {}
      location.reload();
      return;
    }
    resetBtn.classList.add('armed');
    resetBtn.textContent = 'tap again to wipe';
    resetArm = setTimeout(() => {
      resetArm = null;
      resetBtn.classList.remove('armed');
      resetBtn.textContent = 'reset progress';
    }, 3000);
  });

  $('opt-save').addEventListener('click', saveConfig);
  $('opt-reset').addEventListener('click', resetConfig);
  // auto-save each option on blur/Enter so edits persist without clicking save
  Object.values(opt).forEach(i => i.addEventListener('change', saveConfig));

  fillOptions();
  spec.applyPref();
  updateStreak();
  startSession();
}
```

- [ ] **Step 2: Replace `src/anki.js` entirely**

```js
import { KANA } from './kana.js';
import { createTrainer } from './trainer.js';

// Kana deck: one card per glyph × script.
const byId = {};
for (const e of KANA) for (const s of ['hira', 'kata']) {
  const id = `${e.id}:${s}`;
  byId[id] = { id, e, script: s, glyph: s === 'hira' ? e.hira : e.kata };
}
const CARDS = Object.values(byId);

const deckBar = document.getElementById('deck-bar');
const PREF_KEY = 'anki-deck-v1';
const selectedScripts = () =>
  [...deckBar.querySelectorAll('input[name="script"]:checked')].map(c => c.value);

createTrainer({
  keys: { store: 'anki-fsrs-v1', stats: 'anki-stats-v2',
    pref: PREF_KEY, config: 'anki-config-v1' },
  cardById: byId,
  migrate() {
    try { localStorage.removeItem('anki-srs-v1'); localStorage.removeItem('anki-stats-v1'); }
    catch (e) {}
  },
  selectedIds() {
    const scripts = selectedScripts();
    return CARDS.filter(c => scripts.includes(c.script)).map(c => c.id);
  },
  setupDeckBar(onChange) {
    deckBar.querySelectorAll('input').forEach(i => i.addEventListener('change', () => {
      try { localStorage.setItem(PREF_KEY, JSON.stringify(selectedScripts())); } catch (e) {}
      onChange();
    }));
  },
  applyPref() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) {}
    if (!Array.isArray(saved)) return;
    for (const c of deckBar.querySelectorAll('input[name="script"]'))
      c.checked = saved.includes(c.value);
  },
  renderCard: c => ({
    badge: c.script === 'hira' ? 'ひらがな' : 'カタカナ',
    front: c.glyph,
    back: c.e.romaji,
  }),
  emptyDeckHint: '<p class="done-note">tick 平仮名 or 片仮名 above.</p>',
});
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all prior tests unchanged (the pure modules are untouched).

- [ ] **Step 4: Verify the kana page still builds**

Run: `node build.js`
Expected: `built dist/ · <N> files`, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/trainer.js src/anki.js
git commit -m "refactor: extract generic trainer core from anki.js"
```

---

## Task 5: Vocab page + build wiring

Make the vocab trainer reachable end-to-end: its page, its deck spec, styling, build entry, and navigation.

**Files:**
- Create: `src/vocab.js`, `src/vocab.html`
- Modify: `src/style.css`, `build.js`, `src/anki.html`
- Test: `test.js`

**Interfaces:**
- Consumes: `VOCAB` (`src/vocab-data.js`), `idsForLevels` (`src/vocab-deck.js`), `rubyHTML`+`escapeHtml` (`src/furigana.js`), `createTrainer` (`src/trainer.js`).

- [ ] **Step 1: Write `src/vocab.js`**

```js
import { VOCAB } from './vocab-data.js';
import { idsForLevels } from './vocab-deck.js';
import { rubyHTML, escapeHtml } from './furigana.js';
import { createTrainer } from './trainer.js';

// Vocab deck: recognition card, reading shown as furigana, recall the meaning.
const byId = Object.fromEntries(VOCAB.map(v => [v.id, v]));

const deckBar = document.getElementById('deck-bar');
const PREF_KEY = 'vocab-deck-v1';
const selectedLevels = () =>
  [...deckBar.querySelectorAll('input[name="level"]:checked')].map(c => c.value);

createTrainer({
  keys: { store: 'vocab-fsrs-v1', stats: 'vocab-stats-v2',
    pref: PREF_KEY, config: 'vocab-config-v1' },
  cardById: byId,
  selectedIds: () => idsForLevels(VOCAB, selectedLevels()),
  setupDeckBar(onChange) {
    deckBar.querySelectorAll('input').forEach(i => i.addEventListener('change', () => {
      try { localStorage.setItem(PREF_KEY, JSON.stringify(selectedLevels())); } catch (e) {}
      onChange();
    }));
  },
  applyPref() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) {}
    if (!Array.isArray(saved)) return;
    for (const c of deckBar.querySelectorAll('input[name="level"]'))
      c.checked = saved.includes(c.value);
  },
  renderCard: v => ({
    badge: v.level,
    front: rubyHTML(v.furigana),
    back: escapeHtml(v.meaning),
  }),
  emptyDeckHint: '<p class="done-note">tick a JLPT level above.</p>',
});
```

- [ ] **Step 2: Write `src/vocab.html`**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>語彙 アンキ</title>
  <link rel="stylesheet" href="style.css">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#faf7f2" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#16140f" media="(prefers-color-scheme: dark)">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="語彙">
  <link rel="apple-touch-icon" href="apple-touch-icon.png">
</head>
<body class="anki-body vocab-body">
  <header>
    <h1>語彙 アンキ</h1>
    <nav class="page-nav"><a href="anki.html">▸ 五十音 アンキ</a></nav>
  </header>

  <main id="app" class="anki">
    <div class="deck-bar" id="deck-bar">
      <label><input type="checkbox" name="level" value="N5" checked> N5</label>
      <label><input type="checkbox" name="level" value="N4"> N4</label>
      <label><input type="checkbox" name="level" value="N3"> N3</label>
      <label><input type="checkbox" name="level" value="N2"> N2</label>
      <label><input type="checkbox" name="level" value="N1"> N1</label>
    </div>

    <details class="options" id="options">
      <summary>⚙ options</summary>
      <div class="options-grid">
        <label>new cards/day <input type="number" id="opt-new" min="0" max="9999"></label>
        <label>max reviews/day <input type="number" id="opt-rev" min="0" max="9999"></label>
        <label>learning steps (min) <input type="text" id="opt-learn"></label>
        <label>relearning steps (min) <input type="text" id="opt-relearn"></label>
        <label>target retention % <input type="number" id="opt-retention" min="70" max="99"></label>
        <label>day rollover hour <input type="number" id="opt-rollover" min="0" max="23"></label>
      </div>
      <div class="options-actions">
        <button id="opt-save" class="opt-btn">save</button>
        <button id="opt-reset" class="opt-btn">reset to defaults</button>
      </div>
    </details>

    <p class="streak" id="streak"></p>
    <p class="stats" id="stats"></p>
    <button id="undo" class="undo-btn" hidden>↩ undo</button>

    <section class="card-stage" id="stage">
      <div class="card" id="card" role="button" tabindex="0"
           aria-label="flip card">
        <span class="card-script" id="card-script"></span>
        <span class="card-face" id="card-front"></span>
        <span class="card-reading" id="card-reading"></span>
      </div>

      <div class="prompt-hint" id="hint">tap the card or press Space to flip</div>

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
    </section>

    <section class="done" id="done" hidden></section>
  </main>

  <footer class="app-footer">
    <button id="reset" class="reset-btn">reset progress</button>
    <p class="credit">vocab from JMdict / Tanos JLPT lists · CC BY-SA 4.0</p>
  </footer>

  <script type="module" src="vocab.js"></script>
</body>
</html>
```

- [ ] **Step 3: Add vocab-scoped CSS**

Append to `src/style.css`:

```css
/* vocab cards hold whole words, not one glyph — smaller face + ruby */
.vocab-body .card-face { font-size: 2.75rem; }
.vocab-body .card-face rt { font-size: .36em; opacity: .85; }
.vocab-body .card-reading { font-size: 1.3rem; }
.credit { font-size: .7rem; opacity: .4; margin: .75rem 0 0; }
```

- [ ] **Step 4: Add the nav link + credit to `src/anki.html`**

Replace the `<nav>` line (currently only the 五十音 table link) with both links:

```html
    <nav class="page-nav"><a href="index.html">▸ 五十音 table</a> · <a href="vocab.html">▸ 語彙 アンキ</a></nav>
```

And add the credit `<p>` before `</footer>` (after the reset button):

```html
    <p class="credit">vocab from JMdict / Tanos JLPT lists · CC BY-SA 4.0</p>
```

(The credit is harmless on the kana page and keeps the footer consistent; leave it if you prefer it vocab-only — but keeping one shared footer is simpler.)

- [ ] **Step 5: Wire the build**

In `build.js`:

Change line 13:
```js
const PAGES = ['index.html', 'anki.html', 'vocab.html'];
```

Add the vocab entry to `entryPoints` (after `anki.js`):
```js
      path.join(SRC, 'anki.js'),
      path.join(SRC, 'vocab.js'),
```

- [ ] **Step 6: Write the failing build test**

Append to `test.js`:

```js
test('build emits a vocab page that bundles vocab.js and the data', async () => {
  const { refMap } = await build();
  assert.ok(refMap['vocab.js'], 'vocab.js is a hashed entry');
  const dist = path.join(import.meta.dirname, 'dist');
  const html = fs.readFileSync(path.join(dist, 'vocab.html'), 'utf8');
  assert.match(html, new RegExp(refMap['vocab.js']), 'page references hashed vocab.js');
  const bundle = fs.readFileSync(path.join(dist, refMap['vocab.js']), 'utf8');
  assert.match(bundle, /v:/, 'VOCAB data is bundled into the page');
});
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS (build test green; the build produces `dist/vocab.html`).

- [ ] **Step 8: Commit**

```bash
git add src/vocab.js src/vocab.html src/style.css src/anki.html build.js test.js
git commit -m "feat: vocab trainer page + build wiring + nav"
```

---

## Task 6: End-to-end verification (both pages)

No code. Drive the real app to confirm kana is unregressed and vocab works. Use the `verify` / `run` skill with the Chrome tools against a locally served `dist/`.

**Files:** none.

- [ ] **Step 1: Build and serve**

```bash
node build.js
npx --yes serve -l 5055 dist &
```
(or any static server on `dist/`)

- [ ] **Step 2: Kana regression (open `/anki.html`)**

Confirm, unchanged from before:
- A glyph shows; Space flips to reveal the romaji + interval previews.
- Grading (1/2/3/4) advances; the counts (new/learning/due) update.
- `z` undoes the last grade and re-shows the card.
- Toggling 平仮名 / 片仮名 restarts the session and persists on reload.

- [ ] **Step 3: Vocab happy path (open `/vocab.html`)**

Confirm:
- Only N5 is checked; a card shows a word with **furigana ruby** over its kanji.
- Space/tap flips to reveal the **English meaning**; interval previews show.
- Grading advances and updates counts; `🔥` streak line updates after the first grade.
- Checking N4 (or more) enlarges the deck; the selection persists across reload.
- Unchecking every level shows the "tick a JLPT level above." done screen.
- The options panel (new/day, retention, …) persists independently of the kana page.

- [ ] **Step 4: Independence check**

- In DevTools → Application → Local Storage, confirm `vocab-fsrs-v1` / `vocab-stats-v2` exist and kana's `anki-fsrs-v1` is untouched by vocab study (and vice versa).

- [ ] **Step 5: Final suite + build**

Run: `npm test && node build.js`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit any verification fixes**

Only if Step 2–4 surfaced issues; otherwise nothing to commit.

---

## Self-Review

- **Spec coverage:**
  - Card model (word + furigana front, meaning on flip) → Tasks 1, 5.
  - Shared trainer core / deck specs → Task 4.
  - Data pipeline (vendor CSV, generate, dedupe by guid, easiest level, furigana) → Task 2.
  - `v:<guid>` stable ids → Task 2.
  - All N5–N1, level checkboxes, N5 default → Tasks 3, 5.
  - Separate localStorage namespace / independence → Tasks 4, 5, 6.
  - Page + nav → Task 5.
  - Attribution (CC BY-SA) → Tasks 2 (CREDITS.md), 5 (footer credit).
  - Furigana on both faces → front ruby (Task 5 render) is always visible; back reveals meaning — reading shown on both faces via the ever-visible ruby.
  - Testing (gen-vocab, furigana, level filter, build) → Tasks 1, 2, 3, 5. Kana regression + vocab e2e → Task 6.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `alignFurigana`/`rubyHTML`/`escapeHtml`, `idsForLevels(cards, levels)`, `buildVocab(fileRows)`, entry shape `{id, word, reading, meaning, level, furigana}`, and the `spec` interface are used identically across tasks.
```
