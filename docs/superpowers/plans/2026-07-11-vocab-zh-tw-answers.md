# zh-TW Vocab Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vocab trainer card backs show Traditional Chinese (zh-TW) glosses instead of English.

**Architecture:** A committed `data/jlpt/zh-tw.json` maps card guid → zh-TW gloss. `scripts/gen-vocab.js` merges it at generation time (English fallback), regenerating `src/vocab-data.js`. `src/vocab.js` tags the back `lang="zh-Hant"` so Han glyphs don't render with Japanese forms on the `lang="ja"` page.

**Tech Stack:** Node ESM, built-in `node:test` runner (`npm test`), no dependencies beyond esbuild (build only).

## Global Constraints

- Comments never exceed 1 line (80 chars); keep minimal.
- NO MOCKS — tests run against real CSVs and the real zh-tw.json.
- Spec: `docs/superpowers/specs/2026-07-11-vocab-zh-tw-answers-design.md`.
- All 78 existing tests must keep passing (`npm test`).
- Never commit to `main`; work stays on `worktree-vocab-zh-tw`.

---

### Task 1: Gloss merge in gen-vocab

**Files:**
- Modify: `scripts/gen-vocab.js` (buildVocab signature, generate, main block)
- Test: `test.js` (gen-vocab section, after the buildVocab dedupe test ~line 671)

**Interfaces:**
- Consumes: existing `buildVocab(fileRows)`, `generate(dir)`.
- Produces: `buildVocab(fileRows, zh = {})` where `zh` is `{[guid]: string}`; entry `meaning` = `zh[guid] ?? englishMeaning`. `generate(dir)` reads `<dir>/zh-tw.json` when present. Task 2 relies on `generate` picking the file up automatically; Task 3 relies on the main block needing no further change.

- [ ] **Step 1: Write the failing test** (in `test.js`, gen-vocab section)

```js
test('buildVocab prefers zh-tw gloss by guid, falls back to English', () => {
  const header = ['expression', 'reading', 'meaning', 'tags', 'guid'];
  const v = buildVocab([{ level: 'N5', rows: [header,
    ['犬', 'いぬ', 'dog', 'JLPT', 'g1'],
    ['猫', 'ねこ', 'cat', 'JLPT', 'g2']] }], { g1: '狗' });
  const meanings = Object.fromEntries(v.map(e => [e.id, e.meaning]));
  assert.equal(meanings['v:g1'], '狗');
  assert.equal(meanings['v:g2'], 'cat');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "prefers zh-tw"`
Expected: FAIL — meaning `'dog'` !== `'狗'` (map arg ignored today).

- [ ] **Step 3: Minimal implementation** in `scripts/gen-vocab.js`

```js
export function buildVocab(fileRows, zh = {}) {
```

and in the `byGuid.set` call:

```js
        meaning: zh[guid] ?? r[col.meaning], level,
```

and in `generate`:

```js
export function generate(dir) {
  const zhPath = path.join(dir, 'zh-tw.json');
  const zh = fs.existsSync(zhPath)
    ? JSON.parse(fs.readFileSync(zhPath, 'utf8')) : {};
  return buildVocab(FILES.map(([file, level]) => ({
    level, rows: parseCsv(fs.readFileSync(path.join(dir, file), 'utf8')),
  })), zh);
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test 2>&1 | tail -5`
Expected: 79 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-vocab.js test.js
git commit -m "feat: gen-vocab merges zh-tw glosses by guid with English fallback"
```

---

### Task 2: Generate `data/jlpt/zh-tw.json` + data invariants

**COORDINATOR-EXECUTED** — this task fans out ~33 parallel translator
agents; the session coordinator runs it directly instead of dispatching a
single implementer subagent.

**Files:**
- Create: `data/jlpt/zh-tw.json` (committed dataset)
- Create (throwaway, job tmp): `/Users/poga/.claude/jobs/e410ba30/tmp/split.js`, `/Users/poga/.claude/jobs/e410ba30/tmp/assemble.js`, `batches/batch-*.json`, `out/out-*.json`
- Test: `test.js` (gen-vocab section)

**Interfaces:**
- Consumes: `generate(dir)` from Task 1 (entry shape `{id: 'v:'+guid, word, reading, meaning, level}` where `meaning` is still English until the JSON lands).
- Produces: `data/jlpt/zh-tw.json` — one JSON object, guid keys sorted, values are zh-TW gloss strings. Task 3 consumes it via `npm run gen:vocab`.

- [ ] **Step 1: Split entries into batch files**

`/Users/poga/.claude/jobs/e410ba30/tmp/split.js` (run from worktree root):

```js
import fs from 'node:fs';
import { generate } from './scripts/gen-vocab.js';
const entries = generate('data/jlpt').map(e =>
  ({ guid: e.id.slice(2), word: e.word, reading: e.reading, meaning: e.meaning }));
