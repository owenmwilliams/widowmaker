'use strict';

/**
 * itemSpecsReference.js
 *
 * Typical per-unit shipping weight (lbs) and bounding-box dimensions (inches,
 * L×W×H) for common household goods. Used as the free, instant first tier of
 * inventory estimation — no LLM call — so we can fill hundreds of ordinary items
 * (boxes, chairs, lamps…) at zero cost, and reserve model calls for the rest.
 *
 * Pure data + lookup helpers; safe to unit test.
 */

// Keyed by a lowercase substring of the item name; first match wins, so list
// more-specific keys before their generic forms (e.g. "sectional" before "sofa").
const ITEM_SPECS = {
  'sectional':           { w: 250, l: 110, wd: 40, h: 36 },
  'sofa bed':            { w: 200, l: 84,  wd: 38, h: 36 },
  'sleeper sofa':        { w: 200, l: 84,  wd: 38, h: 36 },
  'loveseat':            { w: 70,  l: 60,  wd: 38, h: 34 },
  'sofa':                { w: 100, l: 84,  wd: 38, h: 34 },
  'couch':               { w: 100, l: 84,  wd: 38, h: 34 },
  'futon':               { w: 120, l: 80,  wd: 38, h: 36 },
  'recliner':            { w: 90,  l: 40,  wd: 38, h: 42 },
  'armchair':            { w: 60,  l: 35,  wd: 35, h: 38 },
  'accent chair':        { w: 45,  l: 30,  wd: 30, h: 36 },
  'ottoman':             { w: 25,  l: 30,  wd: 24, h: 18 },
  'coffee table':        { w: 35,  l: 48,  wd: 24, h: 18 },
  'end table':           { w: 20,  l: 24,  wd: 24, h: 24 },
  'side table':          { w: 20,  l: 22,  wd: 22, h: 24 },
  'console table':       { w: 45,  l: 48,  wd: 16, h: 30 },
  'tv stand':            { w: 55,  l: 58,  wd: 18, h: 24 },
  'media console':       { w: 70,  l: 60,  wd: 18, h: 24 },
  'entertainment center':{ w: 120, l: 70,  wd: 20, h: 60 },
  'bookshelf':           { w: 70,  l: 36,  wd: 12, h: 72 },
  'bookcase':            { w: 70,  l: 36,  wd: 12, h: 72 },
  'dresser':             { w: 100, l: 60,  wd: 20, h: 34 },
  'chest of drawers':    { w: 90,  l: 44,  wd: 20, h: 44 },
  'nightstand':          { w: 30,  l: 24,  wd: 18, h: 26 },
  'wardrobe':            { w: 150, l: 48,  wd: 24, h: 72 },
  'armoire':             { w: 150, l: 48,  wd: 24, h: 72 },
  'vanity':              { w: 90,  l: 48,  wd: 20, h: 30 },
  'box spring':          { w: 50,  l: 80,  wd: 60, h: 9 },
  'crib mattress':       { w: 15,  l: 52,  wd: 28, h: 6 },
  'mattress':            { w: 60,  l: 80,  wd: 60, h: 12 },
  'bed frame':           { w: 80,  l: 84,  wd: 64, h: 48 },
  'headboard':           { w: 45,  l: 64,  wd: 4,  h: 48 },
  'crib':                { w: 50,  l: 54,  wd: 30, h: 42 },
  'desk':                { w: 80,  l: 48,  wd: 24, h: 30 },
  'office chair':        { w: 35,  l: 26,  wd: 26, h: 40 },
  'desk chair':          { w: 35,  l: 26,  wd: 26, h: 40 },
  'filing cabinet':      { w: 60,  l: 18,  wd: 24, h: 30 },
  'dining table':        { w: 120, l: 72,  wd: 40, h: 30 },
  'dining chair':        { w: 15,  l: 18,  wd: 20, h: 36 },
  'bar stool':           { w: 15,  l: 16,  wd: 16, h: 30 },
  'bench':               { w: 35,  l: 48,  wd: 16, h: 18 },
  'china cabinet':       { w: 150, l: 50,  wd: 18, h: 72 },
  'buffet':              { w: 120, l: 60,  wd: 20, h: 36 },
  'sideboard':           { w: 120, l: 60,  wd: 20, h: 36 },
  'refrigerator':        { w: 250, l: 36,  wd: 34, h: 70 },
  'fridge':              { w: 250, l: 36,  wd: 34, h: 70 },
  'freezer':             { w: 200, l: 30,  wd: 30, h: 60 },
  'washer':              { w: 180, l: 27,  wd: 30, h: 38 },
  'dryer':               { w: 130, l: 27,  wd: 30, h: 38 },
  'dishwasher':          { w: 80,  l: 24,  wd: 24, h: 35 },
  'microwave':           { w: 35,  l: 22,  wd: 18, h: 13 },
  'range':               { w: 130, l: 30,  wd: 28, h: 36 },
  'oven':                { w: 130, l: 30,  wd: 28, h: 36 },
  'stove':               { w: 130, l: 30,  wd: 28, h: 36 },
  'air conditioner':     { w: 60,  l: 24,  wd: 22, h: 16 },
  'television':          { w: 35,  l: 50,  wd: 4,  h: 30 },
  'tv':                  { w: 35,  l: 50,  wd: 4,  h: 30 },
  'piano':               { w: 400, l: 58,  wd: 24, h: 40 },
  'treadmill':           { w: 250, l: 72,  wd: 36, h: 55 },
  'exercise bike':       { w: 100, l: 48,  wd: 24, h: 50 },
  'elliptical':          { w: 180, l: 72,  wd: 30, h: 64 },
  'floor lamp':          { w: 15,  l: 14,  wd: 14, h: 60 },
  'table lamp':          { w: 8,   l: 12,  wd: 12, h: 24 },
  'lamp':                { w: 10,  l: 14,  wd: 14, h: 28 },
  'mirror':              { w: 25,  l: 36,  wd: 3,  h: 48 },
  'area rug':            { w: 30,  l: 96,  wd: 12, h: 12 },
  'rug':                 { w: 30,  l: 96,  wd: 12, h: 12 },
  'wardrobe box':        { w: 50,  l: 24,  wd: 21, h: 46 },
  'box':                 { w: 30,  l: 18,  wd: 18, h: 16 },
  'patio table':         { w: 50,  l: 48,  wd: 48, h: 29 },
  'grill':               { w: 100, l: 52,  wd: 24, h: 48 },
  'bicycle':             { w: 30,  l: 68,  wd: 24, h: 42 },
  'bike':                { w: 30,  l: 68,  wd: 24, h: 42 },
  'chest':               { w: 80,  l: 44,  wd: 20, h: 30 },
};

