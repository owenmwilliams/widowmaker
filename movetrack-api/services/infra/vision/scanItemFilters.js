'use strict';

/**
 * scanItemFilters.js — precision dials for scan output (2026-07-03 beta round:
 * "we are over-identifying — the same item multiple times, and things that
 * would never be part of a move, like a toilet").
 *
 * Two deterministic backstops behind the prompt rules:
 *   1. partitionFixtures — drop items that stay with the house.
 *   2. dedupeScanItems  — collapse the same physical item reported under
 *      different names (within one scan / across chunk windows).
 */

// Fixtures stay with the house. Patterns are deliberately CONSERVATIVE —
// only unambiguous fixtures. Notably NOT filtered: mirrors (framed ones move),
// freestanding cabinets/shelves, curtains (rods stay, fabric moves), window
// AC units, and all major appliances (movers move fridges and washers).
const FIXTURE_PATTERNS = [
  /\btoilets?\b/,            // also catches "toilet paper holder" — fixture too
  /\bbidets?\b/,
  /\burinals?\b/,
  /\bbath ?tubs?\b/,
  /\bshowers? (?:stall|door|head|enclosure|pan)s?\b/,
  /^showers?$/,
  /\bfaucets?\b/,
  /^sinks?$/,
  /\b(?:kitchen|bathroom|vanity|utility) sinks?\b/,
  /\bcountertops?\b/,
  /\bbuilt[- ]?in\b/,
  /\bceiling (?:fans?|lights?)\b/,
  /\brecessed light(?:s|ing)?\b/,
  /\blight fixtures?\b/,
  /\bchandeliers?\b/,
  /\blight switch(?:es)?\b/,
  /\bpower outlets?\b/,
  /\bthermostats?\b/,
  /\bsmoke (?:detectors?|alarms?)\b/,
  /\bradiators?\b/,
  /\bwater heaters?\b/,
  /\bfurnaces?\b/,
  /\bfireplaces?\b/,
  /\btowel bars?\b/,
  /\bcurtain rods?\b/,
  /\bgrab bars?\b/,
  /^doors?$/,
  /(?:^|\s)(?:closet|interior|front|sliding|glass) doors?$/,
  /^windows?$/,
  /\bwindow (?:blinds?|shades?|shutters?)\b/,
  /(?:^|\s)blinds?$/,
];

function normName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isFixture(name) {
  const n = normName(name);
  if (!n) return false;
  return FIXTURE_PATTERNS.some((re) => re.test(n));
}

/** Split items into movable goods vs house fixtures. */
function partitionFixtures(items) {
  const kept = [];
  const fixtures = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    (isFixture(it && it.name) ? fixtures : kept).push(it);
  }
  return { kept, fixtures };
}

// ── Same-item collapse ───────────────────────────────────────────────────────

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'with', 'and', 'in', 'on', 'set']);

function tokens(name) {
  return normName(name).split(' ').filter((t) => t && !STOPWORDS.has(t));
}

function singular(t) {
  return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
}

/**
 * Two names describe the same physical item when they share the same HEAD
 * NOUN and one name's tokens are a subset of the other's:
 *   "sofa" ≈ "3-seat sofa";  "chair" ≈ "dining chair"
 * but "table lamp" ≠ "table" (different heads) and
 * "box of books" ≠ "box of dishes" (heads differ after stopwords).
 */
function sameItemName(a, b) {
  const ta = tokens(a).map(singular);
  const tb = tokens(b).map(singular);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const largeSet = new Set(large);
  return small.every((t) => largeSet.has(t));
}

/**
 * Collapse duplicate reports of the same item within one scan. Keeps the more
 * descriptive name, the larger quantity (a pan re-seeing the same sofa is the
 * same sofa — never sum), and the first entry's frame/picture.
 */
function dedupeScanItems(items) {
  const out = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    const room = normName(it && it.room);
    const match = out.find((o) => normName(o.room) === room && sameItemName(o.name, it.name));
    if (!match) {
      out.push(it);
      continue;
    }
    const q = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 1);
    if (q(it.quantity) > q(match.quantity)) match.quantity = it.quantity;
    if (tokens(it.name).length > tokens(match.name).length) match.name = it.name;
    if (!match.picture_url && it.picture_url) match.picture_url = it.picture_url;
    if (match.source_frame == null && it.source_frame != null) match.source_frame = it.source_frame;
  }
  return out;
}

module.exports = { isFixture, partitionFixtures, dedupeScanItems, sameItemName };
