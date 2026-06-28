const { test } = require('node:test');
const assert = require('node:assert');
const { matchRomaji, KANA, LAYOUT } = require('./kana.js');
const { newStats, recordReview, currentStreak, bestStreak,
  retention } = require('./stats.js');
const fsrs = require('./fsrs.js');

test('prefix match returns true for multiple on a single letter', () => {
  assert.equal(matchRomaji('k', { romaji: 'ka', aliases: [] }), true);
  assert.equal(matchRomaji('k', { romaji: 'kya', aliases: [] }), true);
  assert.equal(matchRomaji('k', { romaji: 'sa', aliases: [] }), false);
});

test('exact reading matches only that reading', () => {
  assert.equal(matchRomaji('ku', { romaji: 'ku', aliases: [] }), true);
  assert.equal(matchRomaji('ku', { romaji: 'ka', aliases: [] }), false);
});

test('alias resolves', () => {
  assert.equal(matchRomaji('si', { romaji: 'shi', aliases: ['si'] }), true);
});

test('case-insensitive', () => {
  assert.equal(matchRomaji('KA', { romaji: 'ka', aliases: [] }), true);
});

test('empty or whitespace query matches nothing', () => {
  assert.equal(matchRomaji('', { romaji: 'ka', aliases: [] }), false);
  assert.equal(matchRomaji('   ', { romaji: 'ka', aliases: [] }), false);
});

test('unknown reading matches nothing', () => {
  assert.equal(matchRomaji('xyz', { romaji: 'ka', aliases: ['ky'] }), false);
  assert.equal(matchRomaji('q', { romaji: 'shi', aliases: ['si'] }), false);
});

test('data is wired and ids are unique', () => {
  assert.ok(KANA.length > 100);
  const ids = KANA.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  const layoutIds = [...LAYOUT.gojuon, ...LAYOUT.dakuten, ...LAYOUT.yoon,
    ...LAYOUT.yoonVoiced].flat().filter(Boolean);
  const known = new Set(ids);
  for (const id of layoutIds) assert.ok(known.has(id), `unknown id ${id}`);
});

test('reviews bucket per day and split out lapses', () => {
  const s = newStats();
  recordReview(s, 'good', 4);
  recordReview(s, 'again', 4);
  recordReview(s, 'good', 5);
  assert.equal(s.days[4].n, 2);
  assert.equal(s.days[4].again, 1);
  assert.equal(s.days[5].n, 1);
  assert.equal(s.reviews, 3);
});

test('streak counts consecutive studied days up to today', () => {
  const s = newStats();
  for (const d of [8, 9, 10]) recordReview(s, 'good', d);
  assert.equal(currentStreak(s, 10), 3);
});

test('an untouched today keeps yesterday\'s streak alive', () => {
  const s = newStats();
  recordReview(s, 'good', 9);
  recordReview(s, 'good', 10);
  assert.equal(currentStreak(s, 11), 2);
});

test('a missed day breaks the current streak', () => {
  const s = newStats();
  recordReview(s, 'good', 5);
  recordReview(s, 'good', 6); // gap on 7, nothing today
  assert.equal(currentStreak(s, 8), 0);
});

test('best streak is the longest run ever, across gaps', () => {
  const s = newStats();
  for (const d of [1, 2, 3]) recordReview(s, 'good', d);
  for (const d of [10, 11]) recordReview(s, 'good', d);
  assert.equal(bestStreak(s), 3);
});

test('retention is the share of non-again reviews, null when empty', () => {
  const s = newStats();
  assert.equal(retention(s), null);
  recordReview(s, 'good', 1);
  recordReview(s, 'good', 1);
  recordReview(s, 'again', 1);
  assert.ok(Math.abs(retention(s) - 2 / 3) < 1e-9);
});

test('fsrs: retrievability is 0.9 at t = S and decays', () => {
  for (const S of [1, 10, 100]) {
    assert.ok(Math.abs(fsrs.retrievability(S, S) - 0.9) < 1e-6);
  }
  assert.ok(fsrs.retrievability(10, 1) > fsrs.retrievability(10, 30));
});

test('fsrs: nextInterval equals stability at 0.9 retention', () => {
  assert.equal(fsrs.nextInterval(10), 10);
  assert.equal(fsrs.nextInterval(1), 1);
  assert.ok(fsrs.nextInterval(0.0001) >= 1); // clamped to >= 1 day
});

test('fsrs: a new card starts unseen', () => {
  const c = fsrs.newCard();
  assert.equal(c.state, 'new');
  assert.equal(c.reps, 0);
});

test('fsrs: initial stability rises with a better first grade', () => {
  const s = [1, 2, 3, 4].map(g => fsrs.initStability(g));
  assert.ok(s[0] < s[1] && s[1] < s[2] && s[2] < s[3]);
});

