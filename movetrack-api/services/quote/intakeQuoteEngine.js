'use strict';

/**
 * services/quote/intakeQuoteEngine.js
 *
 * The vendor-priced intake quote engine (agentic intake Mode A, #107).
 *
 * DETERMINISTIC, NO LLM, NO I/O. Where the consumer estimate engine (#89,
 * /api/move/estimate) prices DIY-vs-pro from industry defaults, this one
 * prices a move from THE VENDOR'S OWN RATE CARD (rate_cards.data). Same
 * chassis — cubic feet → crew → hours → dollars — different authority.
 *
 * The whole engine is a pure function of its `inputs` object: the customer's
 * answers, the scanned-inventory snapshot, the resolved drive distance, and
 * the rate-card data snapshot. The route stores that exact object in
 * intake_quotes.inputs and this module's ENGINE_VERSION beside it, so every
 * quote is reproducible after the fact: computeQuote(storedInputs) ===
 * storedOutputs, forever (PRD R8). Anything nondeterministic (geocoding,
 * "today") happens in the route BEFORE the inputs object is frozen.
 *
 * Volume:
 *   - Scan path: same math as the #89 engine's inventory totals
 *     (L×W×H / 1728 per item × quantity); items with no dimensions count a
 *     conservative DEFAULT_ITEM_CUFT each so a half-measured scan never
 *     underprices to zero.
 *   - Q&A-only path: bedrooms → standard cu ft table (BEDROOM_CUFT).
 *
 * Honesty rails:
 *   - review-flag items (piano, safe, …), totals over the card's
 *     maxQuoteWithoutReview, and long-distance moves (hourly local pricing
 *     doesn't apply) all downgrade status to 'review_required' with plain
 *     copy — the price renders as an estimate an estimator will confirm,
 *     never a fake certainty.
 *   - NTE (not-to-exceed) = high end × (1 + nteMarginPct/100): the number
 *     the customer can hold the vendor to.
 */

const ENGINE_VERSION = 'intake-a-1.0.0';

// Q&A-only volume table (cu ft) — standard industry sizing.
const BEDROOM_CUFT = { studio: 250, '1': 400, '2': 700, '3': 1100, '4': 1500 };

// A scanned item with no measured dimensions still occupies space — count a
// conservative medium-box volume rather than zero.
const DEFAULT_ITEM_CUFT = 3;

// Handling throughput (load + unload combined), cu ft per crew-hour-of-work.
const CUFT_PER_HOUR_BY_CREW = { 2: 100, 3: 150, 4: 200 };

// Access-time adders, in hours.
const HOURS_PER_FLIGHT = 0.4;      // per flight of stairs, either end
const HOURS_PER_ELEVATOR_END = 0.35;
const HOURS_SHORT_WALK = 0.25;     // parking a short walk away
const HOURS_LONG_CARRY = 0.75;     // parking a long carry away

const DEFAULT_RANGE_PCT = 15;      // ± on billed hours
const LONG_DISTANCE_REVIEW_MILES = 100; // hourly local pricing stops applying

// A scanned item at/above this weight takes the card's heavyItem surcharge.
const HEAVY_ITEM_LBS = 200;

// Trust block: the fields a quote may NEVER render without. dba,
// fullValueOption and regulatorUrl are optional color; these are the law.
const TRUST_BLOCK_REQUIRED = [
  'legalName',
  'stateLicense',
  'usDot',
  'liabilityPerLb',
  'workedExample',
  'depositRule',
  'clockRules',
];

// ── Small helpers ────────────────────────────────────────────────────────────

const round2 = (n) => Math.round(n * 100) / 100;

/** Round hours UP to the card's billing increment (minutes), min the card's minimum. */
function billHours(rawHours, { minHours = 0, billingIncrementMin = 30 }) {
  const inc = billingIncrementMin > 0 ? billingIncrementMin / 60 : 0.5;
  const rounded = Math.ceil((rawHours - 1e-9) / inc) * inc;
  return round2(Math.max(rounded, minHours));
}

