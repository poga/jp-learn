# 五十音 Learning Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single static page showing every 五十音 kana (hiragana + katakana, base + dakuten/handakuten + yōon) in the traditional grid, with a filter box that highlights kana matching typed rōmaji.

**Architecture:** Pure data + match logic live in `kana.js` (a classic script, also `module.exports`-guarded for node tests). `script.js` renders the grids from that data and toggles highlight/dim classes on input. No build step, no server — opens via `file://`.

**Tech Stack:** Plain HTML/CSS/JS. Node's built-in test runner (`node:test`, `node:assert`) for the matching logic. No dependencies.

## Global Constraints

- No build step, no bundler, no framework. Files open directly via `file://`.
- `kana.js` must work both as a browser classic script (top-level `const`s shared across classic scripts) AND as a node module (`module.exports` guard at bottom).
- No mocks in tests. Test only the non-obvious matching logic, never the kana data values.
- Cells display kana only — never the rōmaji.
- Comments: max 1 line, minimal.

---

### Task 1: Kana data + `matchRomaji` logic (TDD)

**Files:**
- Create: `kana.js`
- Test: `test.js`

**Interfaces:**
- Produces:
  - `matchRomaji(query: string, entry: {romaji: string, aliases: string[]}) -> boolean` — case-insensitive, trimmed, prefix match against `romaji` and each alias; empty query returns `false`.
  - `KANA: Array<{id, hira, kata, romaji, aliases, group}>` where `group ∈ {'gojuon','dakuten','yoon'}` and `id` is unique.
  - `LAYOUT: {gojuon: (id|null)[][], dakuten: (id|null)[][], yoon: (id|null)[][]}` — row templates of ids, `null` = empty cell.

- [ ] **Step 1: Write the failing test**

Create `test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { matchRomaji, KANA, LAYOUT } = require('./kana.js');

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

test('data is wired and ids are unique', () => {
  assert.ok(KANA.length > 100);
  const ids = KANA.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  const layoutIds = [...LAYOUT.gojuon, ...LAYOUT.dakuten, ...LAYOUT.yoon]
    .flat().filter(Boolean);
  const known = new Set(ids);
  for (const id of layoutIds) assert.ok(known.has(id), `unknown id ${id}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module './kana.js'`.

- [ ] **Step 3: Write `kana.js`**

Create `kana.js`:

```js
// 五十音 data + pure rōmaji match. Shared by browser and node tests.