test('fsrs: initial difficulty is highest for Again, all within [1,10]', () => {
  const d = [1, 2, 3, 4].map(g => fsrs.initDifficulty(g));
  assert.ok(d[0] > d[3]);
  for (const x of d) assert.ok(x >= 1 && x <= 10);
});

test('fsrs: Again raises difficulty, Easy lowers it, stays in [1,10]', () => {
  assert.ok(fsrs.nextDifficulty(5, 1) > 5);
  assert.ok(fsrs.nextDifficulty(5, 4) < 5);
  assert.ok(fsrs.nextDifficulty(9.9, 1) <= 10);
  assert.ok(fsrs.nextDifficulty(1.1, 4) >= 1);
});

test('fsrs: success grows stability, more for Easy than Good than Hard', () => {
  const hard = fsrs.successStability(10, 5, 0.9, 2);
  const good = fsrs.successStability(10, 5, 0.9, 3);
  const easy = fsrs.successStability(10, 5, 0.9, 4);
  assert.ok(hard > 10 && hard < good && good < easy);
});

test('fsrs: a lapse never increases stability', () => {
  assert.ok(fsrs.lapseStability(10, 5, 0.9) < 10);
  assert.ok(fsrs.lapseStability(2, 8, 0.5) <= 2);
});

test('fsrs: a same-day success does not shrink stability', () => {
  assert.ok(fsrs.sameDayStability(2, 3) >= 2);
  assert.ok(fsrs.sameDayStability(2, 4) >= 2);
});

test('fsrs: no fuzz below 2.5 days; band widens with interval', () => {
  const small = fsrs.fuzzRange(2);
  assert.equal(small.min, 2);
  assert.equal(small.max, 2);
  const w10 = fsrs.fuzzRange(10), w100 = fsrs.fuzzRange(100);
  assert.ok(w10.min < 10 && w10.max > 10);
  assert.ok((w100.max - w100.min) > (w10.max - w10.min));
});

test('fsrs: applyFuzz stays inside the band', () => {
  const { min, max } = fsrs.fuzzRange(100);
  assert.equal(fsrs.applyFuzz(100, () => 0), min);
  assert.equal(fsrs.applyFuzz(100, () => 0.999999), max);
});

const T = 1_700_000_000_000;

test('fsrs: a new card enters learning; Good advances, Again resets', () => {
  const good = fsrs.schedule(fsrs.newCard(), 'good', T);
  assert.equal(good.state, 'learning');
  assert.equal(good.due - T, fsrs.LEARN_STEPS[1]); // second step (10m)
  const again = fsrs.schedule(fsrs.newCard(), 'again', T);
  assert.equal(again.due - T, fsrs.LEARN_STEPS[0]); // first step (1m)
});

test('fsrs: Good past the last learning step graduates to a day interval', () => {
  const learning = fsrs.schedule(fsrs.newCard(), 'good', T); // at step 1
  const grad = fsrs.schedule(learning, 'good', T + fsrs.LEARN_STEPS[1]);
  assert.equal(grad.state, 'review');
  assert.ok(grad.due - (T + fsrs.LEARN_STEPS[1]) >= fsrs.DAY_MS);
});

test('fsrs: Easy graduates a new card immediately', () => {
  const easy = fsrs.schedule(fsrs.newCard(), 'easy', T);
  assert.equal(easy.state, 'review');
  assert.ok(easy.due - T >= fsrs.DAY_MS);
});

test('fsrs: Again on a review card lapses into relearning', () => {
  const card = { state: 'review', stability: 20, difficulty: 5,
    due: T, last_review: T - 20 * fsrs.DAY_MS, reps: 3, lapses: 0, step: 0 };
  const lapsed = fsrs.schedule(card, 'again', T);
  assert.equal(lapsed.state, 'relearning');
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due - T, fsrs.RELEARN_STEPS[0]);
});

test('fsrs: preview intervals are strictly increasing (no Good/Easy tie)', () => {
  const card = { state: 'review', stability: 1, difficulty: 5,
    due: T, last_review: T - fsrs.DAY_MS, reps: 2, lapses: 0, step: 0 };
  const p = fsrs.previewIntervals(card, T);
  assert.ok(p.again < p.hard && p.hard < p.good && p.good < p.easy);
});

test('browser scripts share one global scope without redeclaration', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const src = ['kana.js', 'fsrs.js', 'stats.js', 'anki.js']
    .map(f => fs.readFileSync(`${__dirname}/${f}`, 'utf8')).join('\n;\n');
  assert.doesNotThrow(() => new vm.Script(src));
});
