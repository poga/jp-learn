# 五十音 Learning Page — Design

## Goal

A single-page website to learn 五十音 (gojūon). Shows every kana in the
correct traditional layout, with a filter box: type rōmaji to highlight the
matching kana.

## Scope

- Both scripts shown together: full hiragana table, then full katakana table.
- Sound coverage: base 46 gojūon + dakuten/handakuten + yōon combos.
- Cells show kana only (no rōmaji printed). Rōmaji is used only for matching.
- No build step, no server. Opens directly via `file://`.

## Files

- `index.html` — page structure, loads the scripts and stylesheet.
- `style.css` — grid layout + highlight/dim styles. Clean, centered, minimal.
- `kana.js` — kana data + the pure `matchRomaji` function. No DOM. Works as a
  browser global and as a node `module.exports` (so `file://` and tests both
  work).
- `script.js` — renders grids from the data, wires the filter box.
- `test.js` — node tests for the matching logic.

## Layout

Two stacked grids (hiragana, then katakana). Each grid has three sections in
the standard 五十音 layout:

1. **Gojūon** — 5-column grid (a/i/u/e/o columns). Rows: vowels, then
   k·s·t·n·h·m·y·r·w, plus ん. Gaps where sounds don't exist (や/ゆ/よ,
   わ/を).
2. **Dakuten / Handakuten** — g·z·d·b·p rows, 5 columns.
3. **Yōon** — 3-column combos (ya/yu/yo): kya … sha … cha … ja … pya.

## Data model

`kana.js` exports an array of entries:

```
{ hira, kata, romaji, aliases, group }
```

- `group` is one of `gojuon` | `dakuten` | `yoon` and drives which section the
  entry renders into.
- `romaji` is the primary Hepburn reading. `aliases` holds accepted alternates.

## Matching logic — `matchRomaji(query, entry)`

- Case-insensitive prefix match against `entry.romaji` and each `entry.aliases`.
- `k` → whole k-line (か き く け こ + きゃ…). `ku` → く/ク. `sh` → し +
  しゃ/しゅ/しょ.
- Alternates accepted: `si`=`shi`, `ti`=`chi`, `tu`=`tsu`, `hu`=`fu`,
  `zi`=`ji`. Hepburn is primary.
- Empty/whitespace query → matches nothing (UI shows everything normal).

## Filter behavior (UI)

- One filter box at the top. On every keystroke, re-run `matchRomaji` over all
  entries and toggle classes.
- Matched cells: colored highlight + slight scale-up. Non-matched: dimmed.
- Matches highlight in both grids simultaneously.
- Empty box → all cells normal (no highlight, no dim).

## Data flow

1. `index.html` loads `kana.js` then `script.js`.
2. `script.js` builds the DOM grids from the `kana.js` data on load.
3. On input, `script.js` calls `matchRomaji` per entry and sets
   `is-match` / `is-dim` classes.

## Testing

`node test.js` using node's built-in test runner — no deps, no mocks. Verifies
the non-obvious logic only:

- Prefix match returns multiple (`k`) and exact (`ku`).
- Alias resolution (`si` → し).
- Empty query matches nothing.
- Non-existent reading matches nothing.

Does NOT assert kana data contents (designer-owned values).

## Aesthetic

Clean, centered, max-width container, generous spacing, large readable kana.
Minimal chrome.
