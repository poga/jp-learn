const byId = Object.fromEntries(KANA.map(e => [e.id, e]));

function makeCell(id, script) {
  const div = document.createElement('div');
  div.className = 'cell';
  if (!id) { div.classList.add('empty'); return div; }
  div.dataset.id = id;
  div.textContent = script === 'hira' ? byId[id].hira : byId[id].kata;
  return div;
}

function makeGrid(script, groups, rows) {
  const grid = document.createElement('div');
  grid.className = `grid rows-${rows}`;
  // each group is a top-to-bottom column; place groups right-to-left
  [...groups].reverse().forEach(group =>
    group.forEach(id => grid.appendChild(makeCell(id, script))));
  return grid;
}

function makeSection(script, title) {
  const section = document.createElement('section');
  const h = document.createElement('h2');
  h.textContent = title;
  section.appendChild(h);
  section.appendChild(makeGrid(script, LAYOUT.gojuon, 5));
  section.appendChild(makeGrid(script, LAYOUT.dakuten, 5));
  section.appendChild(makeGrid(script, LAYOUT.yoon, 3));
  return section;
}

const app = document.getElementById('app');
app.appendChild(makeSection('hira', 'ひらがな'));
app.appendChild(makeSection('kata', 'カタカナ'));

// speak the kana aloud using the browser's Japanese voice
function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.8;
  const jp = synth.getVoices().find(v => v.lang.startsWith('ja'));
  if (jp) u.voice = jp;
  synth.speak(u);
}

const filter = document.getElementById('filter');
const allCells = app.querySelectorAll('.cell[data-id]');

allCells.forEach(c => {
  c.classList.add('speakable');
  c.addEventListener('click', () => speak(c.textContent));
});

filter.addEventListener('input', () => {
  const q = filter.value.trim();
  const active = q.length > 0;
  allCells.forEach(c => {
    const hit = active && matchRomaji(q, byId[c.dataset.id]);
    c.classList.toggle('is-match', hit);
    c.classList.toggle('is-dim', active && !hit);
  });
});