const KANA = [
  // gojūon
  { id: 'a',  hira: 'あ', kata: 'ア', romaji: 'a',  aliases: [], group: 'gojuon' },
  { id: 'i',  hira: 'い', kata: 'イ', romaji: 'i',  aliases: [], group: 'gojuon' },
  { id: 'u',  hira: 'う', kata: 'ウ', romaji: 'u',  aliases: [], group: 'gojuon' },
  { id: 'e',  hira: 'え', kata: 'エ', romaji: 'e',  aliases: [], group: 'gojuon' },
  { id: 'o',  hira: 'お', kata: 'オ', romaji: 'o',  aliases: [], group: 'gojuon' },
  { id: 'ka', hira: 'か', kata: 'カ', romaji: 'ka', aliases: [], group: 'gojuon' },
  { id: 'ki', hira: 'き', kata: 'キ', romaji: 'ki', aliases: [], group: 'gojuon' },
  { id: 'ku', hira: 'く', kata: 'ク', romaji: 'ku', aliases: [], group: 'gojuon' },
  { id: 'ke', hira: 'け', kata: 'ケ', romaji: 'ke', aliases: [], group: 'gojuon' },
  { id: 'ko', hira: 'こ', kata: 'コ', romaji: 'ko', aliases: [], group: 'gojuon' },
  { id: 'sa',  hira: 'さ', kata: 'サ', romaji: 'sa',  aliases: [],     group: 'gojuon' },
  { id: 'shi', hira: 'し', kata: 'シ', romaji: 'shi', aliases: ['si'], group: 'gojuon' },
  { id: 'su',  hira: 'す', kata: 'ス', romaji: 'su',  aliases: [],     group: 'gojuon' },
  { id: 'se',  hira: 'せ', kata: 'セ', romaji: 'se',  aliases: [],     group: 'gojuon' },
  { id: 'so',  hira: 'そ', kata: 'ソ', romaji: 'so',  aliases: [],     group: 'gojuon' },
  { id: 'ta',  hira: 'た', kata: 'タ', romaji: 'ta',  aliases: [],     group: 'gojuon' },
  { id: 'chi', hira: 'ち', kata: 'チ', romaji: 'chi', aliases: ['ti'], group: 'gojuon' },
  { id: 'tsu', hira: 'つ', kata: 'ツ', romaji: 'tsu', aliases: ['tu'], group: 'gojuon' },
  { id: 'te',  hira: 'て', kata: 'テ', romaji: 'te',  aliases: [],     group: 'gojuon' },
  { id: 'to',  hira: 'と', kata: 'ト', romaji: 'to',  aliases: [],     group: 'gojuon' },
  { id: 'na', hira: 'な', kata: 'ナ', romaji: 'na', aliases: [], group: 'gojuon' },
  { id: 'ni', hira: 'に', kata: 'ニ', romaji: 'ni', aliases: [], group: 'gojuon' },
  { id: 'nu', hira: 'ぬ', kata: 'ヌ', romaji: 'nu', aliases: [], group: 'gojuon' },
  { id: 'ne', hira: 'ね', kata: 'ネ', romaji: 'ne', aliases: [], group: 'gojuon' },
  { id: 'no', hira: 'の', kata: 'ノ', romaji: 'no', aliases: [], group: 'gojuon' },
  { id: 'ha', hira: 'は', kata: 'ハ', romaji: 'ha', aliases: [],     group: 'gojuon' },
  { id: 'hi', hira: 'ひ', kata: 'ヒ', romaji: 'hi', aliases: [],     group: 'gojuon' },
  { id: 'fu', hira: 'ふ', kata: 'フ', romaji: 'fu', aliases: ['hu'], group: 'gojuon' },
  { id: 'he', hira: 'へ', kata: 'ヘ', romaji: 'he', aliases: [],     group: 'gojuon' },
  { id: 'ho', hira: 'ほ', kata: 'ホ', romaji: 'ho', aliases: [],     group: 'gojuon' },
  { id: 'ma', hira: 'ま', kata: 'マ', romaji: 'ma', aliases: [], group: 'gojuon' },
  { id: 'mi', hira: 'み', kata: 'ミ', romaji: 'mi', aliases: [], group: 'gojuon' },
  { id: 'mu', hira: 'む', kata: 'ム', romaji: 'mu', aliases: [], group: 'gojuon' },
  { id: 'me', hira: 'め', kata: 'メ', romaji: 'me', aliases: [], group: 'gojuon' },
  { id: 'mo', hira: 'も', kata: 'モ', romaji: 'mo', aliases: [], group: 'gojuon' },
  { id: 'ya', hira: 'や', kata: 'ヤ', romaji: 'ya', aliases: [], group: 'gojuon' },
  { id: 'yu', hira: 'ゆ', kata: 'ユ', romaji: 'yu', aliases: [], group: 'gojuon' },
  { id: 'yo', hira: 'よ', kata: 'ヨ', romaji: 'yo', aliases: [], group: 'gojuon' },
  { id: 'ra', hira: 'ら', kata: 'ラ', romaji: 'ra', aliases: [], group: 'gojuon' },
  { id: 'ri', hira: 'り', kata: 'リ', romaji: 'ri', aliases: [], group: 'gojuon' },
  { id: 'ru', hira: 'る', kata: 'ル', romaji: 'ru', aliases: [], group: 'gojuon' },
  { id: 're', hira: 'れ', kata: 'レ', romaji: 're', aliases: [], group: 'gojuon' },
  { id: 'ro', hira: 'ろ', kata: 'ロ', romaji: 'ro', aliases: [], group: 'gojuon' },
  { id: 'wa', hira: 'わ', kata: 'ワ', romaji: 'wa', aliases: [],    group: 'gojuon' },
  { id: 'wo', hira: 'を', kata: 'ヲ', romaji: 'wo', aliases: ['o'], group: 'gojuon' },
  { id: 'n',  hira: 'ん', kata: 'ン', romaji: 'n',  aliases: ['nn'], group: 'gojuon' },

  // dakuten / handakuten
  { id: 'ga', hira: 'が', kata: 'ガ', romaji: 'ga', aliases: [], group: 'dakuten' },
  { id: 'gi', hira: 'ぎ', kata: 'ギ', romaji: 'gi', aliases: [], group: 'dakuten' },
  { id: 'gu', hira: 'ぐ', kata: 'グ', romaji: 'gu', aliases: [], group: 'dakuten' },
  { id: 'ge', hira: 'げ', kata: 'ゲ', romaji: 'ge', aliases: [], group: 'dakuten' },
  { id: 'go', hira: 'ご', kata: 'ゴ', romaji: 'go', aliases: [], group: 'dakuten' },
  { id: 'za', hira: 'ざ', kata: 'ザ', romaji: 'za', aliases: [],     group: 'dakuten' },
  { id: 'ji', hira: 'じ', kata: 'ジ', romaji: 'ji', aliases: ['zi'], group: 'dakuten' },
  { id: 'zu', hira: 'ず', kata: 'ズ', romaji: 'zu', aliases: [],     group: 'dakuten' },
  { id: 'ze', hira: 'ぜ', kata: 'ゼ', romaji: 'ze', aliases: [],     group: 'dakuten' },
  { id: 'zo', hira: 'ぞ', kata: 'ゾ', romaji: 'zo', aliases: [],     group: 'dakuten' },
  { id: 'da',  hira: 'だ', kata: 'ダ', romaji: 'da', aliases: [],     group: 'dakuten' },
  { id: 'dji', hira: 'ぢ', kata: 'ヂ', romaji: 'ji', aliases: ['di'], group: 'dakuten' },
  { id: 'dzu', hira: 'づ', kata: 'ヅ', romaji: 'zu', aliases: ['du'], group: 'dakuten' },
  { id: 'de',  hira: 'で', kata: 'デ', romaji: 'de', aliases: [],     group: 'dakuten' },
  { id: 'do',  hira: 'ど', kata: 'ド', romaji: 'do', aliases: [],     group: 'dakuten' },
  { id: 'ba', hira: 'ば', kata: 'バ', romaji: 'ba', aliases: [], group: 'dakuten' },
  { id: 'bi', hira: 'び', kata: 'ビ', romaji: 'bi', aliases: [], group: 'dakuten' },
  { id: 'bu', hira: 'ぶ', kata: 'ブ', romaji: 'bu', aliases: [], group: 'dakuten' },
  { id: 'be', hira: 'べ', kata: 'ベ', romaji: 'be', aliases: [], group: 'dakuten' },
  { id: 'bo', hira: 'ぼ', kata: 'ボ', romaji: 'bo', aliases: [], group: 'dakuten' },
  { id: 'pa', hira: 'ぱ', kata: 'パ', romaji: 'pa', aliases: [], group: 'dakuten' },
  { id: 'pi', hira: 'ぴ', kata: 'ピ', romaji: 'pi', aliases: [], group: 'dakuten' },
  { id: 'pu', hira: 'ぷ', kata: 'プ', romaji: 'pu', aliases: [], group: 'dakuten' },
  { id: 'pe', hira: 'ぺ', kata: 'ペ', romaji: 'pe', aliases: [], group: 'dakuten' },
  { id: 'po', hira: 'ぽ', kata: 'ポ', romaji: 'po', aliases: [], group: 'dakuten' },

  // yōon
  { id: 'kya', hira: 'きゃ', kata: 'キャ', romaji: 'kya', aliases: [], group: 'yoon' },
  { id: 'kyu', hira: 'きゅ', kata: 'キュ', romaji: 'kyu', aliases: [], group: 'yoon' },
  { id: 'kyo', hira: 'きょ', kata: 'キョ', romaji: 'kyo', aliases: [], group: 'yoon' },
  { id: 'sha', hira: 'しゃ', kata: 'シャ', romaji: 'sha', aliases: ['sya'], group: 'yoon' },
  { id: 'shu', hira: 'しゅ', kata: 'シュ', romaji: 'shu', aliases: ['syu'], group: 'yoon' },
  { id: 'sho', hira: 'しょ', kata: 'ショ', romaji: 'sho', aliases: ['syo'], group: 'yoon' },
  { id: 'cha', hira: 'ちゃ', kata: 'チャ', romaji: 'cha', aliases: ['tya'], group: 'yoon' },
  { id: 'chu', hira: 'ちゅ', kata: 'チュ', romaji: 'chu', aliases: ['tyu'], group: 'yoon' },
  { id: 'cho', hira: 'ちょ', kata: 'チョ', romaji: 'cho', aliases: ['tyo'], group: 'yoon' },
  { id: 'nya', hira: 'にゃ', kata: 'ニャ', romaji: 'nya', aliases: [], group: 'yoon' },
  { id: 'nyu', hira: 'にゅ', kata: 'ニュ', romaji: 'nyu', aliases: [], group: 'yoon' },
  { id: 'nyo', hira: 'にょ', kata: 'ニョ', romaji: 'nyo', aliases: [], group: 'yoon' },
  { id: 'hya', hira: 'ひゃ', kata: 'ヒャ', romaji: 'hya', aliases: [], group: 'yoon' },
  { id: 'hyu', hira: 'ひゅ', kata: 'ヒュ', romaji: 'hyu', aliases: [], group: 'yoon' },
  { id: 'hyo', hira: 'ひょ', kata: 'ヒョ', romaji: 'hyo', aliases: [], group: 'yoon' },
  { id: 'mya', hira: 'みゃ', kata: 'ミャ', romaji: 'mya', aliases: [], group: 'yoon' },
  { id: 'myu', hira: 'みゅ', kata: 'ミュ', romaji: 'myu', aliases: [], group: 'yoon' },
  { id: 'myo', hira: 'みょ', kata: 'ミョ', romaji: 'myo', aliases: [], group: 'yoon' },
  { id: 'rya', hira: 'りゃ', kata: 'リャ', romaji: 'rya', aliases: [], group: 'yoon' },
  { id: 'ryu', hira: 'りゅ', kata: 'リュ', romaji: 'ryu', aliases: [], group: 'yoon' },
  { id: 'ryo', hira: 'りょ', kata: 'リョ', romaji: 'ryo', aliases: [], group: 'yoon' },
  { id: 'gya', hira: 'ぎゃ', kata: 'ギャ', romaji: 'gya', aliases: [], group: 'yoon' },
  { id: 'gyu', hira: 'ぎゅ', kata: 'ギュ', romaji: 'gyu', aliases: [], group: 'yoon' },
  { id: 'gyo', hira: 'ぎょ', kata: 'ギョ', romaji: 'gyo', aliases: [], group: 'yoon' },
  { id: 'ja',  hira: 'じゃ', kata: 'ジャ', romaji: 'ja',  aliases: ['jya'], group: 'yoon' },
  { id: 'ju',  hira: 'じゅ', kata: 'ジュ', romaji: 'ju',  aliases: ['jyu'], group: 'yoon' },
  { id: 'jo',  hira: 'じょ', kata: 'ジョ', romaji: 'jo',  aliases: ['jyo'], group: 'yoon' },
  { id: 'bya', hira: 'びゃ', kata: 'ビャ', romaji: 'bya', aliases: [], group: 'yoon' },
  { id: 'byu', hira: 'びゅ', kata: 'ビュ', romaji: 'byu', aliases: [], group: 'yoon' },
  { id: 'byo', hira: 'びょ', kata: 'ビョ', romaji: 'byo', aliases: [], group: 'yoon' },
  { id: 'pya', hira: 'ぴゃ', kata: 'ピャ', romaji: 'pya', aliases: [], group: 'yoon' },
  { id: 'pyu', hira: 'ぴゅ', kata: 'ピュ', romaji: 'pyu', aliases: [], group: 'yoon' },
  { id: 'pyo', hira: 'ぴょ', kata: 'ピョ', romaji: 'pyo', aliases: [], group: 'yoon' },
];

