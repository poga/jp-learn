import { newCard, schedule, previewIntervals, isLeech, DAY_MS } from './fsrs.js';
import { newStats, recordReview, recordNew, reviewsOn, recordLog,
  unrecordReview, unrecordNew, unrecordLog,
  currentStreak, bestStreak, retention } from './stats.js';
import { pickNext, counts as queueCounts, cramAdvance } from './queue.js';
import { dayOf } from './day.js';
import { normalizeConfig, parseSteps, formatSteps } from './config.js';
import './pwa.js';

// Generic Anki-style trainer shell; deck spec supplies data, bar, render.
export function createTrainer(spec) {
  const STORE_KEY = spec.keys.store, STATS_KEY = spec.keys.stats;
  const CONFIG_KEY = spec.keys.config;
  const MATURE_DAYS = 21, STUDY_MORE_N = 10, UNDO_CAP = 100;

  function loadConfig() {
    try { return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}); }
    catch (e) { return normalizeConfig({}); }
  }
  let CONFIG = loadConfig();

  spec.migrate?.();

  const now = () => Date.now();
  const today = () => dayOf(now(), CONFIG.rolloverHour);
  const byId = spec.cardById;

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

  const stateFor = id => store[id] || newCard();

  const $ = id => document.getElementById(id);
  const statsEl = $('stats'), streakEl = $('streak');
  const stage = $('stage');
  const doneEl = $('done'), cardEl = $('card'), hintEl = $('hint');
  const gradesEl = $('grades'), scriptEl = $('card-script');
  const frontEl = $('card-front'), readingEl = $('card-reading');
  const iv = { again: $('iv-again'), hard: $('iv-hard'),
    good: $('iv-good'), easy: $('iv-easy') };
  const opt = { new: $('opt-new'), rev: $('opt-rev'), learn: $('opt-learn'),
    relearn: $('opt-relearn'), retention: $('opt-retention'), rollover: $('opt-rollover') };

  const deckCards = () => spec.selectedIds();

  let active = [], current = null, flipped = false, reviewed = 0;
  let mode = 'normal', extraNew = 0, cramQueue = [], crammed = 0;
  let undoStack = [];
  const undoBtn = $('undo');

  function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    undoBtn.hidden = false;
  }
  function clearUndo() { undoStack = []; undoBtn.hidden = true; }

  // Anki-style undo: restore the card, reverse the stats, show it again.
  function undo() {
    const e = undoStack.pop();
    if (!e) return;
    undoBtn.hidden = undoStack.length === 0;
    stage.hidden = false; doneEl.hidden = true;
    flipped = false;
    if (e.kind === 'cram') {
      cramQueue = e.queue;
      crammed = Math.max(0, crammed - 1);
      current = cramQueue[0];
      return render();
    }
    store[e.id] = e.prev;
    unrecordReview(stats, e.grade, e.day, e.wasReview);
    if (e.wasNew) unrecordNew(stats, e.day);
    unrecordLog(stats);
    saveStore(); saveStats();
    reviewed = Math.max(0, reviewed - 1);
    current = e.id;
    updateStreak();
    render();
  }

  // Effective config: Custom Study can raise today's new limit.
  const sessionConfig = () => ({ ...CONFIG, newPerDay: CONFIG.newPerDay + extraNew });

  // Fisher-Yates; randomizes new-card order so the deck isn't strictly ordered.
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

  function next(lastId = null) {
    flipped = false;
    if (mode === 'cram') {
      if (!cramQueue.length) { current = null; return showCramDone(); }
      current = cramQueue[0];
      return render();
    }
    const pick = pickNext({ cards: sessionCards(), stats, config: sessionConfig(), now: now(), lastId });
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
    const { badge, front, back } = spec.renderCard(byId[current]);
    scriptEl.textContent = badge;
    frontEl.innerHTML = front;
    readingEl.innerHTML = back;
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
    if (mode === 'cram') {
      for (const g of ['again', 'hard', 'good', 'easy']) iv[g].textContent = '';
    } else {
      const p = previewIntervals(stateFor(current), now(), CONFIG);
      for (const g of ['again', 'hard', 'good', 'easy']) iv[g].textContent = fmtIv(p[g]);
    }
    gradesEl.hidden = false;
  }

  function grade(g) {
    if (!flipped || !current) return;
    if (mode === 'cram') {
      pushUndo({ kind: 'cram', queue: cramQueue });
      cramQueue = cramAdvance(cramQueue, g);
      crammed++;
      return next();
    }
    const before = stateFor(current);
    const t = now();
    const day = dayOf(t, CONFIG.rolloverHour);
    pushUndo({ kind: 'grade', id: current, prev: { ...before }, day, grade: g,
      wasNew: before.state === 'new', wasReview: before.state === 'review' });
    const after = schedule(before, g, t, CONFIG);
    if (before.state === 'review' && g === 'again'
        && isLeech(after.lapses, CONFIG.leechThreshold)) after.suspended = true;
    store[current] = after;
    if (before.state === 'new') recordNew(stats, day);
    recordReview(stats, g, day, before.state === 'review');
    recordLog(stats, { id: current, t, grade: g, state: before.state });
    saveStore(); saveStats();
    reviewed++;
    updateStreak();
    next(current);
  }

  function updateStats() {
    if (mode === 'cram') {
      statsEl.innerHTML = `<span class="ct-learn">cram · ${cramQueue.length} left</span>`;
      return;
    }
    const c = queueCounts({ cards: sessionCards(), stats, config: sessionConfig(), now: now() });
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
    let fresh = 0, learning = 0, mature = 0, suspended = 0;
    const ids = deckCards();
    for (const id of ids) {
      const st = stateFor(id);
      if (st.suspended) suspended++;
      else if (st.state === 'new') fresh++;
      else if (st.state === 'review' && st.stability >= MATURE_DAYS) mature++;
      else learning++;
    }
    return { fresh, learning, mature, suspended, total: ids.length };
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
        ${bd.fresh} new · ${bd.learning} learning · ${bd.mature} mature</p>`
      + (bd.suspended > 0
        ? `<p class="progress-label">⚠ ${bd.suspended} leech${bd.suspended > 1 ? 'es' : ''} suspended
          <button id="unsuspend" class="opt-btn">unsuspend all</button></p>`
        : '');
  }

  function showDone(done = { learning: 0, dueDay: null, revHidden: 0 }) {
    stage.hidden = true; doneEl.hidden = false;
    if (deckCards().length === 0) {
      doneEl.innerHTML = spec.emptyDeckHint;
      return;
    }
    const t = today();
    const days = done.dueDay == null || done.dueDay <= t ? 0 : done.dueDay - t;
    const when = days > 0 ? ` Next due in ${days} day${days > 1 ? 's' : ''}.`
      : done.learning > 0
        ? ` ${done.learning} still in learning — come back soon.` : '';
    const capped = done.revHidden > 0
      ? ` daily review limit reached — ${done.revHidden} waiting.` : '';
    const head = reviewed > 0 ? '完了' : 'all caught up';
    const body = reviewed > 0
      ? `${reviewed} card${reviewed === 1 ? '' : 's'} reviewed.${capped}${when}`
      : `nothing due right now.${capped}${when}`;
    let extra = '';
    if (deckBreakdown().fresh > 0)
      extra += `<button id="more-new" class="grade hard">study ${STUDY_MORE_N} more new</button>`;
    extra += '<button id="cram" class="grade">cram (free practice)</button>';
    doneEl.innerHTML = `<div class="done-mark">${head}</div>` +
      `<p class="done-note">${body}</p>` + statsPanel() +
      '<button id="restart" class="grade good">study again</button>' + extra;
    $('restart').addEventListener('click', startSession);
    if ($('more-new')) $('more-new').addEventListener('click', studyMoreNew);
    $('cram').addEventListener('click', startCram);
    if ($('unsuspend')) $('unsuspend').addEventListener('click', unsuspendAll);
  }

  function startSession() {
    clearUndo();
    mode = 'normal'; extraNew = 0;
    stage.hidden = false; doneEl.hidden = true;
    buildSession();
  }

  // Custom Study: raise today's new limit, keep going (reschedules normally).
  function studyMoreNew() {
    extraNew += STUDY_MORE_N;
    stage.hidden = false; doneEl.hidden = true;
    next();
  }

  // Cram: drill the whole deck, shuffled, with no effect on the schedule.
  function startCram() {
    clearUndo();
    mode = 'cram'; cramQueue = shuffle(deckCards().filter(id => !stateFor(id).suspended));
    crammed = 0;
    stage.hidden = false; doneEl.hidden = true;
    next();
  }

  // Clear every leech suspension and fold the cards back into the schedule.
  function unsuspendAll() {
    for (const id of Object.keys(store)) delete store[id].suspended;
    saveStore();
    startSession();
  }

  function showCramDone() {
    stage.hidden = true; doneEl.hidden = false;
    doneEl.innerHTML = '<div class="done-mark">済</div>' +
      `<p class="done-note">cram complete — ${crammed} drilled.</p>` +
      '<button id="cram-again" class="grade good">cram again</button>' +
      '<button id="cram-back" class="grade">back</button>';
    $('cram-again').addEventListener('click', startCram);
    $('cram-back').addEventListener('click', startSession);
  }

  // Write CONFIG into the panel inputs (retention shown as a percent).
  function fillOptions() {
    opt.new.value = CONFIG.newPerDay;
    opt.rev.value = CONFIG.reviewsPerDay;
    opt.learn.value = formatSteps(CONFIG.learnSteps);
    opt.relearn.value = formatSteps(CONFIG.relearnSteps);
    opt.retention.value = Math.round(CONFIG.desiredRetention * 100);
    opt.rollover.value = CONFIG.rolloverHour;
  }

  // Persist CONFIG and apply it to the live session.
  function applyConfig() {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG)); } catch (e) {}
    fillOptions();
    updateStreak();
    startSession();
  }

  // Read the panel, normalize, and apply.
  function saveConfig() {
    CONFIG = normalizeConfig({
      newPerDay: Number(opt.new.value),
      reviewsPerDay: Number(opt.rev.value),
      learnSteps: parseSteps(opt.learn.value),
      relearnSteps: parseSteps(opt.relearn.value),
      desiredRetention: Number(opt.retention.value) / 100,
      rolloverHour: Number(opt.rollover.value),
    });
    applyConfig();
  }

  function resetConfig() { CONFIG = normalizeConfig({}); applyConfig(); }

  cardEl.addEventListener('click', flip);
  gradesEl.querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => grade(b.dataset.grade)));
  spec.setupDeckBar(startSession);
  undoBtn.addEventListener('click', undo);

  document.addEventListener('keydown', ev => {
    if (ev.target.closest('.options')) return;
    if ((ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) {
      ev.preventDefault(); return undo();
    }
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

  // On foreground return, re-pick: a card that ripened while asleep shows now.
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
      try { for (const k of Object.values(spec.keys)) localStorage.removeItem(k); }
      catch (e) {}
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

  $('opt-save').addEventListener('click', saveConfig);
  $('opt-reset').addEventListener('click', resetConfig);
  // auto-save each option on blur/Enter so edits persist without clicking save
  Object.values(opt).forEach(i => i.addEventListener('change', saveConfig));

  fillOptions();
  spec.applyPref();
  updateStreak();
  startSession();
}
