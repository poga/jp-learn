const byId = Object.fromEntries(KANA.map(e => [e.id, e]));

function makeCell(id, script) {
  const div = document.createElement('div');
  div.className = 'cell';
  if (!id) { div.classList.add('empty'); return div; }
  div.dataset.id = id;
  div.textContent = script === 'hira' ? byId[id].hira : byId[id].kata;
  return div;
}

function makeGrid(script, rows, cols) {
  const grid = document.createElement('div');
  grid.className = `grid cols-${cols}`;
  rows.forEach(row => row.forEach(id => grid.appendChild(makeCell(id, script))));
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
