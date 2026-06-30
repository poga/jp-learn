// Study log: per-day review counts, streaks, retention. Pure, no deps.
// Days are epoch day-numbers (floor of ms/86400000), set by the page glue.

function newStats() {
  return { reviews: 0, again: 0, days: {}, log: [] };
}

// Fold one graded review into the log for `today`. `wasReview` marks a card that
// came from the review queue, so it counts against the daily review limit.
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

// Count a freshly-introduced new card for `today`. Drives the per-day new cap,
// which resets at midnight because each day gets its own bucket.
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
  recordLog, currentStreak, bestStreak, retention };
