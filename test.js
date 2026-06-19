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
