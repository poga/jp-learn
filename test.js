const { test } = require('node:test');
const assert = require('node:assert');
const { matchRomaji, KANA, LAYOUT } = require('./kana.js');
const { newCard, schedule, isDue, MIN_EASE } = require('./srs.js');
const { newStats, recordReview, currentStreak, bestStreak,
  retention } = require('./stats.js');

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

test('first success graduates to 1 day (good) or 4 days (easy)', () => {
  assert.equal(schedule(newCard(), 'good', 100).interval, 1);
  assert.equal(schedule(newCard(), 'easy', 100).interval, 4);
  assert.equal(schedule(newCard(), 'good', 100).due, 101);
});

test('review good multiplies interval by ease', () => {
  const card = { ease: 2.5, interval: 10, reps: 2, due: 100, new: false };
  const next = schedule(card, 'good', 100);
  assert.equal(next.interval, 25); // 10 * 2.5
  assert.equal(next.due, 125);
  assert.equal(next.reps, 3);
});

test('easy raises ease and jumps further than good', () => {
  const card = { ease: 2.5, interval: 10, reps: 2, due: 100, new: false };
  const easy = schedule(card, 'easy', 100);
  const good = schedule(card, 'good', 100);
  assert.ok(easy.ease > 2.5);
  assert.ok(easy.interval > good.interval);
});

test('again resets reps and lowers review ease, never below the floor', () => {
  const card = { ease: 2.5, interval: 20, reps: 4, due: 100, new: false };
  const next = schedule(card, 'again', 100);
  assert.equal(next.reps, 0);
  assert.equal(next.interval, 0);
  assert.ok(next.ease < 2.5);
  // repeated lapses clamp at the floor, not below
  let c = card;
  for (let i = 0; i < 20; i++) c = schedule({ ...c, reps: 4 }, 'again', 100);
  assert.equal(c.ease, MIN_EASE);
});

test('again on a never-learned card keeps it due without penalizing ease', () => {
  const next = schedule(newCard(), 'again', 100);
  assert.equal(next.ease, 2.5);
  assert.ok(isDue(next, 100));
});

test('new cards are always due; reviews due only on or after their date', () => {
  assert.equal(isDue(newCard(), 0), true);
  assert.equal(isDue({ new: false, due: 105 }, 100), false);
  assert.equal(isDue({ new: false, due: 100 }, 100), true);
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