function normStr(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

// ── Trust block ──────────────────────────────────────────────────────────────

/**
 * Returns the list of missing/blank required trust-block fields ([] = valid).
 */
function missingTrustFields(trustBlock) {
  const tb = trustBlock && typeof trustBlock === 'object' ? trustBlock : {};
  return TRUST_BLOCK_REQUIRED.filter((f) => {
    const v = tb[f];
    if (f === 'liabilityPerLb') return !(Number(v) > 0);
    return !(typeof v === 'string' && v.trim().length > 0);
  });
}

// ── Volume ───────────────────────────────────────────────────────────────────

/**
 * Cubic feet for the move. Items win over bedrooms when a scan exists.
 * @returns {{ cuFt: number, source: 'inventory'|'bedrooms' }}
 */
function estimateCuFt({ items, bedrooms }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > 0) {
    let cuFt = 0;
    for (const it of list) {
      const qty = Number(it.quantity) > 0 ? Math.floor(Number(it.quantity)) : 1;
      const L = Number(it.lengthIn), W = Number(it.widthIn), H = Number(it.heightIn);
      if (L > 0 && W > 0 && H > 0) {
        cuFt += ((L * W * H) / 1728) * qty; // same math as #89 inventory totals
      } else {
        cuFt += DEFAULT_ITEM_CUFT * qty;
      }
    }
    return { cuFt: round2(cuFt), source: 'inventory' };
  }
  const key = String(bedrooms ?? '').toLowerCase();
  const cuFt = BEDROOM_CUFT[key] ?? BEDROOM_CUFT['2']; // unanswered → sane middle
  return { cuFt, source: 'bedrooms' };
}

/** Crew size from volume — thresholds per the demo spec. */
function crewForCuFt(cuFt) {
  if (cuFt <= 400) return 2;
  if (cuFt <= 900) return 3;
  return 4;
}

// ── Answers ──────────────────────────────────────────────────────────────────

/** Flights of stairs from a stairs answer ('none'|'1'|'2'|'3'|'elevator'). */
function flightsOf(v) {
  const s = normStr(v);
  if (s === '1') return 1;
  if (s === '2') return 2;
  if (s === '3' || s === '3+') return 3;
  return 0;
}

const isElevator = (v) => normStr(v) === 'elevator';

// ── Deposit ──────────────────────────────────────────────────────────────────

/**
 * Deposit in whole dollars from the rate card (#111). Two card shapes:
 *   depositPct    — percent of the quote's LOW end, rounded to dollars
 *                   (10% of a $1,151 low = $115);
 *   depositAmount — the original flat dollar figure (#108).
 * When both are present, depositPct WINS — a percentage that scales with the
 * job is the more honest instrument, and a card that adds one means it.
 * Neither present (or both ≤ 0) ⇒ 0: no deposit on this card.
 */
function depositFromCard(cardData, rangeLow) {
  const card = cardData && typeof cardData === 'object' ? cardData : {};
  const pct = Number(card.depositPct);
  if (pct > 0) return Math.round((Number(rangeLow) || 0) * (pct / 100));
  const flat = Number(card.depositAmount);
  return flat > 0 ? Math.round(flat) : 0;
}

// ── The engine ───────────────────────────────────────────────────────────────

/**
 * Compute a quote. PURE and deterministic: same inputs (including the same
 * rate-card data) ⇒ byte-identical outputs.
 *
 * @param {object} inputs
 * @param {object} inputs.answers   sanitized estimator answers:
 *   { bedrooms?, stairsOrigin?, stairsDestination?, parking?, packing?,
 *     specialItems?, moveDate?, originAddress?, destinationAddress? }
 * @param {Array}  inputs.items     scanned inventory snapshot:
 *   [{ name, quantity, weightLbs, lengthIn, widthIn, heightIn }]
 * @param {object|null} inputs.distance  resolved by the route when both
 *   addresses are known: { miles, driveHours } — null otherwise.
 * @param {object} inputs.rateCard  { version, data } — the card SNAPSHOT.
 * @returns {object} outputs — see the payload assembly at the bottom.
 */
