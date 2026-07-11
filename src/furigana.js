// Furigana ruby: build-time alignment + runtime render. Pure, no deps.

const isKana = ch => /[぀-ヿ]/.test(ch);  // hiragana + katakana blocks

// Peel matching kana off both ends so only the kanji core carries furigana.
export function alignFurigana(word, reading) {
  let s = 0, e = word.length, rs = 0, re = reading.length;
  while (s < e && isKana(word[s]) && word[s] === reading[rs]) { s++; rs++; }
  while (e > s && isKana(word[e - 1]) && word[e - 1] === reading[re - 1]) { e--; re--; }
  const segs = [];
  if (s > 0) segs.push({ t: word.slice(0, s), r: '' });
  const core = word.slice(s, e), coreR = reading.slice(rs, re);
  if (core) segs.push({ t: core, r: [...core].every(isKana) ? '' : coreR });
  if (e < word.length) segs.push({ t: word.slice(e), r: '' });
  return segs.length ? segs : [{ t: word, r: '' }];
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Segments -> <ruby> markup; kana-only segments render as plain text.
export function rubyHTML(segs) {
  return segs.map(({ t, r }) => r
    ? `<ruby>${escapeHtml(t)}<rt>${escapeHtml(r)}</rt></ruby>`
    : escapeHtml(t)).join('');
}
