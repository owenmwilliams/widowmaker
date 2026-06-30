'use strict';

/**
 * inventoryBenchmarkService.js
 *
 * Deterministic "reasonableness" benchmark for a moving inventory. Given the
 * home size and the captured totals, it returns an expected weight/volume band
 * and a verdict — so we can catch obviously-broken inventories (e.g. a 3-bed
 * home that totals 92 lbs) BEFORE they're shared with movers.
 *
 * This is a SANITY BAND, not a quote. The goal is to flag order-of-magnitude
 * errors (missed rooms, mis-estimated item weights), not to price a move. All
 * bands are intentionally wide; we only want to surface the wildly-off.
 *
 * Pure functions, no DB — safe to unit test and to call from agents/routes.
 */

// Movers' rule of thumb: shipment weight ≈ 7 lbs per cubic foot of household
// goods. Used to translate the weight band into an expected volume band.
const LBS_PER_CUFT = 7;

// Expected total household-goods weight (lbs) by bedroom count. Wide bands —
// real homes vary a lot; these are derived from common moving-industry
// estimates (~1,000–1,500 lbs per furnished room).
const WEIGHT_BY_BEDROOMS = {
  0: { low: 1000, typical: 1800, high: 3000 },   // studio
  1: { low: 1800, typical: 3000, high: 5000 },
  2: { low: 3500, typical: 5500, high: 8000 },
  3: { low: 5500, typical: 8000, high: 12000 },
  4: { low: 8000, typical: 11000, high: 16000 },
  5: { low: 10000, typical: 14000, high: 20000 },
};

// How far past a band edge before we escalate "light/heavy" to "broken".
const TOO_LOW_FACTOR = 0.4;   // below 40% of the low edge ⇒ almost certainly incomplete
const TOO_HIGH_FACTOR = 1.6;  // above 160% of the high edge ⇒ likely duplicates/bad estimates

/**
 * Expected weight band for a bedroom count. Returns null if bedrooms is unknown,
 * so callers can prompt the user to add their home size.
 */
function weightBandForBedrooms(bedrooms) {
  if (bedrooms === null || bedrooms === undefined || !Number.isFinite(Number(bedrooms))) {
    return null;
  }
  const b = Math.max(0, Math.round(Number(bedrooms)));
  if (WEIGHT_BY_BEDROOMS[b]) return { ...WEIGHT_BY_BEDROOMS[b] };
  // Beyond the table, extrapolate ~3,000 lbs/bedroom past 5.
  const base = WEIGHT_BY_BEDROOMS[5];
  const extra = (b - 5) * 3000;
  return { low: base.low + extra, typical: base.typical + extra, high: base.high + extra };
}

function round(n) { return Math.round(Number(n) || 0); }

/**
 * Assess whether a total weight is plausible for a home of the given size.
 *
 * @param {object} input
 * @param {number|null} input.bedrooms       bedroom count (null = unknown)
 * @param {number}      input.actualWeightLbs measured + estimated total weight
 * @returns {{
 *   hasBenchmark: boolean, status: string, severity: string, message: string,
 *   expectedWeightLbs?: {low,typical,high}, expectedVolumeCuFt?: {low,typical,high},
 *   actualWeightLbs?: number, ratio?: number
 * }}
 *   status: 'unknown' | 'too_low' | 'low' | 'ok' | 'high' | 'too_high'
 *   severity: 'none' | 'low' | 'medium' | 'high'
 */
