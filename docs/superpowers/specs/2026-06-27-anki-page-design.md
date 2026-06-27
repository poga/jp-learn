# 五十音 Anki Page — Design

## Goal

A spaced-repetition practice page for 五十音, complementing the existing
reference table. Shows one card at a time, you self-grade your recall, and an
SM-2 scheduler decides when each card comes back. Progress persists across
visits.

## Scope

- New page `anki.html`, reusing the shared `kana.js` data.
- Card UX: show a kana, flip to reveal its rōmaji, then grade Again/Good/Easy.
- Grade buttons appear only after the card is flipped.
- True SM-2 scheduling with day-based intervals, persisted to `localStorage`.
- Deck selector: a 平仮名 / 片仮名 script toggle, both on by default. All rows
  (gojūon, dakuten, yōon) are always included.
- No build step, no server. Opens directly via `file://`.

## Files

- `srs.js` — pure SM-2 scheduler. No DOM, no localStorage. Browser global +
  node `module.exports`, mirroring `kana.js`. This is the testable core.
- `anki.html` — page structure; loads `kana.js`, `srs.js`, `anki.js`.
- `anki.js` — page glue: localStorage I/O, session queue, DOM, keyboard.
  Browser-only; the impure shell around the pure scheduler.
- `style.css` — shared stylesheet; an appended section styles the anki page.
- `test.js` — extended with SM-2 invariant tests.

## Card identity

A card is a (kana entry, script) pair, since あ and ア are learned separately.
Card id = `${entry.id}:${script}` (e.g. `a:hira`, `a:kata`).

## Scheduler — `srs.js`

State per card: `{ ease, interval, reps, due, new }`. `interval`/`due` are in
whole days; `due` is a day-number (`floor(epochMs / 86_400_000)`).

- `newCard()` → fresh state: ease 2.5, interval 0, reps 0, new true.
- `schedule(card, grade, today)` → new state. `grade` ∈ `again|good|easy`.
  - **again**: reps→0, interval→0 (relearn same session); ease −0.2 only if it
    was already a review card. Clamp ease ≥ 1.3.
  - **first success** (reps 0): interval → 1 (good) or 4 (easy); reps→1.
  - **review** (reps ≥ 1): interval → round(interval × ease), or
    × ease × 1.3 for easy; reps+1.
  - **easy** adds +0.15 ease. `due = today + interval`.
- `isDue(card, today)` → `card.new || card.due <= today`.

Constants: DEFAULT_EASE 2.5, MIN_EASE 1.3, EASY_BONUS 1.3.

## Session (anki.js)

1. Build card list: every kana × each ticked script.
2. Load saved states from localStorage; unseen cards get `newCard()`.
3. Queue = all due review cards + up to NEW_PER_SESSION (20) new cards,
   shuffled.
4. Flip to reveal; grade. Save new state. `again` re-queues the card to the
   back of this session; other grades schedule it for a future day.
5. Empty queue → done screen with reviewed count.

## Persistence

`localStorage['anki-srs-v1']` = `{ version, cards: { [id]: state } }`. Reads
and writes live in `anki.js` so `srs.js` stays pure and node-testable.

## Testing

`node test.js`. SM-2 invariants only (non-obvious logic), no mocks:

- new + good → interval 1; new + easy → interval 4.
- review good grows interval by ease (e.g. 10 × 2.5 → 25).
- again resets reps to 0 and lowers review ease, never below 1.3.
- easy raises ease; due = today + interval.

Does NOT assert deck contents or designer-tunable constants.

## Aesthetic

Reuses the warm minimal palette and dark-mode variables from `style.css`.
Large centered card, calm grade buttons, small stats line. Nav links join the
table and practice pages.
