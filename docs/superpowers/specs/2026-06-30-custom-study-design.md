# Custom Study / Cram (Phase 3) — Design

## Goal

Answer the original frustration — "why only one round per day?" — the Anki-faithful
way: when you finish the day's scheduled cards, offer **Custom Study** so you can keep
going without breaking spaced repetition. Third and final phase of the 1–3 roadmap.

## Decisions (locked during brainstorm)

- **Two modes** (no review-ahead / study-forgotten — they overlap with cram on a
  208-card deck):
  - **Study more new** — introduce more new kana past today's cap. *Reschedules
    normally*: these are real new cards graded through the normal FSRS path; they
    count toward today's new total.
  - **Cram / free practice** — drill the whole selected deck, unlimited. *No schedule
    change*: grades do NOT call `fsrs.schedule`, `recordReview`, `recordNew`, or
    `recordLog`. Pure drilling.
- **Surfaced on the done screen** — the buttons appear when you finish (next to
  "study again"), which is where you hit the wall. Not a persistent panel.
- **Cram drills until you pass each card**: in cram, **Again re-queues** the card to
  the back (drill it again); **Hard/Good/Easy** drop it. Cram ends when the queue
  empties. Interval previews are hidden in cram (they're meaningless without
  rescheduling).
- **Custom study is in-memory / per-session**: a page reload returns to the normal
  schedule. "Study more new" raises the session's effective new limit; it does not
  persist a config change.

## Architecture

- **`queue.js`** *(pure, extended)* — add one tested reducer:
  - `cramAdvance(queue, grade) -> string[]` — drop the front card, or move it to the
    back on `'again'`. `cramAdvance(['a','b','c'], 'good') -> ['b','c']`;
    `cramAdvance(['a','b','c'], 'again') -> ['b','c','a']`. The cram drill loop is
    this reducer applied to a shuffled id list; cram is done when it returns `[]`.
  - "Study more new" needs **no** new queue code — it is `pickNext`/`counts` driven
    with `config.newPerDay` raised (see glue). A queue test locks this contract.
- **`anki.js`** *(glue)* — a small mode layer over the existing session:
  - `let mode = 'normal'` (`'normal' | 'cram'`); `let extraNew = 0`; `let cramQueue = []`.
  - `sessionConfig()` returns `{ ...CONFIG, newPerDay: CONFIG.newPerDay + extraNew }`.
    The `pickNext`/`queueCounts` calls use `sessionConfig()` so the raised new limit
    takes effect; `fsrs.schedule` keeps using `CONFIG` (the bump only affects gating,
    not scheduling math).
  - **Study more new**: `studyMoreNew()` → `extraNew += STUDY_MORE_N` (10) → resume
    the normal session (`next()`), which now serves more new cards.
  - **Cram**: `startCram()` → `mode='cram'`, `cramQueue = shuffle(deckCards())`,
    show the first; `next()`/`render` read `cramQueue[0]` in cram. `grade(g)` branches:
    in cram it calls `cramAdvance`, updates `cramQueue`, and shows the next or the
    cram-done screen — never touching store/stats. `flip()` in cram reveals the
    reading and shows the grade buttons with blank interval labels.
  - **Exit cram**: `mode='normal'`, rebuild the normal session.
  - The done screen gains the buttons; cram has its own done screen ("cram complete —
    N drilled", with "cram again" and "back").

## Done-screen buttons

- **study again** (existing) — rebuild the normal session.
- **study 10 more new** — shown only when the deck still has un-introduced new cards
  (`deckBreakdown().fresh > 0`).
- **cram (free practice)** — shown whenever the deck is non-empty.

Cram-done screen: **cram again** (reshuffle) and **back** (to the normal done screen).

## Data flow

```
study more new:  click → extraNew += 10 → next() with sessionConfig (newPerDay+10) → normal grade path (reschedules, recordNew counts)
cram:            click → mode=cram, cramQueue=shuffle(deck) → show cramQueue[0]
cram grade:      flip → grade(g) → cramQueue = cramAdvance(cramQueue, g) → next card or cram-done   (NO schedule/stats writes)
exit cram:       mode=normal → startSession()
```

## Testing strategy (no mocks, real behavior)

- **`cramAdvance` (pure, queue.js)**: `'good'`/`'hard'`/`'easy'` drop the front;
  `'again'` moves the front to the back; applying it down to `[]` drains the queue and
  an Again'd card reappears after the others (drill-until-pass invariant).
- **Study-more-new contract (pure, queue.js)**: with `newOn(today)` at the base
  `newPerDay` (cap spent) and a fresh new card present, `pickNext` returns `done`;
  raising `config.newPerDay` by 10 makes the same `pickNext` return that new card.
  This is the exact mechanism `studyMoreNew()` relies on.

Cram's no-write grade path and the done-screen buttons are DOM glue — verified in the
browser: enter cram, grade several cards (Again re-queues, Good advances), confirm the
card store and stats are byte-for-byte unchanged after cramming; "study 10 more new"
serves new cards past the cap and those DO update the store.

## Out of scope (Phase 3)

- Review-ahead and study-forgotten modes; persistent custom-study config; filtered-deck
  tags/search; multiple decks/notes/import.

## Roadmap (1–3 complete after this)

1. Queue foundation — **done, merged**.
2. Deck options — **done, merged**.
3. **This spec** — Custom Study / cram.
