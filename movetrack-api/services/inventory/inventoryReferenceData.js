'use strict';

/**
 * inventoryReferenceData.js
 *
 * Canonical reference data for household inventory gap analysis.
 * Consumed by inventoryMaturityService and agent prompts.
 */

/**
 * Expected rooms by home type. Used for gap analysis.
 * Keys are normalized: lowercase, spaces removed.
 */
const REFERENCE_ROOMS = {
  studio: ['Living Area', 'Kitchen', 'Bathroom'],
  '1bed': ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'],
  '2bed': ['Living Room', 'Kitchen', 'Bedroom 1', 'Bedroom 2', 'Bathroom', 'Hallway'],
  '3bed': ['Living Room', 'Kitchen', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bathroom 1', 'Bathroom 2', 'Hallway'],
  '4bed': ['Living Room', 'Kitchen', 'Dining Room', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4', 'Bathroom 1', 'Bathroom 2', 'Hallway', 'Garage'],
  house_default: ['Living Room', 'Kitchen', 'Dining Room', 'Bedroom 1', 'Bathroom', 'Garage', 'Hallway'],
};

/**
 * Typical items per room type. Keyed by lowercase room-name substring for fuzzy matching.
 * Use Object.keys(TYPICAL_ITEMS).find(k => roomName.includes(k)) to look up.
 */
const TYPICAL_ITEMS = {
  'living room': ['sofa', 'TV', 'coffee table', 'bookshelf', 'entertainment center', 'floor lamp', 'area rug', 'side table'],
  'kitchen': ['refrigerator', 'microwave', 'dining table', 'dining chairs', 'small appliances', 'pots and pans'],
  'bedroom': ['bed frame', 'mattress', 'nightstand', 'dresser', 'desk', 'desk chair', 'lamp', 'mirror'],
  'bathroom': ['toiletries', 'towels', 'bathroom shelving', 'hamper'],
  'dining room': ['dining table', 'dining chairs', 'china cabinet', 'buffet', 'chandelier'],
  'garage': ['tools', 'workbench', 'lawn equipment', 'bicycles', 'storage shelving', 'seasonal items'],
  'office': ['desk', 'desk chair', 'bookshelf', 'filing cabinet', 'monitor', 'printer'],
  'hallway': ['hall table', 'coat rack', 'mirror', 'shoe rack'],
  'laundry': ['washer', 'dryer', 'ironing board', 'laundry supplies'],
};

module.exports = {
  REFERENCE_ROOMS,
  TYPICAL_ITEMS,
};