// Items whose weight/dimensions vary a lot AND drive the total — worth a
// photo-grounded estimate when a picture is available.
const LARGE_KEYWORDS = [
  'sectional', 'sofa', 'couch', 'loveseat', 'futon', 'sleeper',
  'refrigerator', 'fridge', 'freezer', 'washer', 'dryer', 'range', 'oven',
  'stove', 'dishwasher', 'mattress', 'bed', 'dresser', 'wardrobe', 'armoire',
  'dining table', 'desk', 'bookshelf', 'bookcase', 'china cabinet', 'buffet',
  'sideboard', 'piano', 'treadmill', 'elliptical', 'entertainment center',
  'vanity', 'chest', 'recliner',
  // Fragile / awkward / high-variance items where a straight-on photo matters:
  'tv', 'television', 'mirror', 'artwork', 'painting', 'framed', 'chandelier',
  'armchair', 'accent chair', 'lounge chair', 'pool table', 'crib', 'hutch',
  'aquarium', 'fish tank', 'grandfather clock',
];

const LARGE_WEIGHT_THRESHOLD = 70;

function specForName(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  const key = Object.keys(ITEM_SPECS).find((k) => lower.includes(k));
  return key ? { ...ITEM_SPECS[key] } : null;
}

/** A high-impact, high-variance item worth a photo-grounded estimate. */
function isLargeImpactItem(name) {
  if (!name) return false;
  const lower = String(name).toLowerCase();
  if (LARGE_KEYWORDS.some((k) => lower.includes(k))) return true;
  const spec = specForName(name);
  return !!spec && spec.w >= LARGE_WEIGHT_THRESHOLD;
}

module.exports = {
  ITEM_SPECS,
  specForName,
  isLargeImpactItem,
  LARGE_WEIGHT_THRESHOLD,
};
