import { KANA } from './kana.js';
import { newCard, schedule, previewIntervals, DAY_MS } from './fsrs.js';
import { newStats, recordReview, recordNew, reviewsOn, revDoneOn, recordLog,
  currentStreak, bestStreak, retention } from './stats.js';
import { pickNext, counts as queueCounts } from './queue.js';
import { dayOf } from './day.js';
import { DEFAULT_CONFIG } from './config.js';
import './pwa.js';

// Page glue: localStorage, flip/grade UI, drives the pure queue. Browser-only.

const STORE_KEY = 'anki-fsrs-v1';
const STATS_KEY = 'anki-stats-v2';
const PREF_KEY = 'anki-deck-v1';
const CONFIG = DEFAULT_CONFIG;
const MATURE_DAYS = 21;

// drop legacy SM-2 progress and stats (full reset on upgrade)
try { localStorage.removeItem('anki-srs-v1'); localStorage.removeItem('anki-stats-v1'); }
catch (e) {}

const now = () => Date.now();
const today = () => dayOf(now(), CONFIG.rolloverHour);
const byId = Object.fromEntries(KANA.map(e => [e.id, e]));

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)).cards || {}; }
  catch (e) { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, cards: store })); }
  catch (e) {}
}
const store = loadStore();

function loadStats() {
  try { return Object.assign(newStats(), JSON.parse(localStorage.getItem(STATS_KEY))); }
  catch (e) { return newStats(); }
}
function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
}
const stats = loadStats();

const cardId = (entryId, script) => `${entryId}:${script}`;
const stateFor = id => store[id] || newCard();
function parseCard(id) {
  const [entryId, script] = id.split(':');
  const e = byId[entryId];
  return { e, script, glyph: script === 'hira' ? e.hira : e.kata };
}

const $ = id => document.getElementById(id);
const deckBar = $('deck-bar'), statsEl = $('stats'), streakEl = $('streak');
const stage = $('stage');
const doneEl = $('done'), cardEl = $('card'), hintEl = $('hint');
const gradesEl = $('grades'), scriptEl = $('card-script');
const frontEl = $('card-front'), readingEl = $('card-reading');
const iv = { again: $('iv-again'), hard: $('iv-hard'),
  good: $('iv-good'), easy: $('iv-easy') };

function selectedScripts() {
  return [...deckBar.querySelectorAll('input[name="script"]:checked')]
    .map(c => c.value);
}
function deckCards() {
  const ids = [];
  for (const e of KANA)
    for (const s of selectedScripts()) ids.push(cardId(e.id, s));
  return ids;
}

function savePref() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(selectedScripts())); }
  catch (e) {}
}
function applyPref() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) {}
  if (!Array.isArray(saved)) return;
  for (const c of deckBar.querySelectorAll('input[name="script"]'))
    c.checked = saved.includes(c.value);
}

let active = [], current = null, flipped = false, reviewed = 0;

// Fisher-Yates; randomizes new-card order so the deck isn't strictly gojūon.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildSession() {
  active = shuffle(deckCards());
  reviewed = 0;
  next();
}

// All deck cards as {id, ...state} for the pure queue.
function sessionCards() {
  return active.map(id => ({ id, ...stateFor(id) }));
}

function next() {
  flipped = false;
  const pick = pickNext({ cards: sessionCards(), stats, config: CONFIG, now: now() });
  if (pick.kind === 'card') { current = pick.id; return render(); }
  current = null;
  showDone(pick);
}

function fmtIv(ms) {
  if (ms < DAY_MS) {
    const m = Math.round(ms / 60000);
    return m < 60 ? m + 'm' : Math.round(m / 60) + 'h';
  }
  const d = Math.round(ms / DAY_MS);
  if (d < 30) return d + 'd';
  if (d < 365) return Math.round(d / 30) + 'mo';
  return Math.round(d / 365) + 'y';
}

function render() {
  cardEl.hidden = false;
  const { e, script, glyph } = parseCard(current);
  scriptEl.textContent = script === 'hira' ? 'ひらがな' : 'カタカナ';
  frontEl.textContent = glyph;
  readingEl.textContent = e.romaji;
  cardEl.classList.remove('flipped');
  gradesEl.hidden = true;
  hintEl.hidden = false;
  updateStats();
}

function flip() {
  if (flipped || !current) return;
  flipped = true;
  cardEl.classList.add('flipped');
  hintEl.hidden = true;
  const p = previewIntervals(stateFor(current), now());
  for (const g of ['again', 'hard', 'good', 'easy']) iv[g].textContent = fmtIv(p[g]);
  gradesEl.hidden = false;
}

function grade(g) {
  if (!flipped || !current) return;
  const before = stateFor(current);
  store[current] = schedule(before, g, now(), CONFIG);
  const day = today();
  if (before.state === 'new') recordNew(stats, day);
  recordReview(stats, g, day, before.state === 'review');
  recordLog(stats, { id: current, t: now(), grade: g, state: before.state });
  saveStore(); saveStats();
  reviewed++;
  updateStreak();
  next();
}