const dir = '/Users/poga/.claude/jobs/e410ba30/tmp/batches';
fs.mkdirSync(dir, { recursive: true });
const SIZE = 250;
for (let i = 0; i * SIZE < entries.length; i++) {
  fs.writeFileSync(`${dir}/batch-${String(i).padStart(2, '0')}.json`,
    JSON.stringify(entries.slice(i * SIZE, (i + 1) * SIZE)));
}
console.log(Math.ceil(entries.length / SIZE), 'batches,', entries.length, 'entries');
```

Run: `node /Users/poga/.claude/jobs/e410ba30/tmp/split.js`
Expected: `33 batches, 8101 entries`

- [ ] **Step 2: Dispatch translator agents** (waves of ~8, retry failures)

Prompt template per batch NN:

> Read `/Users/poga/.claude/jobs/e410ba30/tmp/batches/batch-NN.json` — a JSON array of `{guid, word, reading, meaning}` for Japanese JLPT vocabulary, `meaning` being the English gloss. Translate each entry's meaning into Traditional Chinese as used in Taiwan (zh-TW). Rules: the English gloss is the authoritative sense — do NOT assume the Japanese kanji means the same in Chinese (e.g. 手紙 is 信, not 手紙; 汽車 is 火車; 新聞 is 報紙; 勉強 is 學習). Concise senses separated by 、 mirroring the English senses; keep qualifiers as parentheticals, e.g. "developing (film)" → 顯影（底片）. Traditional characters only, Taiwan usage (計程車 not 出租車, 馬鈴薯 not 土豆). No pinyin, no Japanese kana, no trailing punctuation. Verbs as plain dictionary form (吃, 見面). Write `/Users/poga/.claude/jobs/e410ba30/tmp/out/out-NN.json`: a single JSON object mapping every guid to its gloss — all entries, no omissions. Verify with `node -e` that your output parses and has the same count as the input, then reply with just the count.

- [ ] **Step 3: Assemble and validate**

`/Users/poga/.claude/jobs/e410ba30/tmp/assemble.js` (run from worktree root):

```js
import fs from 'node:fs';
import { generate } from './scripts/gen-vocab.js';
const outDir = '/Users/poga/.claude/jobs/e410ba30/tmp/out';
const zh = {};
for (const f of fs.readdirSync(outDir).sort())
  Object.assign(zh, JSON.parse(fs.readFileSync(`${outDir}/${f}`, 'utf8')));
const guids = generate('data/jlpt').map(e => e.id.slice(2));
const missing = guids.filter(g => !zh[g] || !zh[g].trim());
const simplified = /[见说读语门问间们发东车马鸟鱼时书长乐爱写还这进远点战给让对业电头实现设备条务报员钱纸网络习]/;
const kana = /[ぁ-ゖァ-ヺー]/;
const bad = Object.entries(zh).filter(([, v]) => simplified.test(v) || kana.test(v));
console.log('missing:', missing.length, 'bad:', bad.length);
if (bad.length) console.log(bad.slice(0, 20));
if (missing.length || bad.length) process.exit(1);
const sorted = Object.fromEntries(guids.sort().map(g => [g, zh[g]]));
fs.writeFileSync('data/jlpt/zh-tw.json', JSON.stringify(sorted, null, 1) + '\n');
console.log('wrote data/jlpt/zh-tw.json,', guids.length, 'entries');
```

Run: `node /Users/poga/.claude/jobs/e410ba30/tmp/assemble.js`
Expected: `missing: 0 bad: 0` then `wrote data/jlpt/zh-tw.json, 8101 entries`.
If missing/bad: re-dispatch only the offending guids as a fix-up batch, re-run.

- [ ] **Step 4: Add permanent data-invariant test** (in `test.js`, gen-vocab section)

```js
test('every vocab entry has a Traditional-Chinese gloss', () => {
  const zh = JSON.parse(fs.readFileSync('data/jlpt/zh-tw.json', 'utf8'));
  const entries = generate('data/jlpt');
  const missing = entries.filter(e => !zh[e.id.slice(2)]?.trim());
  assert.equal(missing.length, 0, `no gloss: ${missing.slice(0, 5).map(e => e.word)}`);
  const simplified = /[见说读语门问间们发东车马鸟鱼时书长乐爱写还这进远点战给让对业电头实现设备条务报员钱纸网络习]/;
  const kana = /[ぁ-ゖァ-ヺー]/;
  const bad = Object.values(zh).filter(v => simplified.test(v) || kana.test(v));
  assert.equal(bad.length, 0, `not zh-TW: ${bad.slice(0, 5)}`);
});
```

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: 80 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add data/jlpt/zh-tw.json test.js
git commit -m "feat: zh-TW gloss dataset for all 8101 vocab entries"
```

---

### Task 3: Regenerate data + render back as zh-Hant

**Files:**
- Modify: `src/vocab-data.js` (regenerated, do not hand-edit)
- Modify: `src/vocab.js:35` (back rendering)

**Interfaces:**
- Consumes: `data/jlpt/zh-tw.json` (Task 2), merge logic (Task 1).
- Produces: shipped vocab page whose card backs are zh-TW.

- [ ] **Step 1: Regenerate vocab data**

Run: `npm run gen:vocab`
Expected: `wrote src/vocab-data.js · 8101 entries`
Spot-check: `node -e "import('./src/vocab-data.js').then(m => console.log(m.VOCAB.find(v => v.word === '会う')))"` — `meaning` is Chinese (e.g. 見面、遇見), not `to meet, to see`.

- [ ] **Step 2: Tag the answer as zh-Hant** in `src/vocab.js`

```js
    back: `<span lang="zh-Hant">${escapeHtml(v.meaning)}</span>`,
```

The page is `lang="ja"`; without this, Han-unified codepoints get Japanese glyph forms.

- [ ] **Step 3: Full test run + build**

Run: `npm test 2>&1 | tail -5` — Expected: 80 pass, 0 fail.
Run: `npm run build` — Expected: dist emitted, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/vocab-data.js src/vocab.js
git commit -m "feat: vocab answers in Traditional Chinese (zh-TW)"
```

---

### Finish

Push branch and open a PR to `main` (deploy runs on push to `main`, so
merging stays the user's call).