// Grid placement. null = empty cell.
const LAYOUT = {
  gojuon: [
    ['a',  'i',  'u',  'e',  'o'],
    ['ka', 'ki', 'ku', 'ke', 'ko'],
    ['sa', 'shi','su', 'se', 'so'],
    ['ta', 'chi','tsu','te', 'to'],
    ['na', 'ni', 'nu', 'ne', 'no'],
    ['ha', 'hi', 'fu', 'he', 'ho'],
    ['ma', 'mi', 'mu', 'me', 'mo'],
    ['ya', null, 'yu', null, 'yo'],
    ['ra', 'ri', 'ru', 're', 'ro'],
    ['wa', null, null, null, 'wo'],
    ['n',  null, null, null, null],
  ],
  dakuten: [
    ['ga', 'gi',  'gu',  'ge', 'go'],
    ['za', 'ji',  'zu',  'ze', 'zo'],
    ['da', 'dji', 'dzu', 'de', 'do'],
    ['ba', 'bi',  'bu',  'be', 'bo'],
    ['pa', 'pi',  'pu',  'pe', 'po'],
  ],
  yoon: [
    ['kya', 'kyu', 'kyo'],
    ['sha', 'shu', 'sho'],
    ['cha', 'chu', 'cho'],
    ['nya', 'nyu', 'nyo'],
    ['hya', 'hyu', 'hyo'],
    ['mya', 'myu', 'myo'],
    ['rya', 'ryu', 'ryo'],
    ['gya', 'gyu', 'gyo'],
    ['ja',  'ju',  'jo'],
    ['bya', 'byu', 'byo'],
    ['pya', 'pyu', 'pyo'],
  ],
};