function computeQuote(inputs) {
  const answers = (inputs && inputs.answers) || {};
  const items = Array.isArray(inputs && inputs.items) ? inputs.items : [];
  const distance = (inputs && inputs.distance) || null;
  const card = (inputs && inputs.rateCard && inputs.rateCard.data) || {};
  const rateCardVersion = (inputs && inputs.rateCard && inputs.rateCard.version) || null;

  const surcharges = card.surcharges || {};
  const hourlyByCrew = card.hourlyByCrew || {};
  const rangePct = Number(card.rangePct) > 0 ? Number(card.rangePct) : DEFAULT_RANGE_PCT;

  // 1. Volume → crew → hourly rate.
  const { cuFt, source: cuFtSource } = estimateCuFt({ items, bedrooms: answers.bedrooms });
  const crew = crewForCuFt(cuFt);
  const hourlyRate = Number(hourlyByCrew[crew]) || 0;

  // 2. Hours: handling + access + travel.
  const handlingHours = cuFt / CUFT_PER_HOUR_BY_CREW[crew];

  const flights = flightsOf(answers.stairsOrigin) + flightsOf(answers.stairsDestination);
  const elevatorEnds = (isElevator(answers.stairsOrigin) ? 1 : 0)
    + (isElevator(answers.stairsDestination) ? 1 : 0);
  const parking = normStr(answers.parking);
  const parkingHours = parking === 'long_carry' ? HOURS_LONG_CARRY
    : parking === 'short_walk' ? HOURS_SHORT_WALK : 0;
  const accessHours = flights * HOURS_PER_FLIGHT
    + elevatorEnds * HOURS_PER_ELEVATOR_END
    + parkingHours;

  const travelRule = card.travelRule || { type: 'flat', flatFee: 0 };
  const driveHours = distance && Number(distance.driveHours) > 0 ? Number(distance.driveHours) : 0;
  const travelHours = travelRule.type === 'double_drive_time' ? round2(driveHours * 2) : 0;

  const rawHours = handlingHours + accessHours + travelHours;
  const hoursBase = billHours(rawHours, card);
  const hoursLow = billHours(rawHours * (1 - rangePct / 100), card);
  const hoursHigh = billHours(rawHours * (1 + rangePct / 100), card);

  // 3. Line items.
  const lineItems = [];
  lineItems.push({
    key: 'labor',
    label: `${crew}-person crew × ${hoursLow}–${hoursHigh} hrs @ $${hourlyRate}/hr`,
    amountLow: Math.round(hoursLow * hourlyRate),
    amountHigh: Math.round(hoursHigh * hourlyRate),
  });

  const fee = (key, label, amount) => {
    if (Number(amount) > 0) {
      lineItems.push({ key, label, amountLow: Math.round(amount), amountHigh: Math.round(amount) });
    }
  };

  fee('truck', 'Truck fee', card.truckFee);
  if (flights > 0) {
    fee('stairs', `Stairs — ${flights} flight${flights === 1 ? '' : 's'}`,
      flights * (Number(surcharges.stairsPerFlight) || 0));
  }
  if (parking === 'long_carry') fee('long_carry', 'Long carry', surcharges.longCarry);

  const heavyCount = items.reduce((n, it) => {
    const qty = Number(it.quantity) > 0 ? Math.floor(Number(it.quantity)) : 1;
    return Number(it.weightLbs) >= HEAVY_ITEM_LBS ? n + qty : n;
  }, 0);
  if (heavyCount > 0) {
    fee('heavy_items', `Heavy item handling × ${heavyCount}`,
      heavyCount * (Number(surcharges.heavyItem) || 0));
  }

  if (normStr(answers.packing) === 'yes') fee('packing', 'Packing service', card.packingAddon);
  if (travelRule.type === 'flat') fee('travel', 'Travel fee', travelRule.flatFee);

  const feesTotal = lineItems
    .filter((li) => li.key !== 'labor')
    .reduce((sum, li) => sum + li.amountLow, 0);
  const rangeLow = Math.round(hoursLow * hourlyRate) + feesTotal;
  const rangeHigh = Math.round(hoursHigh * hourlyRate) + feesTotal;

  const nteMarginPct = Number(card.nteMarginPct) >= 0 ? Number(card.nteMarginPct) : 0;
  const nte = Math.round(rangeHigh * (1 + nteMarginPct / 100));

  // 4. Review flags — honest routing, never a silently confident price.
  const flagWords = (Array.isArray(card.reviewFlagItems) ? card.reviewFlagItems : [])
    .map(normStr).filter(Boolean);
  const reviewReasons = [];

  const flaggedNames = new Set();
  for (const it of items) {
    const name = normStr(it.name);
    for (const w of flagWords) {
      if (name.includes(w)) flaggedNames.add(w);
    }
  }
  const special = normStr(answers.specialItems);
  for (const w of flagWords) {
    if (special && special.includes(w)) flaggedNames.add(w);
  }
  if (flaggedNames.size > 0) {
    reviewReasons.push(`Special items (${[...flaggedNames].join(', ')}) need an estimator's eyes.`);
  }

  const maxNoReview = Number(card.maxQuoteWithoutReview);
  if (maxNoReview > 0 && rangeHigh > maxNoReview) {
    reviewReasons.push('A move this size gets a personal review before the price is final.');
  }

  const miles = distance && Number(distance.miles) > 0 ? Number(distance.miles) : 0;
  if (miles > LONG_DISTANCE_REVIEW_MILES) {
    reviewReasons.push('Long-distance moves are priced by an estimator, not by the hour.');
  }

  const status = reviewReasons.length > 0 ? 'review_required' : 'quoted';

  return {
    engineVersion: ENGINE_VERSION,
    rateCardVersion,
    cuFt,
    cuFtSource,
    itemCount: items.reduce((n, it) => n + (Number(it.quantity) > 0 ? Math.floor(Number(it.quantity)) : 1), 0),
    crew,
    hourlyRate,
    hours: {
      handling: round2(handlingHours),
      access: round2(accessHours),
      travel: travelHours,
      base: hoursBase,
      low: hoursLow,
      high: hoursHigh,
      rangePct,
    },
    distanceMiles: miles || null,
    lineItems,
    rangeLow,
    rangeHigh,
    nte,
    deposit: {
      amount: depositFromCard(card, rangeLow),
      refundWindowDays: Number(card.refundWindowDays) >= 0 ? Number(card.refundWindowDays) : null,
    },
    status,
    reviewReasons,
  };
}

