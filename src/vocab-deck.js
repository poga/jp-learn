// Vocab deck: JLPT levels and the pure level -> card-id filter.
export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

export function idsForLevels(cards, levels) {
  return cards.filter(c => levels.includes(c.level)).map(c => c.id);
}