// Case-insensitive prefix match on romaji + aliases. Empty query = no match.
function matchRomaji(query, entry) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return false;
  if (entry.romaji.startsWith(q)) return true;
  return entry.aliases.some(a => a.startsWith(q));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KANA, LAYOUT, matchRomaji };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add kana.js test.js
git commit -m "feat: kana data and matchRomaji logic with tests"
```

---

### Task 2: Page shell + static grid rendering

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `script.js`

**Interfaces:**
- Consumes: `KANA`, `LAYOUT` globals from `kana.js`.
- Produces: an `app` container populated with two `<section>`s (ひらがな, カタカナ), each holding three `.grid`s. Cells with a kana have class `cell` and `data-id`; empty slots have `cell empty`. Defines `byId` lookup reused by Task 3.

- [ ] **Step 1: Write `index.html`**

Create `index.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>五十音</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>五十音</h1>
    <input id="filter" type="text" placeholder="type rōmaji… (a, ka, shi, kya)"
           autocomplete="off" autocapitalize="off" spellcheck="false" autofocus>
  </header>
  <main id="app"></main>
  <script src="kana.js"></script>
  <script src="script.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `script.js` (render only)**

Create `script.js`:

```js
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
```

- [ ] **Step 3: Write `style.css` (base layout)**

