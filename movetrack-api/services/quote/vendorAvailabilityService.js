'use strict';

/**
 * services/quote/vendorAvailabilityService.js
 *
 * check_availability v1 (Mode B-lite, W1c #117): can this company take a
 * move on a given date, and if not, what are the nearest open days?
 *
 * The calendar consulted here is the company's NEXUS booking calendar —
 * capacity_per_day minus the booking_reservations already holding a slot
 * (status 'pending_confirmation' or 'confirmed'; declined/expired rows free
 * their slot). blackout_days ('YYYY-MM-DD' strings on the company row) and
 * past dates are never open. External calendar sync is W2/Mode B — every
 * surface that renders this result says "the company's booking calendar",
 * not "their Google Calendar".
 *
 * DETERMINISTIC and unit-testable: all I/O is two parameterized reads, and
 * "today" is injectable. Alternative-day policy when the requested date is
 * closed (and to round out the answer when it's open):
 *   - scan the ±7-day window around the requested date first, nearest days
 *     first, FORWARD-WEIGHTED (a tie between date+2 and date-2 proposes
 *     date+2 first — movers would rather push a move back than pull the
 *     packing deadline in);
 *   - if fewer than MAX_ALTERNATIVES open days exist in that window, keep
 *     walking forward (up to +30 days) — never further into the past;
 *   - at most 3 proposals, each a real open day (not past, not blacked out,
 *     spots remaining).
 *
 * Returned shape (the `availability` event payload every surface renders
 * as DATA — tappable date chips, never model prose):
 *   {
 *     requestedDate:      'YYYY-MM-DD',
 *     requestedDateOpen:  boolean,
 *     reason:             null | 'past_date' | 'blackout' | 'fully_booked',
 *     capacityPerDay:     number,
 *     alternatives:       ['YYYY-MM-DD', …]   // ≤3, nearest-first
 *   }
 *
 * Throws IntakeAgentError('invalid_input') for a malformed date so both the
 * MCP tool and the converse brain surface honest copy, never a stack trace.
 */

const { db } = require('../infra/db');
const { IntakeAgentError } = require('./intakeAgentService');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NEAR_WINDOW_DAYS = 7;   // preferred ± scan window
const FORWARD_EXTEND_DAYS = 30; // how far forward we'll walk when ±7 is dry
const MAX_ALTERNATIVES = 3;

/** 'YYYY-MM-DD' → UTC ms at midnight (NaN when malformed). */
function dayMs(iso) {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

/** UTC ms → 'YYYY-MM-DD'. */
function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Availability for one company on one date, plus up to 3 alternative days.
 *
 * @param {string} companyId
 * @param {string} requestedDate  'YYYY-MM-DD'
 * @param {object} [opts]
 * @param {string} [opts.today]   injectable 'today' (YYYY-MM-DD) for tests;
 *                                defaults to the real current UTC date.
 * @throws {IntakeAgentError} invalid_input (400) on a malformed date;
 *         company_not_found (404) when the company row is gone.
 */
async function checkAvailability(companyId, requestedDate, { today } = {}) {
  const date = typeof requestedDate === 'string' ? requestedDate.trim() : '';
  // Round-trip check catches JS Date leniency ('2026-02-30' → Mar 2).
  if (!DATE_RE.test(date) || Number.isNaN(dayMs(date)) || isoDay(dayMs(date)) !== date) {
    throw new IntakeAgentError(
      'invalid_input',
      'requestedDate must be a real date in YYYY-MM-DD form.',
      { statusCode: 400 }
    );
  }

  const company = await db.oneOrNone(
    `SELECT capacity_per_day, blackout_days FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!company) {
    throw new IntakeAgentError('company_not_found', 'This company is not available right now.', { statusCode: 404 });
  }

  const capacity = Number(company.capacity_per_day) > 0 ? Math.floor(Number(company.capacity_per_day)) : 0;
  const blackouts = new Set(
    (Array.isArray(company.blackout_days) ? company.blackout_days : [])
      .filter((d) => typeof d === 'string' && DATE_RE.test(d))
  );

  const todayIso = typeof today === 'string' && DATE_RE.test(today)
    ? today
    : new Date().toISOString().slice(0, 10);
  const todayT = dayMs(todayIso);
  const reqT = dayMs(date);

  // One read covers the whole scan window: requested ± NEAR plus the forward
  // extension. Counting pending_confirmation AND confirmed is deliberate —
  // a pending reservation holds its slot until it's declined or expires.
  const windowStart = isoDay(Math.max(todayT, reqT - NEAR_WINDOW_DAYS * DAY));
  const windowEnd = isoDay(reqT + FORWARD_EXTEND_DAYS * DAY);
  const rows = await db.any(
    `SELECT requested_date::text AS day, COUNT(*)::int AS booked
     FROM booking_reservations
     WHERE company_id = $1
       AND status IN ('pending_confirmation', 'confirmed')
       AND requested_date BETWEEN $2 AND $3
     GROUP BY requested_date`,
    [companyId, windowStart, windowEnd]
  );
  const bookedByDay = new Map(rows.map((r) => [String(r.day).slice(0, 10), Number(r.booked)]));

  const isOpen = (iso, t) => {
    if (t <= todayT) return false;              // past — and never same-day
    if (blackouts.has(iso)) return false;
    return (bookedByDay.get(iso) || 0) < capacity;
  };

  let reason = null;
  const requestedOpen = isOpen(date, reqT);
  if (!requestedOpen) {
    if (reqT <= todayT) reason = 'past_date';
    else if (blackouts.has(date)) reason = 'blackout';
    else reason = 'fully_booked';
  }

  // Nearest-first, forward-weighted: +1, -1, +2, -2, … out to ±7, then
  // forward-only +8…+30 until MAX_ALTERNATIVES are found.
  const alternatives = [];
  const consider = (offsetDays) => {
    if (alternatives.length >= MAX_ALTERNATIVES) return;
    const t = reqT + offsetDays * DAY;
    const iso = isoDay(t);
    if (isOpen(iso, t)) alternatives.push(iso);
  };
  for (let d = 1; d <= NEAR_WINDOW_DAYS && alternatives.length < MAX_ALTERNATIVES; d++) {
    consider(d);
    consider(-d);
  }
  for (let d = NEAR_WINDOW_DAYS + 1; d <= FORWARD_EXTEND_DAYS && alternatives.length < MAX_ALTERNATIVES; d++) {
    consider(d);
  }

  return {
    requestedDate: date,
    requestedDateOpen: requestedOpen,
    reason,
    capacityPerDay: capacity,
    alternatives,
  };
}

module.exports = {
  checkAvailability,
  NEAR_WINDOW_DAYS,
  FORWARD_EXTEND_DAYS,
  MAX_ALTERNATIVES,
};
