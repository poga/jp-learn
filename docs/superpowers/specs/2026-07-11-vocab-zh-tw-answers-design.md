# Vocab trainer: Traditional Chinese (zh-TW) answers

## Goal

The vocab trainer's card backs (answers) show Traditional Chinese glosses
instead of the current English `meaning` strings.

## Context

- Vocab data is vendored JLPT CSVs (`data/jlpt/n5.csv` … `n1.csv`,
  CC BY-SA 4.0) with an English `meaning` column; 8,101 unique entries
  after guid dedupe.
- `scripts/gen-vocab.js` compiles them into `src/vocab-data.js`
  (generated, committed).
- `src/vocab.js` renders the back as `escapeHtml(v.meaning)`; pages are
  `lang="ja"`.

No Chinese exists in any source, so the work is (1) producing a zh-TW
gloss dataset, (2) wiring it into generation and rendering.

## Decision: model-generated gloss file

Translate each entry from `word + reading + English gloss` — the English
gloss anchors the sense, guarding against Japanese/Chinese false friends
(手紙, 勉強, 汽車, 新聞…). Alternatives rejected: external datasets
(unverified existence/coverage/license, fuzzy matching on expressions
like `〜 (まる) ごと`) and a runtime EN/zh toggle (not asked for).

## Components

### 1. `data/jlpt/zh-tw.json` (new, committed)

`{ "<guid>": "繁中釋義", … }` covering every vocab guid. Produced once by
parallel translator batches (~250 entries each). Gloss style:

- Traditional characters only, Taiwan usage (計程車 not 出租車,
  馬鈴薯 not 土豆).
- Concise senses separated by 、 mirroring the English senses.
- No pinyin, no Japanese, no trailing punctuation.

### 2. `scripts/gen-vocab.js`

Load `zh-tw.json`; emitted `meaning` becomes the zh-TW gloss, falling
back to the English CSV meaning when a guid is missing. Entry shape
unchanged. Regenerate `src/vocab-data.js`.

### 3. `src/vocab.js`

Wrap the back in `<span lang="zh-Hant">…</span>`. Pages are `lang="ja"`;
without the override, Han-unified codepoints render with Japanese glyph
forms, which reads wrong to a zh-TW reader.

## Testing (real data, no mocks)

- Merge contract: gloss chosen by guid, English fallback when missing.
- Coverage invariant: every guid in generated vocab has a zh-tw.json
  entry (over the real CSVs + real JSON).
- Traditional-only sanity: no common simplified-only codepoints
  (见/说/门/发/…) in zh-tw.json values.
- Existing build test (vocab page bundles data) keeps passing.

## Out of scope

UI chrome language, other decks (kana, sentence anki), runtime language
toggle.