Create `style.css`:

```css
:root {
  --bg: #faf7f2;
  --cell: #ffffff;
  --line: #e7e0d6;
  --text: #2b2b2b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1rem 4rem;
  background: var(--bg);
  color: var(--text);
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif;
}
header { max-width: 640px; margin: 0 auto 2rem; text-align: center; }
h1 { font-size: 2rem; margin: 0 0 1rem; letter-spacing: .12em; }
#filter {
  width: 100%;
  padding: .75rem 1rem;
  font-size: 1.1rem;
  border: 2px solid var(--line);
  border-radius: .6rem;
  outline: none;
}
main { max-width: 640px; margin: 0 auto; }
section { margin-bottom: 2.5rem; }
h2 { font-size: 1.05rem; font-weight: 600; margin: 0 0 .75rem; opacity: .7; }
.grid { display: grid; gap: .4rem; margin-bottom: 1rem; }
.grid.cols-5 { grid-template-columns: repeat(5, 1fr); }
.grid.cols-3 { grid-template-columns: repeat(3, 1fr); max-width: 60%; }
.cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  background: var(--cell);
  border: 1px solid var(--line);
  border-radius: .5rem;
}
.cell.empty { background: transparent; border: none; }
```

- [ ] **Step 4: Verify the page renders**

Open `index.html` in Chrome (via the claude-in-chrome tools or manually) and screenshot.
Expected: heading 五十音, a filter box, then ひらがな grids (gojūon 5-wide with visible gaps at や-row/わ-row/ん, dakuten, yōon 3-wide), then カタカナ grids. Kana only — no rōmaji visible.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css script.js
git commit -m "feat: render hiragana and katakana grids"
```

---

### Task 3: Filter highlighting

**Files:**
- Modify: `script.js` (append filter wiring)
- Modify: `style.css` (append match/dim styles)

**Interfaces:**
- Consumes: `byId`, `app` from Task 2; `matchRomaji` from `kana.js`; `#filter` input.
- Produces: on every input, cells with a matching id get `is-match`; when the box is non-empty, non-matching cells get `is-dim`; empty box clears both.