// ── Estimator battery (PRD R2: never ask what we already know) ───────────────

const STAIRS_OPTIONS = [
  { value: 'none', label: 'No stairs' },
  { value: '1', label: '1 flight' },
  { value: '2', label: '2 flights' },
  { value: '3', label: '3+ flights' },
  { value: 'elevator', label: 'Elevator' },
];

/**
 * The question battery, minus anything the session already knows:
 *   - rooms scanned → the home-size (bedrooms) question is skipped;
 *   - origin address on file → the origin question is skipped.
 */
function buildQuestions({ hasInventory = false, hasOrigin = false } = {}) {
  const questions = [];

  if (!hasInventory) {
    questions.push({
      id: 'bedrooms',
      label: 'How big is your home?',
      type: 'chips',
      options: [
        { value: 'studio', label: 'Studio' },
        { value: '1', label: '1 bed' },
        { value: '2', label: '2 bed' },
        { value: '3', label: '3 bed' },
        { value: '4', label: '4+ bed' },
      ],
    });
  }

  if (!hasOrigin) {
    questions.push({
      id: 'originAddress',
      label: 'Where are you moving from?',
      type: 'address',
      placeholder: 'Street address or city',
    });
  }

  questions.push(
    {
      id: 'destinationAddress',
      label: 'Where are you moving to?',
      type: 'address',
      placeholder: 'Street address or city',
    },
    { id: 'stairsOrigin', label: 'Stairs at your current place?', type: 'chips', options: STAIRS_OPTIONS },
    { id: 'stairsDestination', label: 'Stairs at the new place?', type: 'chips', options: STAIRS_OPTIONS },
    {
      id: 'parking',
      label: 'How close can the truck park?',
      type: 'chips',
      options: [
        { value: 'right_outside', label: 'Right outside' },
        { value: 'short_walk', label: 'Short walk' },
        { value: 'long_carry', label: 'Long carry' },
      ],
    },
    {
      id: 'packing',
      label: 'Want the crew to pack for you?',
      type: 'chips',
      options: [
        { value: 'no', label: 'No, I’ll pack' },
        { value: 'yes', label: 'Yes, pack for me' },
      ],
    },
    {
      id: 'specialItems',
      label: 'Anything unusually heavy or delicate?',
      type: 'chips',
      options: [
        { value: 'none', label: 'Nothing special' },
        { value: 'piano', label: 'Piano' },
        { value: 'safe', label: 'Safe' },
        { value: 'pool table', label: 'Pool table' },
      ],
    },
    { id: 'moveDate', label: 'When are you moving?', type: 'date' },
  );

  return questions;
}

/** Whitelist + trim the raw answers body into exactly what the engine reads. */
function sanitizeAnswers(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const take = (key, max = 255) => {
    if (typeof src[key] === 'string' && src[key].trim()) out[key] = src[key].trim().slice(0, max);
  };
  take('bedrooms', 10);
  take('stairsOrigin', 20);
  take('stairsDestination', 20);
  take('parking', 20);
  take('packing', 10);
  take('specialItems', 60);
  take('moveDate', 20);
  take('originAddress');
  take('destinationAddress');
  return out;
}

module.exports = {
  ENGINE_VERSION,
  BEDROOM_CUFT,
  DEFAULT_ITEM_CUFT,
  CUFT_PER_HOUR_BY_CREW,
  TRUST_BLOCK_REQUIRED,
  LONG_DISTANCE_REVIEW_MILES,
  HEAVY_ITEM_LBS,
  estimateCuFt,
  crewForCuFt,
  billHours,
  missingTrustFields,
  depositFromCard,
  computeQuote,
  buildQuestions,
  sanitizeAnswers,
};