function updateStats() {
  const c = queueCounts({ cards: sessionCards(), stats, config: CONFIG, now: now() });
  statsEl.innerHTML = `<span class="ct-new">${c.newLeft} new</span> · ` +
    `<span class="ct-learn">${c.learning} learning</span> · ` +
    `<span class="ct-due">${c.due} due</span>`;
}

function updateStreak() {
  const t = today();
  const cur = currentStreak(stats, t), done = reviewsOn(stats, t);
  streakEl.textContent = cur > 0
    ? `🔥 ${cur}-day streak${done ? ` · ${done} today` : ''}`
    : 'study today to start a streak';
}

// Split the selected deck into new / learning / mature, à la Anki's counts.
function deckBreakdown() {
  let fresh = 0, learning = 0, mature = 0;
  const ids = deckCards();
  for (const id of ids) {
    const st = stateFor(id);
    if (st.state === 'new') fresh++;
    else if (st.state === 'review' && st.stability >= MATURE_DAYS) mature++;
    else learning++;
  }
  return { fresh, learning, mature, total: ids.length };
}

function statsPanel() {
  const t = today();
  const ret = retention(stats);
  const retTxt = ret == null ? '—' : Math.round(ret * 100) + '%';
  const bd = deckBreakdown();
  const learned = bd.learning + bd.mature;
  const pct = bd.total ? Math.round(learned / bd.total * 100) : 0;
  return `<div class="stat-grid">
      <div class="stat"><b>🔥 ${currentStreak(stats, t)}</b><span>day streak</span></div>
      <div class="stat"><b>${bestStreak(stats)}</b><span>best</span></div>
      <div class="stat"><b>${reviewsOn(stats, t)}</b><span>today</span></div>
      <div class="stat"><b>${retTxt}</b><span>retention</span></div>
    </div>
    <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    <p class="progress-label">${learned} / ${bd.total} learned ·
      ${bd.fresh} new · ${bd.learning} learning · ${bd.mature} mature</p>`;
}

function showDone(done = { learning: 0, dueDay: null }) {
  stage.hidden = true; doneEl.hidden = false;
  if (deckCards().length === 0) {
    doneEl.innerHTML = '<p class="done-note">tick 平仮名 or 片仮名 above.</p>';
    return;
  }
  const t = today();
  const days = done.dueDay == null || done.dueDay <= t ? 0 : done.dueDay - t;
  const when = days > 0 ? ` Next due in ${days} day${days > 1 ? 's' : ''}.`
    : done.learning > 0
      ? ` ${done.learning} still in learning — come back soon.` : '';
  const head = reviewed > 0 ? '完了' : 'all caught up';
  const body = reviewed > 0
    ? `${reviewed} card${reviewed === 1 ? '' : 's'} reviewed.${when}`
    : `nothing due right now.${when}`;
  doneEl.innerHTML = `<div class="done-mark">${head}</div>` +
    `<p class="done-note">${body}</p>` + statsPanel() +
    '<button id="restart" class="grade good">study again</button>';
  $('restart').addEventListener('click', startSession);
}

function startSession() {
  stage.hidden = false; doneEl.hidden = true;
  buildSession();
}

cardEl.addEventListener('click', flip);
gradesEl.querySelectorAll('button').forEach(b =>
  b.addEventListener('click', () => grade(b.dataset.grade)));
deckBar.querySelectorAll('input').forEach(i =>
  i.addEventListener('change', () => { savePref(); startSession(); }));

document.addEventListener('keydown', ev => {
  if (!doneEl.hidden || !current) return;
  if (!flipped) {
    if (ev.code === 'Space' || ev.code === 'Enter') { ev.preventDefault(); flip(); }
    return;
  }
  if (ev.code === 'Space' || ev.key === '3') { ev.preventDefault(); grade('good'); }
  else if (ev.key === '1') grade('again');
  else if (ev.key === '2') grade('hard');
  else if (ev.key === '4') grade('easy');
});

// On foreground return re-pick: a learning card that ripened while asleep shows at once.
function resume() {
  if (doneEl.hidden && !current) next();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
window.addEventListener('pageshow', resume);

// Two-tap wipe: first tap arms, a second within the window clears all data.
const resetBtn = $('reset');
let resetArm = null;
resetBtn.addEventListener('click', () => {
  if (resetArm) {
    clearTimeout(resetArm);
    try { localStorage.clear(); } catch (e) {}
    location.reload();
    return;
  }
  resetBtn.classList.add('armed');
  resetBtn.textContent = 'tap again to wipe';
  resetArm = setTimeout(() => {
    resetArm = null;
    resetBtn.classList.remove('armed');
    resetBtn.textContent = 'reset progress';
  }, 3000);
});

applyPref();
updateStreak();
startSession();
