/**
 * dateUtils.js
 *
 * Lightweight date utilities (no external dependencies).
 */

/**
 * Returns the ISO date string (YYYY-MM-DD) for Monday of the current UTC week.
 * Weeks start on Monday per ISO-8601.
 */
function getUTCWeekStart() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const diff = (day + 6) % 7;  // days since Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

module.exports = { getUTCWeekStart };
