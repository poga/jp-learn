// Study log: per-day review counts, streaks, retention. Pure, no deps.
// Days are epoch day-numbers (floor of ms/86400000), set by the page glue.

function newStats() {
  return { reviews: 0, again: 0, days: {}, log: [] };
}

// Fold one graded review into `today`; `wasReview` counts it against the review limit.
function recordReview(stats, grade, today, wasReview = false) {
  stats.reviews += 1;
  const day = stats.days[today] || { n: 0, again: 0 };
  day.n += 1;
  if (wasReview) day.rev = (day.rev || 0) + 1;
  if (grade === 'again') { stats.again += 1; day.again += 1; }
  stats.days[today] = day;
  return stats;
}

// Reviews logged on a given day.
function reviewsOn(stats, day) {
  return stats.days[day] ? stats.days[day].n : 0;
}

// Count a freshly-introduced new card for `today`; drives the per-day new cap.
function recordNew(stats, today) {
  const day = stats.days[today] || { n: 0, again: 0 };
  day.new = (day.new || 0) + 1;
  stats.days[today] = day;
  return stats;
}

// Append one review-log entry, keeping only the most recent `cap`.
function recordLog(stats, entry, cap = 5000) {
  stats.log.push(entry);
  if (stats.log.length > cap) stats.log.splice(0, stats.log.length - cap);
  return stats;
}

// Reverse one recorded review; floors at zero so undo can't go negative.
function unrecordReview(stats, grade, day, wasReview = false) {
  stats.reviews = Math.max(0, stats.reviews - 1);
  if (grade === 'again') stats.again = Math.max(0, stats.again - 1);
  const d = stats.days[day];
  if (!d) return stats;
  d.n = Math.max(0, d.n - 1);
  if (wasReview) d.rev = Math.max(0, (d.rev || 0) - 1);
  if (grade === 'again') d.again = Math.max(0, d.again - 1);
  return stats;
}

// Reverse one recorded new-card introduction.
function unrecordNew(stats, day) {
  const d = stats.days[day];
  if (d && d.new) d.new -= 1;
  return stats;
}

// Drop the most recent log entry.
function unrecordLog(stats) {
  if (Array.isArray(stats.log)) stats.log.pop();
  return stats;
}

// New cards introduced on a given day.
function newOn(stats, day) {
  return stats.days[day] && stats.days[day].new ? stats.days[day].new : 0;
}

// Review-queue cards answered on a given day; drives the daily review limit.
function revDoneOn(stats, day) {
  return stats.days[day] && stats.days[day].rev ? stats.days[day].rev : 0;
}

// Consecutive studied days ending today, or yesterday when today is untouched
// so an unstarted day doesn't read as a broken streak.
function currentStreak(stats, today) {
  let day = reviewsOn(stats, today) ? today
          : reviewsOn(stats, today - 1) ? today - 1 : null;
  if (day == null) return 0;
  let n = 0;
  while (reviewsOn(stats, day)) { n++; day--; }
  return n;
}

// Longest run of consecutive studied days on record.
function bestStreak(stats) {
  const days = Object.keys(stats.days).map(Number)
    .filter(d => stats.days[d].n > 0).sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev != null && d === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

// Share of reviews graded better than 'again'. null until there's data.
function retention(stats) {
  return stats.reviews ? (stats.reviews - stats.again) / stats.reviews : null;
}

export { newStats, recordReview, recordNew, newOn, revDoneOn, reviewsOn,
  recordLog, unrecordReview, unrecordNew, unrecordLog, currentStreak, bestStreak,
  retention };
