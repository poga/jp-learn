# Anki feature brainstorm

Ideas for growing the 五十音 practice page into a fuller spaced-repetition app.
Each line notes rough **value** / **effort** and any synergy with code we
already have.

## Now shipped
- SM-2 scheduler, 3 grades (Again/Good/Easy), keyboard shortcuts
- 平仮名/片仮名 deck toggle, persisted across reloads
- New-card cap per session, localStorage persistence
- **Stats panel + daily streak + retention + new/learning/mature breakdown**
- **Undo last answer** (z / Ctrl+Z), **leech auto-suspend** at 8 lapses with
  unsuspend-all, Anki Hard-step behavior, honest daily-limit done screen

## Reviewing & answering
- **Typed-answer mode** — type the rōmaji instead of self-grading; reuse
  `matchRomaji` from kana.js. value: high, effort: med (great fit)
- **Reverse cards** — reading → glyph (production recall), not just recognition.
  value: high, effort: med
- **Learning steps** — sub-day steps (1m/10m) before a card graduates, like real
  Anki. value: med, effort: med
- **Audio / TTS** — speak the kana on reveal (repo had Web Speech before).
  value: med, effort: low
- **Hint** — reveal first sound / stroke before flipping. value: low, effort: low

## Scheduling & algorithm
- **Configurable limits** — new/day and reviews/day in the UI (now hardcoded 20).
  value: med, effort: low
- **FSRS** — swap SM-2 for the modern Anki default scheduler. value: med,
  effort: high
- **Suspend / bury** — pull a card out of rotation temporarily. value: med,
  effort: low
- **Custom study / cram** — review ahead or drill a chosen group, off-schedule.
  value: med, effort: med

## Decks & organization
- **Group filters** — study just gojūon / dakuten / handakuten / yōon (`group`
  already exists on each entry). value: high, effort: low
- **Tags** on cards. value: low, effort: med
- **Card browser** — list every card with state, search, edit. value: med,
  effort: high

## Stats & motivation (this is where streaks landed)
- **Calendar heatmap** — GitHub-style grid of daily activity from `stats.days`.
  value: high, effort: med
- **Review forecast** — bar chart of cards coming due over the next N days.
  value: med, effort: med
- **Retention trend** — accuracy over time, not just lifetime. value: med,
  effort: med
- **Daily goal + progress ring** — target N reviews/day. value: med, effort: low
- **Streak freeze / grace day** — forgive one missed day. value: low, effort: low

## Data & sync
- **Export / import JSON** — back up and restore progress. value: high,
  effort: low
- **Reset** — wipe a deck or a single card's progress. value: med, effort: low
- **Cross-device sync** — needs a backend. value: med, effort: high

## UX niceties
- **Shortcut help overlay** — surface the 1/2/3 + Space keys. value: low,
  effort: low
- **Session timer / timeboxing** — cap study time. value: low, effort: low
- **Per-card detail** — times seen, lapses, ease, next due. value: low,
  effort: low

## Suggested next picks
1. Typed-answer mode (reuses `matchRomaji`, turns recognition into recall)
2. Group filters (data is already there)
3. Calendar heatmap (the natural follow-up to streaks; `stats.days` is ready)
4. Export / import (protects the progress streaks now make valuable)
5. Reverse cards (production recall, not just recognition)
