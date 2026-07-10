import { test, before } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import { matchRomaji, KANA, LAYOUT } from './src/kana.js';
import { newStats, recordReview, recordNew, newOn, reviewsOn, currentStreak,
  bestStreak, retention, revDoneOn, recordLog, unrecordReview, unrecordNew,
  unrecordLog } from './src/stats.js';
import * as fsrs from './src/fsrs.js';
import { dayOf, dayStart } from './src/day.js';
import { build } from './build.js';

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

test('new-card introductions bucket per day so the cap resets at midnight', () => {
  const s = newStats();
  recordNew(s, 4);
  recordNew(s, 4);
  recordNew(s, 5);
  assert.equal(newOn(s, 4), 2);
  assert.equal(newOn(s, 5), 1);
  assert.equal(newOn(s, 6), 0); // a fresh day starts at zero
});

test('new-card and review counts share a day bucket without clobbering', () => {
  const s = newStats();
  recordReview(s, 'good', 4);
  recordNew(s, 4); // a new card's first grade records both
  assert.equal(reviewsOn(s, 4), 1);
  assert.equal(newOn(s, 4), 1);
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

test('stats: only review-state grades count toward the review limit', () => {
  const s = newStats();
  recordReview(s, 'good', 7, true);   // a review card
  recordReview(s, 'good', 7, false);  // a new/learning card
  recordReview(s, 'again', 7, true);  // a review card that lapsed
  assert.equal(revDoneOn(s, 7), 2);
  assert.equal(reviewsOn(s, 7), 3);   // total studied that day is still 3
  assert.equal(revDoneOn(s, 99), 0);
});

test('stats: the review log appends and keeps only the most recent cap', () => {
  const s = newStats();
  recordLog(s, { id: 'a:hira', t: 1, grade: 'good', state: 'new' });
  recordLog(s, { id: 'a:hira', t: 2, grade: 'again', state: 'review' });
  assert.equal(s.log.length, 2);
  assert.equal(s.log[1].grade, 'again');
  for (let i = 0; i < 10; i++) recordLog(s, { id: 'x', t: i, grade: 'good', state: 'new' }, 5);
  assert.equal(s.log.length, 5);
  assert.equal(s.log[0].t, 5);        // oldest trimmed, newest kept
});

test('stats: recordLog works on a migrated stats object missing the log field', () => {
  const migrated = Object.assign(newStats(), JSON.parse('{"reviews":3,"again":1,"days":{}}'));
  recordLog(migrated, { id: 'a:hira', t: 1, grade: 'good', state: 'new' });
  assert.equal(migrated.log.length, 1);
});

test('stats: unrecord* reverses record* as seen by every reader', () => {
  const s = newStats();
  recordReview(s, 'good', 10, true);
  recordNew(s, 10);
  recordReview(s, 'again', 10, false);
  recordLog(s, { id: 'x', t: 1, grade: 'again', state: 'new' });
  unrecordLog(s);
  unrecordReview(s, 'again', 10, false);
  unrecordNew(s, 10);
  assert.equal(s.reviews, 1);
  assert.equal(s.again, 0);
  assert.equal(reviewsOn(s, 10), 1);
  assert.equal(revDoneOn(s, 10), 1);
  assert.equal(newOn(s, 10), 0);
  assert.equal(s.log.length, 0);
  assert.equal(retention(s), 1);      // the lapse vanished from retention
});

test('stats: unrecord floors at zero on empty stats', () => {
  const s = newStats();
  unrecordReview(s, 'again', 5, true);
  unrecordNew(s, 5);
  unrecordLog(s);
  assert.equal(s.reviews, 0);
  assert.equal(s.again, 0);
  assert.equal(reviewsOn(s, 5), 0);
  recordReview(s, 'good', 6, false);   // creates the day-6 bucket, no new
  unrecordNew(s, 6);
  unrecordNew(s, 6);
  assert.equal(newOn(s, 6), 0);        // clamped, never negative
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

test('fsrs: isLeech trips at the threshold and every half-threshold after', () => {
  assert.equal(fsrs.isLeech(7), false);
  assert.equal(fsrs.isLeech(8), true);
  assert.equal(fsrs.isLeech(9), false);
  assert.equal(fsrs.isLeech(12), true);
  assert.equal(fsrs.isLeech(16), true);
  assert.equal(fsrs.isLeech(3, 4), false);
  assert.equal(fsrs.isLeech(4, 4), true);
  assert.equal(fsrs.isLeech(6, 4), true);
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

const MIN = 60000;

test('fsrs: a new card takes two Goods to graduate; Again resets to step 0', () => {
  const g1 = fsrs.schedule(fsrs.newCard(), 'good', T);
  assert.equal(g1.state, 'learning');
  assert.equal(g1.due - T, 10 * MIN);            // advanced to the 10m step, not graduated
  const g2 = fsrs.schedule(g1, 'good', T + 10 * MIN);
  assert.equal(g2.state, 'review');              // second Good graduates
  assert.ok(dayOf(g2.due, 4) > dayOf(T, 4));
  const again = fsrs.schedule(fsrs.newCard(), 'again', T);
  assert.equal(again.state, 'learning');
  assert.equal(again.due - T, 1 * MIN);          // back to the first step (1m)
});

test('fsrs: Good through both learning steps graduates to a later study-day', () => {
  const s0 = fsrs.schedule(fsrs.newCard(), 'again', T);     // learning, step 0
  const s1 = fsrs.schedule(s0, 'good', T + 1 * MIN);        // -> 10m step
  assert.equal(s1.state, 'learning');
  const grad = fsrs.schedule(s1, 'good', T + 11 * MIN);     // graduates
  assert.equal(grad.state, 'review');
  assert.ok(dayOf(grad.due, 4) > dayOf(T, 4));
});

test('fsrs: Easy graduates a new card immediately to a later study-day', () => {
  const easy = fsrs.schedule(fsrs.newCard(), 'easy', T);
  assert.equal(easy.state, 'review');
  assert.ok(dayOf(easy.due, 4) > dayOf(T, 4));
});

test('fsrs: Again on a review card lapses into relearning at the 10m step', () => {
  const card = { state: 'review', stability: 20, difficulty: 5,
    due: T, last_review: T - 20 * fsrs.DAY_MS, reps: 3, lapses: 0, step: 0 };
  const lapsed = fsrs.schedule(card, 'again', T);
  assert.equal(lapsed.state, 'relearning');
  assert.equal(lapsed.due - T, 10 * MIN);
});

test('fsrs: Hard repeats the current learning step; lone step is x1.5', () => {
  const cfg3 = { newPerDay: 20, reviewsPerDay: 200, learnSteps: [1, 10, 60],
    relearnSteps: [10], desiredRetention: 0.9, rolloverHour: 4, learnAheadMins: 20 };
  const mid = { state: 'learning', stability: 1, difficulty: 5,
    due: T, last_review: T - MIN, reps: 0, lapses: 0, step: 1 };
  const h = fsrs.schedule(mid, 'hard', T, cfg3);
  assert.equal(h.due - T, 10 * MIN);                // repeats the 10m step
  assert.equal(h.step, 1);                          // Hard never advances
  const lone = fsrs.schedule(fsrs.newCard(), 'hard', T,
    { ...cfg3, learnSteps: [10] });
  assert.equal(lone.due - T, 15 * MIN);             // lone step x1.5
  const first = fsrs.schedule(fsrs.newCard(), 'hard', T); // default steps 1 10
  assert.equal(first.due - T, 5.5 * MIN);           // first of two: average
});

test('fsrs: a step index past a shrunken step list clamps, never NaN', () => {
  const stranded = { state: 'learning', stability: 1, difficulty: 5,
    due: T, last_review: T - MIN, reps: 0, lapses: 0, step: 3 };
  const cfg1 = { newPerDay: 20, reviewsPerDay: 200, learnSteps: [10],
    relearnSteps: [10], desiredRetention: 0.9, rolloverHour: 4, learnAheadMins: 20 };
  const h = fsrs.schedule(stranded, 'hard', T, cfg1);
  assert.equal(h.due - T, 15 * MIN);          // clamped to the lone step, x1.5
  const g = fsrs.schedule(stranded, 'good', T, cfg1);
  assert.equal(g.state, 'review');            // past the last step -> graduates
  assert.ok(Number.isFinite(g.due));
});

test('fsrs: preview intervals are strictly increasing (no Good/Easy tie)', () => {
  const card = { state: 'review', stability: 1, difficulty: 5,
    due: T, last_review: T - fsrs.DAY_MS, reps: 2, lapses: 0, step: 0 };
  const p = fsrs.previewIntervals(card, T);
  assert.ok(p.again < p.hard && p.hard < p.good && p.good < p.easy);
});

test('build: page entries bundle cleanly as ESM', async () => {
  const r = await esbuild.build({
    entryPoints: ['./src/script.js', './src/anki.js'],
    bundle: true, write: false, format: 'esm', logLevel: 'silent',
    outdir: '/dev/null',
  });
  assert.equal(r.errors.length, 0);
});

const DIST = path.join(import.meta.dirname, 'dist');
before(async () => { await build(); });

function pageRefs(page) {
  const html = fs.readFileSync(path.join(DIST, page), 'utf8');
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map(m => m[1]).filter(u => !/^(https?:|data:|#|mailto:)/.test(u));
}

test('build: pages reference only files present in dist', () => {
  for (const page of ['index.html', 'anki.html'])
    for (const ref of pageRefs(page))
      assert.ok(fs.existsSync(path.join(DIST, ref)), `${page} -> missing ${ref}`);
});

test('build: asset refs are content-hashed and match their content', () => {
  for (const page of ['index.html', 'anki.html'])
    for (const ref of pageRefs(page)) {
      if (ref.endsWith('.html')) continue; // page-to-page nav links stay plain
      const m = ref.match(/-([0-9a-f]{8})\.(js|css|png|svg|webmanifest)$/);
      assert.ok(m, `${ref} is not hashed`);
      const buf = fs.readFileSync(path.join(DIST, ref));
      assert.equal(m[1], crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8));
    }
});

test('build: no bare asset names leak into HTML', () => {
  const bare = ['style.css', 'script.js', 'anki.js', 'manifest.webmanifest',
    'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon.svg'];
  for (const page of ['index.html', 'anki.html']) {
    const html = fs.readFileSync(path.join(DIST, page), 'utf8');
    for (const b of bare) assert.ok(!html.includes(`"${b}"`), `${page} still references ${b}`);
  }
});

test('build: manifest is valid and its icons exist in dist', () => {
  const ref = pageRefs('anki.html').find(r => r.endsWith('.webmanifest'));
  const mani = JSON.parse(fs.readFileSync(path.join(DIST, ref), 'utf8'));
  for (const ic of mani.icons) assert.ok(fs.existsSync(path.join(DIST, ic.src)), `missing ${ic.src}`);
});

function swAssets() {
  const src = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  return JSON.parse(src.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
}

test('build: sw precaches exactly the dist files plus root', () => {
  const onDisk = fs.readdirSync(DIST).filter(f => f !== 'sw.js');
  const precached = new Set(swAssets());
  assert.ok(precached.has('./'));
  for (const f of onDisk) assert.ok(precached.has(f), `sw missing ${f}`);
  for (const a of precached) if (a !== './')
    assert.ok(onDisk.includes(a), `sw lists absent ${a}`);
});

test('build: sw is network-first for navigations, cache-first otherwise', () => {
  const src = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  assert.match(src, /req\.mode === 'navigate'/);
  assert.match(src, /caches\.match\('\.\/'\)/);
  assert.match(src, /caches\.match\(req\)\.then\(hit => hit \|\| fetch\(req\)/);
});

test('build: both pages link manifest, apple-touch-icon, and a module script', () => {
  for (const page of ['index.html', 'anki.html']) {
    const html = fs.readFileSync(path.join(DIST, page), 'utf8');
    assert.match(html, /rel="manifest"/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /<script type="module"/);
  }
});

test('day: rollover splits a calendar day at the rollover hour', () => {
  const base = dayStart(20000, 4);          // 04:00 local on study-day 20000
  // 3h after rollover is the same study-day.
  assert.equal(dayOf(base + 3 * 3600000, 4), 20000);
  // 21h after = 01:00 next calendar day, still before the 4am rollover.
  assert.equal(dayOf(base + 21 * 3600000, 4), 20000);
  // 25h after = 05:00 next calendar day, past the rollover → next study-day.
  assert.equal(dayOf(base + 25 * 3600000, 4), 20001);
  // 1h before rollover still belongs to the previous study-day.
  assert.equal(dayOf(base - 3600000, 4), 19999);
});

test('day: dayStart is the inverse of dayOf and lands one day apart', () => {
  for (const d of [18000, 19999, 20000, 20377]) {
    assert.equal(dayOf(dayStart(d, 4), 4), d);
    assert.ok(dayStart(d + 1, 4) - dayStart(d, 4) >= 23 * 3600000); // ~1 day (DST-tolerant)
  }
});

test('day: a review due-dated to tomorrow surfaces only next study-day', () => {
  const T = dayStart(20000, 4) + 20 * 3600000; // late in study-day 20000
  const due = dayStart(dayOf(T, 4) + 1, 4);     // due "in 1 day"
  assert.ok(due > T);
  assert.equal(dayOf(due, 4), dayOf(T, 4) + 1);
});

import { pickNext, counts, cramAdvance } from './src/queue.js';

const QDAY = 20000;
const QNOW = dayStart(QDAY, 4) + 12 * 3600000; // midday on study-day 20000
const cfg = { newPerDay: 2, reviewsPerDay: 2, learnSteps: [1, 10],
  relearnSteps: [10], desiredRetention: 0.9, rolloverHour: 4, learnAheadMins: 20 };
const newC = id => ({ id, state: 'new', due: 0, stability: 0, difficulty: 0, step: 0 });
const learnC = (id, due) => ({ id, state: 'learning', due, step: 0 });
const revC = (id, due) => ({ id, state: 'review', due, stability: 10, difficulty: 5 });

test('queue: a ready learning card preempts new and due reviews', () => {
  const cards = [newC('n1'), revC('r1', QNOW - 1000), learnC('l1', QNOW - 1000)];
  assert.deepEqual(pickNext({ cards, stats: newStats(), config: cfg, now: QNOW }),
    { kind: 'card', id: 'l1' });
});

test('queue: new and review interleave instead of all-new-then-reviews', () => {
  const cards = [newC('n1'), newC('n2'), revC('r1', QNOW - 2000), revC('r2', QNOW - 1000)];
  const stats = newStats();
  const order = [];
  for (let i = 0; i < 4; i++) {
    const p = pickNext({ cards, stats, config: cfg, now: QNOW });
    order.push(p.id);
    // simulate answering: drop the card, record its kind
    const c = cards.find(x => x.id === p.id);
    cards.splice(cards.indexOf(c), 1);
    if (c.state === 'new') recordNew(stats, QDAY);
    recordReview(stats, 'good', QDAY, c.state === 'review');
  }
  assert.ok(order.includes('n1') && order.includes('r1'));
  assert.notDeepEqual(order.slice(0, 2), ['n1', 'n2']); // not both new first
});

test('queue: new stops at newPerDay, reviews stop at reviewsPerDay', () => {
  const stats = newStats();
  recordNew(stats, QDAY); recordNew(stats, QDAY);           // 2 new done == cap
  recordReview(stats, 'good', QDAY, true);
  recordReview(stats, 'good', QDAY, true);                  // 2 reviews done == cap
  const cards = [newC('n1'), revC('r1', QNOW - 1000)];
  const p = pickNext({ cards, stats, config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');                             // both limits spent
});

test('queue: learning cards ignore the daily limits', () => {
  const stats = newStats();
  recordNew(stats, QDAY); recordNew(stats, QDAY);
  recordReview(stats, 'good', QDAY, true); recordReview(stats, 'good', QDAY, true);
  const cards = [learnC('l1', QNOW - 1000)];                // limits spent, learning still shows
  assert.deepEqual(pickNext({ cards, stats, config: cfg, now: QNOW }),
    { kind: 'card', id: 'l1' });
});

test('queue: learn-ahead shows a soon card now, else reports done', () => {
  const inside = [learnC('l1', QNOW + 10 * 60000)];         // 10m away, inside 20m window
  assert.deepEqual(pickNext({ cards: inside, stats: newStats(), config: cfg, now: QNOW }),
    { kind: 'card', id: 'l1' });
  const outside = [learnC('l2', QNOW + 40 * 60000)];        // 40m away, outside window
  const p = pickNext({ cards: outside, stats: newStats(), config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');
  assert.equal(p.learning, 1);
});

test('queue: learn-ahead advances past the just-answered card when another waits', () => {
  const cards = [learnC('l1', QNOW + 1 * 60000), learnC('l2', QNOW + 8 * 60000)];
  assert.deepEqual(pickNext({ cards, stats: newStats(), config: cfg, now: QNOW }),
    { kind: 'card', id: 'l1' });                             // soonest by default
  assert.deepEqual(                                          // just answered l1 -> serve l2
    pickNext({ cards, stats: newStats(), config: cfg, now: QNOW, lastId: 'l1' }),
    { kind: 'card', id: 'l2' });
  const solo = [learnC('l1', QNOW + 1 * 60000), learnC('l2', QNOW + 40 * 60000)];
  assert.deepEqual(                                          // l1 alone in-window -> re-served
    pickNext({ cards: solo, stats: newStats(), config: cfg, now: QNOW, lastId: 'l1' }),
    { kind: 'card', id: 'l1' });
});

test('queue: done reports the next due day from blocked new and future reviews', () => {
  const stats = newStats();
  recordNew(stats, QDAY); recordNew(stats, QDAY);           // new cap spent -> new available tomorrow
  const cards = [newC('n1'), revC('r1', dayStart(QDAY + 3, 4))];
  const p = pickNext({ cards, stats, config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');
  assert.equal(p.dueDay, QDAY + 1);                         // soonest is the blocked new card
});

test('queue: counts are limit-capped and agree with the queue', () => {
  const stats = newStats();
  recordNew(stats, QDAY);                                   // 1 of 2 new used
  const cards = [newC('n1'), newC('n2'), newC('n3'),
    learnC('l1', QNOW + 5 * 60000), revC('r1', QNOW - 1000), revC('r2', QNOW - 1000),
    revC('r3', QNOW - 1000)];
  const c = counts({ cards, stats, config: cfg, now: QNOW });
  assert.equal(c.newLeft, 1);                               // cap 2 minus 1 used
  assert.equal(c.learning, 1);
  assert.equal(c.due, 2);                                   // 3 due reviews capped at 2
});

test('queue: suspended cards are invisible to picks, counts, and due hints', () => {
  const cards = [{ ...newC('n1'), suspended: true },
    { ...learnC('l1', QNOW - 1000), suspended: true },
    { ...revC('r1', QNOW - 1000), suspended: true }];
  const p = pickNext({ cards, stats: newStats(), config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');
  assert.equal(p.learning, 0);
  assert.equal(p.dueDay, null);                     // nothing upcoming either
  const c = counts({ cards, stats: newStats(), config: cfg, now: QNOW });
  assert.deepEqual(c, { newLeft: 0, learning: 0, due: 0 });
});

test('queue: cramAdvance drops the front card; Again re-drills it at the back', () => {
  assert.deepEqual(cramAdvance(['a', 'b', 'c'], 'good'), ['b', 'c']);
  assert.deepEqual(cramAdvance(['a', 'b', 'c'], 'easy'), ['b', 'c']);
  assert.deepEqual(cramAdvance(['a', 'b', 'c'], 'again'), ['b', 'c', 'a']);
  let q = ['a', 'b'];
  q = cramAdvance(q, 'again');   // ['b','a'] — re-drill a
  q = cramAdvance(q, 'good');    // ['a']
  q = cramAdvance(q, 'good');    // []
  assert.deepEqual(q, []);       // drains to empty
  assert.deepEqual(cramAdvance([], 'again'), []);   // empty queue stays empty
  assert.deepEqual(cramAdvance([], 'good'), []);
});

test('queue: raising newPerDay past the spent cap reopens new cards (study more)', () => {
  const stats = newStats();
  recordNew(stats, QDAY); recordNew(stats, QDAY);   // 2 new done == base cap (cfg.newPerDay is 2)
  const cards = [newC('n1')];
  assert.equal(pickNext({ cards, stats, config: cfg, now: QNOW }).kind, 'done'); // cap spent
  const bumped = { ...cfg, newPerDay: cfg.newPerDay + 10 };
  assert.deepEqual(pickNext({ cards, stats, config: bumped, now: QNOW }),
    { kind: 'card', id: 'n1' });                     // bump reopens the new card
});

test('queue: a spent review limit reports hidden reviews due tomorrow', () => {
  const stats = newStats();
  recordReview(stats, 'good', QDAY, true);
  recordReview(stats, 'good', QDAY, true);          // review cap (2) spent
  const cards = [revC('r1', QNOW - 2000), revC('r2', QNOW - 1000)];
  const p = pickNext({ cards, stats, config: cfg, now: QNOW });
  assert.equal(p.kind, 'done');
  assert.equal(p.revHidden, 2);
  assert.equal(p.dueDay, QDAY + 1);                 // hint says tomorrow, not silence
});

import { DEFAULT_CONFIG, parseSteps, formatSteps, normalizeConfig } from './src/config.js';

test('config: parseSteps reads space-separated positive minutes, else empty', () => {
  assert.deepEqual(parseSteps('1 10'), [1, 10]);
  assert.deepEqual(parseSteps('1  10'), [1, 10]);
  assert.deepEqual(parseSteps('  '), []);
  assert.deepEqual(parseSteps('x'), []);
  assert.deepEqual(parseSteps('1 -5 10'), [1, 10]);   // drops non-positive
});

test('config: formatSteps round-trips with parseSteps', () => {
  assert.equal(formatSteps([1, 10]), '1 10');
  assert.deepEqual(parseSteps(formatSteps([1, 10, 60])), [1, 10, 60]);
});

test('config: normalizeConfig clamps each field to its valid range', () => {
  assert.equal(normalizeConfig({ desiredRetention: 1.5 }).desiredRetention, 0.99);
  assert.equal(normalizeConfig({ desiredRetention: 0.1 }).desiredRetention, 0.70);
  assert.equal(normalizeConfig({ newPerDay: -5 }).newPerDay, 0);
  assert.equal(normalizeConfig({ newPerDay: 12.6 }).newPerDay, 13);   // rounded int
  assert.equal(normalizeConfig({ rolloverHour: 30 }).rolloverHour, 23);
  assert.deepEqual(normalizeConfig({ learnSteps: [] }).learnSteps, DEFAULT_CONFIG.learnSteps);
  assert.deepEqual(normalizeConfig({ learnSteps: [0, -1] }).learnSteps, DEFAULT_CONFIG.learnSteps);
});

test('config: normalizeConfig merges a partial blob over defaults', () => {
  const c = normalizeConfig({ newPerDay: 30 });
  assert.equal(c.newPerDay, 30);
  assert.equal(c.reviewsPerDay, DEFAULT_CONFIG.reviewsPerDay);
  assert.equal(c.rolloverHour, DEFAULT_CONFIG.rolloverHour);
  assert.equal(c.learnAheadMins, DEFAULT_CONFIG.learnAheadMins);
  assert.equal(normalizeConfig({ leechThreshold: 3 }).leechThreshold, 8);
});

import { alignFurigana, rubyHTML, escapeHtml } from './src/furigana.js';

test('furigana: peels okurigana so only the kanji core carries reading', () => {
  assert.deepEqual(alignFurigana('会う', 'あう'), [{ t: '会', r: 'あ' }, { t: 'う', r: '' }]);
});

test('furigana: single kanji takes the whole reading', () => {
  assert.deepEqual(alignFurigana('水', 'みず'), [{ t: '水', r: 'みず' }]);
});

test('furigana: all-kana word gets no ruby', () => {
  assert.deepEqual(alignFurigana('ああ', 'ああ'), [{ t: 'ああ', r: '' }]);
});

test('furigana: multi-kanji block gets one ruby span', () => {
  assert.deepEqual(alignFurigana('日本', 'にほん'), [{ t: '日本', r: 'にほん' }]);
});

test('rubyHTML renders ruby for kanji and plain text for kana', () => {
  assert.equal(rubyHTML(alignFurigana('会う', 'あう')), '<ruby>会<rt>あ</rt></ruby>う');
  assert.equal(rubyHTML(alignFurigana('ああ', 'ああ')), 'ああ');
});

test('escapeHtml neutralizes meaning punctuation', () => {
  assert.equal(escapeHtml('to be <x> & "y"'), 'to be &lt;x&gt; &amp; &quot;y&quot;');
});

import { parseCsv, buildVocab, generate } from './scripts/gen-vocab.js';

test('parseCsv keeps commas inside quoted fields', () => {
  const rows = parseCsv('a,b,c\n会う,あう,"to meet, to see"\n');
  assert.deepEqual(rows[1], ['会う', 'あう', 'to meet, to see']);
});

test('buildVocab dedupes by guid and keeps the easiest level', () => {
  const header = ['expression', 'reading', 'meaning', 'tags', 'guid'];
  const v = buildVocab([
    { level: 'N5', rows: [header, ['水', 'みず', 'water', 't', 'G1']] },
    { level: 'N3', rows: [header, ['水', 'みず', 'water', 't', 'G1']] },
  ]);
  assert.equal(v.length, 1);
  assert.equal(v[0].level, 'N5');
  assert.deepEqual(v[0], {
    id: 'v:G1', word: '水', reading: 'みず', meaning: 'water', level: 'N5',
    furigana: [{ t: '水', r: 'みず' }],
  });
});

test('generate produces well-formed, uniquely-ided entries from real CSVs', () => {
  const v = generate('./data/jlpt');
  assert.ok(v.length > 5000, `expected >5000 entries, got ${v.length}`);
  assert.equal(new Set(v.map(e => e.id)).size, v.length, 'ids unique');
  for (const e of v.slice(0, 50)) {
    assert.match(e.id, /^v:/);
    assert.ok(e.word && e.reading && e.meaning);
    assert.match(e.level, /^N[1-5]$/);
    assert.ok(Array.isArray(e.furigana) && e.furigana.length > 0);
  }
});

import { VOCAB } from './src/vocab-data.js';
import { LEVELS, idsForLevels } from './src/vocab-deck.js';

test('idsForLevels selects only the requested levels, over real data', () => {
  const n5 = idsForLevels(VOCAB, ['N5']);
  assert.ok(n5.length > 0);
  assert.ok(n5.every(id => VOCAB.find(v => v.id === id).level === 'N5'));
  assert.equal(idsForLevels(VOCAB, []).length, 0);
  assert.equal(idsForLevels(VOCAB, ['N5', 'N4']).length,
    idsForLevels(VOCAB, ['N5']).length + idsForLevels(VOCAB, ['N4']).length);
});

test('LEVELS covers N5 through N1', () => {
  assert.deepEqual(LEVELS, ['N5', 'N4', 'N3', 'N2', 'N1']);
});