function assessWeightPlausibility({ bedrooms = null, actualWeightLbs = 0 } = {}) {
  const band = weightBandForBedrooms(bedrooms);
  if (!band) {
    return {
      hasBenchmark: false,
      status: 'unknown',
      severity: 'none',
      message: 'Add your home size (number of bedrooms) to enable a reasonableness check.',
    };
  }

  const actual = Math.max(0, Number(actualWeightLbs) || 0);
  const bedroomLabel = `${Math.max(0, Math.round(Number(bedrooms)))}-bedroom`;
  const typicalStr = band.typical.toLocaleString('en-US');
  const ratio = band.typical > 0 ? actual / band.typical : 0;

  let status, severity, message;
  if (actual < band.low * TOO_LOW_FACTOR) {
    status = 'too_low';
    severity = 'high';
    message = `Only ~${round(actual)} lbs logged for a ${bedroomLabel} home, which usually totals around ${typicalStr} lbs. You've likely missed rooms or items — worth a second pass before sharing.`;
  } else if (actual < band.low) {
    status = 'low';
    severity = 'medium';
    message = `~${round(actual)} lbs is on the light side for a ${bedroomLabel} home (typically ~${typicalStr} lbs). Double-check for missed rooms or items.`;
  } else if (actual > band.high * TOO_HIGH_FACTOR) {
    status = 'too_high';
    severity = 'high';
    message = `~${round(actual)} lbs is far above the ~${typicalStr} lbs typical for a ${bedroomLabel} home — check for duplicate or over-estimated items.`;
  } else if (actual > band.high) {
    status = 'high';
    severity = 'medium';
    message = `~${round(actual)} lbs is on the heavy side for a ${bedroomLabel} home (typically ~${typicalStr} lbs).`;
  } else {
    status = 'ok';
    severity = 'none';
    message = `~${round(actual)} lbs is in the expected range for a ${bedroomLabel} home.`;
  }

  return {
    hasBenchmark: true,
    status,
    severity,
    message,
    expectedWeightLbs: { low: round(band.low), typical: round(band.typical), high: round(band.high) },
    expectedVolumeCuFt: {
      low: round(band.low / LBS_PER_CUFT),
      typical: round(band.typical / LBS_PER_CUFT),
      high: round(band.high / LBS_PER_CUFT),
    },
    actualWeightLbs: round(actual),
    ratio: Math.round(ratio * 100) / 100,
  };
}

// Lower-bound sanity weights (lbs per unit) for commonly-mis-estimated large
// items. Keyed by lowercase substring; first match wins. Used only to flag items
// whose estimate is implausibly light — never to overwrite the user's value.
const TYPICAL_UNIT_WEIGHTS_LBS = {
  'refrigerator': 250, 'fridge': 250, 'freezer': 200,
  'washer': 180, 'dryer': 130, 'range': 130, 'oven': 130, 'dishwasher': 80,
  'sectional': 200, 'sofa': 100, 'couch': 100, 'loveseat': 70, 'recliner': 90,
  'mattress': 60, 'bed frame': 80, 'bed': 90,
  'dresser': 100, 'wardrobe': 150, 'armoire': 150, 'china cabinet': 150,
  'dining table': 120, 'desk': 80, 'bookshelf': 70, 'bookcase': 70,
  'piano': 400, 'treadmill': 250, 'television': 35, 'tv': 35,
};

function typicalUnitWeight(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  const key = Object.keys(TYPICAL_UNIT_WEIGHTS_LBS).find((k) => lower.includes(k));
  return key ? TYPICAL_UNIT_WEIGHTS_LBS[key] : null;
}

/**
 * Flag large items whose unit weight is implausibly light (or missing) versus a
 * typical weight for that item type. Catches the "sofa: 2 lbs" failure mode.
 *
 * @param {Array<{name:string, weight_lbs?:number, weightLbs?:number}>} items
 * @returns {Array<{name, unitWeightLbs:number|null, typicalLbs:number, reason:string}>}
 */
function flagWeightOutliers(items = []) {
  const flags = [];
  for (const item of items) {
    const typical = typicalUnitWeight(item && item.name);
    if (!typical) continue;
    const unit = Number(item.weight_lbs ?? item.weightLbs);
    if (!Number.isFinite(unit) || unit <= 0) {
      flags.push({ name: item.name, unitWeightLbs: null, typicalLbs: typical, reason: 'missing_weight' });
    } else if (unit < typical * 0.3) {
      flags.push({ name: item.name, unitWeightLbs: unit, typicalLbs: typical, reason: 'too_light' });
    }
  }
  return flags;
}

module.exports = {
  LBS_PER_CUFT,
  WEIGHT_BY_BEDROOMS,
  weightBandForBedrooms,
  assessWeightPlausibility,
  typicalUnitWeight,
  flagWeightOutliers,
};
