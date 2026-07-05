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
 *
 * Plus the targeted-scan primitives (captions become instructions): a caption
 * intent classifier, the prompt section that carries the user's note to the
 * vision model, and a note-aware keep-list so an explicitly asked-for item
 * (a "murphy bed") is never dropped as a fixture.
 */

const { sanitizeForPrompt } = require('../promptSafety');

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

/**
 * Split items into movable goods vs house fixtures.
 *
 * `keepNote` (optional): the user's caption/note for a targeted scan. An item
 * whose name matches something the note explicitly names is NEVER dropped as
 * a fixture — a user who says "add this murphy bed" beats the built-in
 * pattern (e.g. a "Built-in murphy bed" would otherwise be filtered).
 */
function partitionFixtures(items, keepNote = null) {
  const kept = [];
  const fixtures = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    const drop = isFixture(it && it.name)
      && !(keepNote && noteNamesItem(keepNote, it && it.name));
    (drop ? fixtures : kept).push(it);
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

// ── Targeted scans — captions become instructions ────────────────────────────

// Captions that talk about the whole space / everything in view are FULL
// scans, whatever verbs they use ("add everything in this room").
const BROAD_CAPTION = /\b(?:everything|anything|all|entire|whole|rooms?|house|apartment|stuff|things?|items?|contents|inventory|scans?|scanning)\b/i;

// "just the X" / "only the X" — an explicit narrowing is a targeted ask.
const JUST_ONLY_RE = /\b(?:just|only)\s+(?:the|this|these|that|those|my|our|a|an)\s+\S+/i;

// An add-style verb followed by a named object ("add this queen sized murphy
// bed", "include the piano", "add murphy bed"). Leading politeness/articles
// are consumed so the captured word is the first content word after the verb.
const TARGET_VERB_RE = /\b(add|include|log|record)\b[\s,]+(?:(?:please|also|the|this|these|that|those|my|our|a|an)\s+)*([a-z][a-z0-9'-]*)/i;

// Captures that are NOT a named object — prepositions, pronouns, leftovers of
// the article group. "add to bedroom 2" names no item.
const NON_OBJECT_WORDS = new Set([
  'to', 'into', 'in', 'on', 'at', 'for', 'of', 'and', 'it', 'them', 'me', 'us', 'up',
  'more', 'some', 'another', 'what', 'whatever',
  'this', 'these', 'that', 'those', 'the', 'my', 'our', 'a', 'an',
]);

/**
 * Classify a scan caption: does it ask us to add SPECIFIC item(s) ('targeted'),
 * or is it a room label / narration / empty ('full')? Conservative by design —
 * anything ambiguous stays a full scan, which is today's behavior.
 */
function captionIntent(caption) {
  const text = String(caption || '').trim();
  if (!text) return 'full';
  if (BROAD_CAPTION.test(text)) return 'full';
  if (JUST_ONLY_RE.test(text)) return 'targeted';
  const m = text.match(TARGET_VERB_RE);
  if (m && !NON_OBJECT_WORDS.has(m[2].toLowerCase())) return 'targeted';
  return 'full';
}

const NOTE_MAX_CHARS = 500;

/**
 * Prompt section carrying the user's note to the vision model. Returns '' when
 * there is no note, so `PROMPT + buildScanNoteSection(null)` is byte-identical
 * to the bare prompt (the golden-set invariant). The note is sanitized
 * (promptSafety) and quote/backtick/brace-neutralized before templating.
 */
function buildScanNoteSection(note) {
  const safe = sanitizeForPrompt(String(note || '').trim(), NOTE_MAX_CHARS)
    .replace(/["“”]/g, "'")
    .replace(/[`{}]/g, '');
  if (!safe) return '';
  return `\n\nThe customer sent this media with a note: "${safe}". If the note names specific item(s) to add, THIS IS A TARGETED REQUEST: return ONLY the named item(s) — measure them from the media; ALSO include items the note attests are present but not visible (e.g. "a queen mattress inside"), with typical specs and low confidence. If other items are visible, do not list them. If the note names no specific items, catalog everything as usual.`;
}

/**
 * Does the note explicitly name this item? True when some contiguous phrase of
 * the note sameItemName-matches the item ("...this queen sized murphy bed..."
 * names "Built-in Murphy Bed"). Used as the fixture-filter keep-list.
 */
function noteNamesItem(note, itemName) {
  const nt = tokens(note).map(singular);
  if (nt.length === 0 || !itemName) return false;
  for (let len = 1; len <= 4; len++) {
    for (let i = 0; i + len <= nt.length; i++) {
      if (sameItemName(nt.slice(i, i + len).join(' '), itemName)) return true;
    }
  }
  return false;
}

module.exports = {
  isFixture,
  partitionFixtures,
  dedupeScanItems,
  sameItemName,
  captionIntent,
  buildScanNoteSection,
  noteNamesItem,
};
