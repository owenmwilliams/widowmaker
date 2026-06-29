'use strict';

/**
 * services/infra/pagination.js
 *
 * Safe pagination parsing for list endpoints. The "get all" inventory endpoints
 * previously returned every row with no bound, risking full-table scans and huge
 * payloads for accounts with very large inventories. This applies a hard safety
 * ceiling (and opt-in limit/offset paging) without changing behaviour for normal
 * accounts: when no limit is supplied the default IS the ceiling, so any account
 * at or below the ceiling sees the same full result it did before.
 */

const SAFETY_CAP = 5000;

/**
 * Parse and clamp pagination params from a request query.
 * @param {object} query - req.query
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit] - limit used when none/invalid is supplied (defaults to maxLimit)
 * @param {number} [opts.maxLimit] - hard ceiling (defaults to SAFETY_CAP)
 * @returns {{limit: number, offset: number}}
 */
function parsePagination(query = {}, { defaultLimit, maxLimit = SAFETY_CAP } = {}) {
  const ceiling = Math.max(1, maxLimit);
  const fallback = defaultLimit && defaultLimit > 0 ? Math.min(defaultLimit, ceiling) : ceiling;

  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = fallback;
  limit = Math.min(limit, ceiling);

  let offset = parseInt(query.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  return { limit, offset };
}

module.exports = { parsePagination, SAFETY_CAP };
