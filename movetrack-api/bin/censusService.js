'use strict';

const conn = require('./db');
const db = conn.db;

// ── Reference Data ──────────────────────────────────────────────────────────────

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
 * Typical items per room type. Used for gap analysis prompts.
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

// ── Inventory Snapshot ──────────────────────────────────────────────────────────

/**
 * Build a compact text summary of the user's entire inventory.
 * Designed to fit in a Gemini system prompt without consuming too many tokens.
 */
async function getInventorySnapshot(userId) {
  const locations = await db.any(
    `SELECT id, name, address, city, state, location_type
     FROM locations WHERE user_id = $1 ORDER BY created_at`, [userId]
  );

  if (locations.length === 0) {
    return 'No locations, rooms, or items yet. This is a new user.';
  }

  const collections = await db.any(
    `SELECT c.id, c.name, c.location_id, COUNT(i.id) AS item_count,
            COALESCE(SUM(i.weight_lbs * i.quantity), 0) AS total_weight
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id ORDER BY c.name`, [userId]
  );

  const items = await db.any(
    `SELECT i.name, i.quantity, i.weight_lbs, i.collection_id,
            i.length_in, i.width_in, i.height_in, i.fragile, i.notes
     FROM items i WHERE i.user_id = $1 ORDER BY i.collection_id, i.name`, [userId]
  );

  let totalWeight = 0;
  let totalVolume = 0;
  let totalItems = 0;

  const lines = [];

  for (const loc of locations) {
    const addr = [loc.address, loc.city, loc.state].filter(Boolean).join(', ');
    lines.push(`Location: "${loc.name}" (${loc.location_type})${addr ? ' — ' + addr : ''}`);

    const roomsInLoc = collections.filter(c => String(c.location_id) === String(loc.id));
    if (roomsInLoc.length === 0) {
      lines.push('  No rooms yet.');
    }
    for (const room of roomsInLoc) {
      lines.push(`  Room: "${room.name}" — ${room.item_count} items, ${Math.round(room.total_weight)} lbs`);
      const roomItems = items.filter(i => String(i.collection_id) === String(room.id));
      for (const item of roomItems) {
        totalItems += item.quantity || 1;
        totalWeight += (item.weight_lbs || 0) * (item.quantity || 1);
        if (item.length_in && item.width_in && item.height_in) {
          totalVolume += (item.length_in * item.width_in * item.height_in / 1728) * (item.quantity || 1);
        }
        const details = [];
        if (item.quantity > 1) details.push(`qty: ${item.quantity}`);
        if (item.weight_lbs) details.push(`${item.weight_lbs} lbs`);
        if (item.fragile) details.push('fragile');
        lines.push(`    - ${item.name}${details.length ? ' (' + details.join(', ') + ')' : ''}`);
      }
    }
  }

  lines.push('');
  lines.push(`Totals: ${totalItems} items, ~${Math.round(totalWeight)} lbs, ~${Math.round(totalVolume)} cu ft`);

  return lines.join('\n');
}

// ── Gap Analysis ────────────────────────────────────────────────────────────────

/**
 * Compare existing rooms against what's expected for a home of this type/size.
 * Returns { missingRooms, suggestions }.
 */
function getMissingContext(existingRoomNames, homeType, bedroomCount, bathroomCount) {
  // Determine reference key
  let refKey = 'house_default';
  const bedrooms = bedroomCount || 1;
  if (homeType === 'studio') {
    refKey = 'studio';
  } else if (bedrooms <= 4) {
    refKey = `${bedrooms}bed`;
  }

  const expectedRooms = REFERENCE_ROOMS[refKey] || REFERENCE_ROOMS.house_default;
  const normalizedExisting = existingRoomNames.map(r => r.toLowerCase().trim());

  const missingRooms = expectedRooms.filter(room => {
    const lower = room.toLowerCase();
    // Fuzzy match: "bedroom 1" matches "master bedroom", "bedroom" matches "main bedroom", etc.
    return !normalizedExisting.some(existing =>
      existing.includes(lower) || lower.includes(existing) ||
      (lower.includes('bedroom') && existing.includes('bedroom')) ||
      (lower.includes('bathroom') && existing.includes('bathroom'))
    );
  });

  // Suggest typical items for rooms that exist but have few items
  const suggestions = [];
  for (const room of normalizedExisting) {
    const typicalKey = Object.keys(TYPICAL_ITEMS).find(k => room.includes(k));
    if (typicalKey) {
      suggestions.push({
        room,
        typicalItems: TYPICAL_ITEMS[typicalKey],
      });
    }
  }

  return { missingRooms, suggestions, expectedRooms };
}

/**
 * Get typical items for a room type.
 */
function getTypicalItems(roomName) {
  const lower = roomName.toLowerCase().trim();
  const key = Object.keys(TYPICAL_ITEMS).find(k => lower.includes(k));
  return key ? TYPICAL_ITEMS[key] : [];
}

/**
 * Score confidence based on how the item was identified.
 */
function scoreConfidence(source, hasDetails) {
  if (source === 'explicit' && hasDetails) return 0.95;
  if (source === 'explicit') return 0.9;
  if (source === 'photo') return 0.75;
  if (source === 'inferred') return 0.5;
  return 0.6;
}

module.exports = {
  getInventorySnapshot,
  getMissingContext,
  getTypicalItems,
  scoreConfidence,
  REFERENCE_ROOMS,
  TYPICAL_ITEMS,
};
