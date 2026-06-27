// Page glue around the pure srs.js scheduler: localStorage, the session
// queue, and the flip/grade UI. Browser-only.

const STORE_KEY = 'anki-srs-v1';
const NEW_PER_SESSION = 20;
const today = Math.floor(Date.now() / 86400000);

const byId = Object.fromEntries(KANA.map(e => [e.id, e]));

// --- persistence (kept out of srs.js so the scheduler stays pure) ---
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)).cards || {}; }
  catch (e) { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY,
    JSON.stringify({ version: 1, cards: store })); } catch (e) {}
}
const store = loadStore();

// A card is one kana in one script; あ and ア are learned separately.
const cardId = (entryId, script) => `${entryId}:${script}`;
const stateFor = id => store[id] || newCard();
function parseCard(id) {
  const [entryId, script] = id.split(':');
  const e = byId[entryId];
  return { e, script, glyph: script === 'hira' ? e.hira : e.kata };
}

const $ = id => document.getElementById(id);
const deckBar = $('deck-bar'), statsEl = $('stats'), stage = $('stage');
const doneEl = $('done'), cardEl = $('card'), hintEl = $('hint');
const gradesEl = $('grades'), scriptEl = $('card-script');
const frontEl = $('card-front'), readingEl = $('card-reading');
const iv = { again: $('iv-again'), good: $('iv-good'), easy: $('iv-easy') };

// All rows of the syllabary, in whichever scripts are ticked; あ and ア are
// separate cards.
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

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let queue = [], current = null, flipped = false, reviewed = 0;

function buildSession() {
  const due = [], fresh = [];
  for (const id of deckCards()) {
    const st = stateFor(id);
    if (st.new) fresh.push(id);
    else if (isDue(st, today)) due.push(id);
  }
  queue = shuffle(due.concat(shuffle(fresh).slice(0, NEW_PER_SESSION)));
  reviewed = 0;
  next();
}

function fmtIv(d) {
  if (d <= 0) return 'now';
  if (d < 30) return d + 'd';
  return Math.round(d / 30) + 'mo';
}

function render() {
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
  const st = stateFor(current);
  for (const g of ['again', 'good', 'easy'])
    iv[g].textContent = fmtIv(schedule(st, g, today).interval);
  gradesEl.hidden = false;
}

function grade(g) {
  if (!flipped || !current) return;
  store[current] = schedule(stateFor(current), g, today);
  saveStore();
  reviewed++;
  if (g === 'again') queue.push(current); // relearn before the session ends
  next();
}

function next() {
  flipped = false;
  current = queue.shift() || null;
  if (!current) return showDone();
  render();
}

function updateStats() {
  const left = queue.length + (current ? 1 : 0);
  statsEl.textContent = `${reviewed} reviewed · ${left} left`;
}

// Earliest day the deck has anything to study, or null if fully buried.
function nextDueDay() {
  let min = null;
  for (const id of deckCards()) {
    const st = stateFor(id);
    if (st.new) return today;
    if (st.due > today && (min == null || st.due < min)) min = st.due;
  }
  return min;
}

function showDone() {
  stage.hidden = true;
  doneEl.hidden = false;
  updateStats();
  if (deckCards().length === 0) {
    doneEl.innerHTML = '<p class="done-note">tick 平仮名 or 片仮名 above.</p>';
    return;
  }
  const upcoming = nextDueDay();
  const days = upcoming == null || upcoming <= today ? 0 : upcoming - today;
  const when = days > 0 ? ` Next due in ${days} day${days > 1 ? 's' : ''}.` : '';
  const head = reviewed > 0 ? '完了' : 'all caught up';
  const body = reviewed > 0
    ? `${reviewed} card${reviewed === 1 ? '' : 's'} reviewed.${when}`
    : `nothing due right now.${when}`;
  doneEl.innerHTML = `<div class="done-mark">${head}</div>` +
    `<p class="done-note">${body}</p>` +
    '<button id="restart" class="grade good">study again</button>';
  $('restart').addEventListener('click', startSession);
}

function startSession() {
  stage.hidden = false;
  doneEl.hidden = true;
  buildSession();
}

cardEl.addEventListener('click', flip);
gradesEl.querySelectorAll('button').forEach(b =>
  b.addEventListener('click', () => grade(b.dataset.grade)));
deckBar.querySelectorAll('input').forEach(i =>
  i.addEventListener('change', startSession));

document.addEventListener('keydown', ev => {
  if (!doneEl.hidden) return;
  if (!flipped) {
    if (ev.code === 'Space' || ev.code === 'Enter') { ev.preventDefault(); flip(); }
    return;
  }
  if (ev.code === 'Space' || ev.key === '2') { ev.preventDefault(); grade('good'); }
  else if (ev.key === '1') grade('again');
  else if (ev.key === '3') grade('easy');
});

startSession();
