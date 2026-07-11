import { KANA } from './kana.js';
import { createTrainer } from './trainer.js';

// Kana deck: one card per glyph × script.
const byId = {};
for (const e of KANA) for (const s of ['hira', 'kata']) {
  const id = `${e.id}:${s}`;
  byId[id] = { id, e, script: s, glyph: s === 'hira' ? e.hira : e.kata };
}
const CARDS = Object.values(byId);

const deckBar = document.getElementById('deck-bar');
const PREF_KEY = 'anki-deck-v1';
const selectedScripts = () =>
  [...deckBar.querySelectorAll('input[name="script"]:checked')].map(c => c.value);

createTrainer({
  keys: { store: 'anki-fsrs-v1', stats: 'anki-stats-v2',
    pref: PREF_KEY, config: 'anki-config-v1' },
  cardById: byId,
  migrate() {
    try { localStorage.removeItem('anki-srs-v1'); localStorage.removeItem('anki-stats-v1'); }
    catch (e) {}
  },
  selectedIds() {
    const scripts = selectedScripts();
    return CARDS.filter(c => scripts.includes(c.script)).map(c => c.id);
  },
  setupDeckBar(onChange) {
    deckBar.querySelectorAll('input').forEach(i => i.addEventListener('change', () => {
      try { localStorage.setItem(PREF_KEY, JSON.stringify(selectedScripts())); } catch (e) {}
      onChange();
    }));
  },
  applyPref() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) {}
    if (!Array.isArray(saved)) return;
    for (const c of deckBar.querySelectorAll('input[name="script"]'))
      c.checked = saved.includes(c.value);
  },
  renderCard: c => ({
    badge: c.script === 'hira' ? 'ひらがな' : 'カタカナ',
    front: c.glyph,
    back: c.e.romaji,
  }),
  emptyDeckHint: '<p class="done-note">tick 平仮名 or 片仮名 above.</p>',
});
