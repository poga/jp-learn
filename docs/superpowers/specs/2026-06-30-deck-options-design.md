# Deck Options Settings Panel (Phase 2) — Design

## Goal

Phase 1 reads a `config` object live (limits, learning steps, target retention, 4am
rollover) but ships it as hardcoded `DEFAULT_CONFIG` constants. Phase 2 lets the user
edit those options from the page and persists them, so the kana deck behaves like a
real Anki deck whose options you can tune — without touching code.

Second of the trimmed 1–3 roadmap (queue → **deck options** → custom study).

## Decisions (locked during brainstorm)

- **Six exposed fields**: new cards/day, max reviews/day, learning steps, relearning
  steps, target retention (%), day rollover hour. Plus a **Reset to defaults** action.
- **Inline collapsible section** (not a modal): a native `<details>`/`<summary>`
  "⚙ options" disclosure on the page near the deck bar. Expanding pushes the card
  down; no overlay, no focus trap.
- **Steps as space-separated minutes** (Anki style): `1 10` ⇄ `[1, 10]`.
- **Clamp on save, don't reject mid-type**: invalid/out-of-range input is normalized
  to the nearest valid value (or the default) when saved, never blocked while typing.
- **Live application**: config is already read live by Phase 1, so a save rebuilds
  the session and the new limits/steps/retention take effect on the next card. No
  card migration. Changing the rollover hour shifts the day boundary going forward
  (Anki does the same).
- **config.js stays pure**: parsing/normalization live there (node-tested); the
  localStorage load/save and the DOM panel are thin glue in `anki.js`/`anki.html`.

## Architecture

- **`config.js`** *(pure, extended)* — keeps `DEFAULT_CONFIG`; adds:
  - `parseSteps(str) -> number[]` — whitespace-split, `Number`-map, keep positive
    finite values; `[]` when none parse.
  - `formatSteps(arr) -> string` — join with single spaces.
  - `normalizeConfig(raw) -> config` — merge `raw` over `DEFAULT_CONFIG` and clamp
    every exposed field to a valid value (see Validation). Unknown/absent fields fall
    back to the default. The carried-through `learnAheadMins` keeps its default (not
    exposed). This is the tested core. No DOM, no localStorage.
- **`anki.js`** *(glue)* — `CONFIG_KEY = 'anki-config-v1'`; on load,
  `CONFIG = normalizeConfig(JSON.parse(localStorage[CONFIG_KEY]) || {})` (replacing
  the `const CONFIG = DEFAULT_CONFIG`); `saveConfig()` reads the panel inputs, builds
  a raw object (`parseSteps` on the step fields, `retention/100`), `normalizeConfig`s
  it, persists, reassigns `CONFIG`, refreshes the inputs to the normalized values,
  and `startSession()` to apply. `resetConfig()` writes `DEFAULT_CONFIG` to the inputs
  and saves. Since `CONFIG` is now reassigned, it becomes `let`.
- **`anki.html`** *(markup)* — the `<details class="options">` block with labelled
  inputs (`number` for limits/retention/rollover, `text` for the two step fields), a
  Save button and a Reset button. IDs: `opt-new`, `opt-rev`, `opt-learn`,
  `opt-relearn`, `opt-retention`, `opt-rollover`, `opt-save`, `opt-reset`.
- **`style.css`** *(styling)* — the disclosure and a simple labelled-input grid,
  following the existing deck-bar/reset-button styling.

## Validation (`normalizeConfig`)

Each field clamped to a sane range; the value the user sees after save is the value
that will be used:

- `newPerDay`, `reviewsPerDay` — integer, clamp to `[0, 9999]`.
- `learnSteps`, `relearnSteps` — `parseSteps`; if empty, fall back to the default
  list (a deck must have at least one learning step).
- `desiredRetention` — number, clamp to `[0.80, 0.97]` (Anki's supported FSRS band).
- `rolloverHour` — integer, clamp to `[0, 23]`.
- `learnAheadMins` — not exposed; kept from the default.

Non-numeric input coerces via `Number`; `NaN` → the field's default.

## Data flow

```
load:  localStorage[anki-config-v1] ─JSON.parse─▶ raw ─normalizeConfig─▶ CONFIG ─▶ fill panel inputs
edit:  panel inputs ─read+parseSteps─▶ raw ─normalizeConfig─▶ CONFIG ─saveConfig─▶ localStorage ; startSession()
reset: DEFAULT_CONFIG ─▶ panel inputs ─▶ (same save path)
```

## Testing strategy (no mocks, real behavior)

Pure `config.js` functions, driven directly in `test.js`:

- **Steps round-trip**: `parseSteps('1 10')` → `[1,10]`; `formatSteps([1,10])` →
  `'1 10'`; `parseSteps('  ')` / `parseSteps('x')` → `[]`.
- **Normalize clamps each field**: retention `1.5`→`0.97`, `0.1`→`0.80`; `newPerDay`
  `-5`→`0` and a float→integer; `rolloverHour` `30`→`23`; empty `learnSteps`→default;
  garbage step string → default list.
- **Merge boundary**: `normalizeConfig({ newPerDay: 30 })` keeps `30` and fills every
  other field from `DEFAULT_CONFIG` (the partial-saved-blob upgrade path).

The `<details>` panel and its wiring are DOM glue — verified manually in the browser
(open options, change new/day + a step, save, confirm the header/limit and a card's
learning step reflect it; Reset restores defaults). Build tests stay green.

## Migration

Non-destructive and additive: a new `anki-config-v1` key. Absent on first run →
`normalizeConfig({})` returns `DEFAULT_CONFIG`. A partial or stale blob is merged over
defaults and clamped, so no shape mismatch can break loading. Existing card/stats
keys are untouched.

## Out of scope (Phase 2)

- Custom Study / cram (Phase 3).
- Per-deck option *groups*, FSRS parameter optimization, learn-ahead minutes in the
  UI, multiple decks/notes/import.

## Roadmap (locked 1–3)

1. Queue foundation — **done, merged**.
2. **This spec** — deck options.
3. Custom Study / cram — practice beyond limits via a temporary filtered queue that
   doesn't disturb the FSRS schedule; "study forgotten" reads `stats.log`.