- [ ] **Step 1: Append filter wiring to `script.js`**

Add to the end of `script.js`:

```js
const filter = document.getElementById('filter');
const allCells = app.querySelectorAll('.cell[data-id]');

filter.addEventListener('input', () => {
  const q = filter.value.trim();
  const active = q.length > 0;
  allCells.forEach(c => {
    const hit = active && matchRomaji(q, byId[c.dataset.id]);
    c.classList.toggle('is-match', hit);
    c.classList.toggle('is-dim', active && !hit);
  });
});
```

- [ ] **Step 2: Append match/dim styles to `style.css`**

Add to the end of `style.css`:

```css
:root {
  --match: #ffd54a;
  --match-line: #e0a800;
}
#filter:focus { border-color: var(--match-line); }
.cell {
  transition: transform .12s ease, background .12s ease, opacity .12s ease;
}
.cell.is-match {
  background: var(--match);
  border-color: var(--match-line);
  transform: scale(1.08);
  font-weight: 700;
}
.cell.is-dim { opacity: .22; }
```

- [ ] **Step 3: Verify filtering behavior**

Open `index.html` in Chrome. Type in the filter box and screenshot each:
- `k` → all か-line + きゃ/きゅ/きょ highlighted in both scripts; everything else dimmed.
- `ku` → only く / ク highlighted.
- `si` → し / シ highlighted (alias).
- `sh` → し + しゃ/しゅ/しょ highlighted.
- clear the box → all cells back to normal, nothing dimmed.

- [ ] **Step 4: Re-run logic tests (regression guard)**

Run: `node --test`
Expected: PASS — Task 1 tests still green.

- [ ] **Step 5: Commit**

```bash
git add script.js style.css
git commit -m "feat: highlight kana matching typed romaji"
```

---

## Notes for the implementer

- `kana.js` uses top-level `const` so the browser shares `KANA`/`LAYOUT`/`matchRomaji` across classic scripts; the `module.exports` guard is for node only. Do not convert it to an ES module — that breaks `file://`.
- Prefix matching is intentional: one letter highlights a whole line. Do not change to exact-match.
- ぢ/づ share readings with じ/ず by design; they have distinct `id`s (`dji`/`dzu`) but matching `ji`/`zu` highlights both — expected.
