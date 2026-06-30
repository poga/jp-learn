// Study-day math with a configurable rollover hour. Pure. Browser global + node.
// Day N begins at `rolloverHour` local (Anki's default 4am), so a late-night
// session counts toward the day it started.

const DAY_MS = 86400000, HOUR_MS = 3600000;

// Local study-day index for an epoch-ms instant.
function dayOf(ms, rolloverHour = 0) {
  const off = new Date(ms).getTimezoneOffset() * 60000;
  return Math.floor((ms - off - rolloverHour * HOUR_MS) / DAY_MS);
}

// Epoch-ms instant a study-day begins (inverse of dayOf, modulo DST seams).
function dayStart(day, rolloverHour = 0) {
  const guess = day * DAY_MS + rolloverHour * HOUR_MS;
  const off = new Date(guess).getTimezoneOffset() * 60000;
  return guess + off;
}

export { dayOf, dayStart, DAY_MS, HOUR_MS };
