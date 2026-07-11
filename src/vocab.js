import { VOCAB } from './vocab-data.js';
import { idsForLevels } from './vocab-deck.js';
import { rubyHTML, escapeHtml } from './furigana.js';
import { createTrainer } from './trainer.js';

// Vocab deck: recognition card, reading shown as furigana, recall the meaning.
const byId = Object.fromEntries(VOCAB.map(v => [v.id, v]));

const deckBar = document.getElementById('deck-bar');
const PREF_KEY = 'vocab-deck-v1';
const selectedLevels = () =>
  [...deckBar.querySelectorAll('input[name="level"]:checked')].map(c => c.value);

createTrainer({
  keys: { store: 'vocab-fsrs-v1', stats: 'vocab-stats-v2',
    pref: PREF_KEY, config: 'vocab-config-v1' },
  cardById: byId,
  selectedIds: () => idsForLevels(VOCAB, selectedLevels()),
  setupDeckBar(onChange) {
    deckBar.querySelectorAll('input').forEach(i => i.addEventListener('change', () => {
      try { localStorage.setItem(PREF_KEY, JSON.stringify(selectedLevels())); } catch (e) {}
      onChange();
    }));
  },
  applyPref() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) {}
    if (!Array.isArray(saved)) return;
    for (const c of deckBar.querySelectorAll('input[name="level"]'))
      c.checked = saved.includes(c.value);
  },
  renderCard: v => ({
    badge: v.level,
    front: rubyHTML(v.furigana),
    back: `<span lang="zh-Hant">${escapeHtml(v.meaning)}</span>`,
  }),
  emptyDeckHint: '<p class="done-note">tick a JLPT level above.</p>',
});
