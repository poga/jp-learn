# Vocab Mode — Design

## Goal

Add a JLPT vocabulary trainer alongside the existing kana (五十音) trainer. It
rides the same FSRS engine and flip-and-grade UI, but is a **fully separate
trainer**: its own page, storage, schedule, streak, daily budget, and stats.
Data comes from open-licensed sources (JMdict via the `open-anki-jlpt-decks`
lists, CC BY-SA 4.0).

## Card model

Recognition card with the reading always visible (furigana on both faces), so
the recall task is the **English meaning**.

- **Front:** the word with furigana ruby over its kanji (`会う` shown with `あ`
  above `会`). Reading is given.
- **Flip → back:** the same word + furigana, plus the English meaning.
- Grades (Again/Hard/Good/Easy) and interval previews are identical to kana.

## Architecture: extract a shared trainer core

`anki.js` today mixes the generic SRS shell with kana specifics. Split them so
vocab reuses the shell instead of duplicating ~400 lines.

- **`src/trainer.js`** (new) — `createTrainer(spec)`. Holds all generic logic
  moved verbatim from `anki.js`: flip, grade, interval preview, undo, cram,
  leech suspend/unsuspend, options panel, done screen, streak/stats, keyboard.
- **`spec`** — the per-mode deck definition:

  ```js
  {
    storeKey, statsKey, prefKey, configKey,  // localStorage namespace
    cards,                    // full card array
    cardById,                 // id -> entry
    selectedIds(),            // read deck-bar -> ids to study
    setupDeckBar(onChange),   // wire + persist the checkboxes
    renderFront(el, entry),   // paint the front face
    renderBack(el, entry),    // paint the back face
  }
  ```

- **`src/anki.js`** → thin **kana spec** (script toggles, glyph/romaji render).
- **`src/vocab.js`** (new) → thin **vocab spec** (level toggles, ruby render).

Reused unchanged: `fsrs.js`, `queue.js`, `stats.js`, `config.js`, `day.js`,
`pwa.js`.

## Data pipeline (offline, reproducible)

- Vendor the five CSVs from `jamsinclair/open-anki-jlpt-decks` into
  `data/jlpt/*.csv` (with their license note). Columns:
  `expression, reading, meaning, tags, guid`.
- **`scripts/gen-vocab.js`** (`npm run gen:vocab`) parses them and writes
  **`src/vocab-data.js`** exporting `VOCAB`. The generated file is committed, so
  the normal `npm run build` stays offline and fast; regeneration is explicit.
- Per entry:

  ```js
  {
    id: 'v:' + guid,     // stable across regens -> progress survives updates
    word: expression,    // 会う
    reading,             // あう
    meaning,             // "to meet, to see"
    level: 'N5',         // from source file (n5.csv -> N5)
    furigana: [ { t: '会', r: 'あ' }, { t: 'う', r: '' } ],
  }
  ```

- **Dedupe by `guid`**, keeping the **easiest** level (a word appearing in
  multiple level files stays at the lowest level, e.g. N5 over N4).

### Furigana alignment (build time)

The source gives a whole-word reading, not per-kanji readings. `gen-vocab.js`
computes ruby segments with an okurigana-aware heuristic:

1. Peel matching kana off the **suffix** of expression/reading into a plain
   (no-ruby) segment (handles okurigana: `会う`/`あう` → `う` plain).
2. Peel matching kana off the **prefix** similarly.
3. The remaining kanji core takes the remaining reading as one ruby segment
   (`会` → `あ`).
4. All-kana words (`ああ`, `テレビ`) get no ruby — a single plain segment.
5. Multi-block words with interior kana (e.g. `申し込む`) fall back to
   whole-core ruby. Documented limitation, acceptable for v1.

Runtime render turns segments into native `<ruby><rt>` — no runtime deps.

## Deck bar, page, navigation

- **Deck bar:** five checkboxes `N5 N4 N3 N2 N1`, **N5 checked by default**;
  selection persisted in `vocab-deck-v1`.
- **`src/vocab.html`** — same shell markup as `anki.html`, title 語彙.
- **Navigation:** a small header link on each page to the other
  (`五十音 ⇄ 語彙`). Both are separate static pages sharing the PWA service
  worker.

## Independence

Separate localStorage namespace so vocab has its own everything, zero
interaction with kana progress:

- `vocab-fsrs-v1`, `vocab-stats-v2`, `vocab-deck-v1`, `vocab-config-v1`.

## Scope

All JLPT levels **N5–N1** (~8,000 words) ship in v1, selectable by level
checkbox. Bundled into the vocab page (≈100 KB gzipped, cached once by the PWA).

## Attribution (CC BY-SA)

Small credits line in each trainer footer + a `CREDITS`/`NOTICE` file crediting
JMdict/EDRDG and `open-anki-jlpt-decks` (Tanos JLPT lists), CC BY-SA 4.0.

## Testing (NO MOCKS, real data)

- **`gen-vocab`** over the real vendored CSVs: assert dedupe-by-guid, easiest-
  level assignment, well-formed `{id, word, reading, meaning, level, furigana}`,
  namespaced/stable `id`, and furigana alignment on representative cases
  (`会う` → 会=あ + う plain; `水` → 水=みず; `ああ` → no ruby; a 2-kanji block
  → single ruby).
- **Trainer core seam:** a spec-driven test proving `selectedIds()` filters
  exactly what the pure queue receives — the one genuinely new integration
  boundary between deck spec and engine.
- No re-testing of `fsrs`/`queue`/`stats`/`config` (unchanged). The kana page is
  verified still working by driving it after the refactor (verify skill).

## Out of scope (YAGNI — later if wanted)

Audio, example sentences, EN→JP production cards, per-level lazy loading,
kanji-writing practice, cross-referencing kana progress.
