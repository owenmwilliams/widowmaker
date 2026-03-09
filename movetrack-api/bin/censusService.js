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

/**
 * Analyze inventory state and return contextual conversation starters.
 * Used to give Nexus a smart opening message for new sessions.
 */
async function getConversationStarters(userId) {
  const locations = await db.any(
    `SELECT id, name, location_type FROM locations WHERE user_id = $1`, [userId]
  );
  const collections = await db.any(
    `SELECT c.id, c.name, c.location_id, COUNT(i.id)::int AS item_count
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id`, [userId]
  );
  const itemStats = await db.oneOrNone(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN weight_lbs IS NULL OR weight_lbs = 0 THEN 1 END)::int AS missing_weight,
            COUNT(CASE WHEN length_in IS NULL OR width_in IS NULL OR height_in IS NULL THEN 1 END)::int AS missing_dimensions,
            COUNT(CASE WHEN picture_url IS NULL OR picture_url = '' THEN 1 END)::int AS missing_photos
     FROM items WHERE user_id = $1`, [userId]
  ) || { total: 0, missing_weight: 0, missing_dimensions: 0, missing_photos: 0 };

  // Get largest items missing measurements
  const largestWithoutMeasurements = await db.any(
    `SELECT name, weight_lbs FROM items
     WHERE user_id = $1 AND (length_in IS NULL OR width_in IS NULL OR height_in IS NULL)
     ORDER BY COALESCE(weight_lbs, 0) DESC LIMIT 5`, [userId]
  );

  const starters = [];

  // No locations at all
  if (locations.length === 0) {
    starters.push('NEW_USER: No locations set up yet. Start with onboarding flow.');
    return starters;
  }

  // Single location, no move destination
  if (locations.length === 1) {
    starters.push(`SINGLE_LOCATION: User only has "${locations[0].name}". Ask if they are planning a move soon or if they'd like to add a destination.`);
  }

  // Empty rooms
  const emptyRooms = collections.filter(c => c.item_count === 0);
  if (emptyRooms.length > 0) {
    const names = emptyRooms.map(r => `"${r.name}"`).join(', ');
    starters.push(`EMPTY_ROOMS: ${emptyRooms.length} room(s) have no items: ${names}. Ask if they'd like to catalog these rooms.`);
  }

  // Items missing measurements
  if (largestWithoutMeasurements.length > 0 && itemStats.missing_dimensions > 3) {
    const itemNames = largestWithoutMeasurements.slice(0, 3).map(i => `"${i.name}"`).join(', ');
    starters.push(`MISSING_DIMENSIONS: ${itemStats.missing_dimensions} items are missing dimensions. Largest ones: ${itemNames}. Offer to help estimate measurements for these.`);
  }

  // Items missing weight
  if (itemStats.missing_weight > 5) {
    starters.push(`MISSING_WEIGHT: ${itemStats.missing_weight} of ${itemStats.total} items have no weight estimate. Offer to help fill these in.`);
  }

  // Items missing photos
  if (itemStats.total > 10 && itemStats.missing_photos > itemStats.total * 0.7) {
    starters.push(`MISSING_PHOTOS: ${itemStats.missing_photos} of ${itemStats.total} items have no photo. Suggest taking photos room by room.`);
  }

  // Good progress
  if (itemStats.total > 20 && emptyRooms.length === 0 && itemStats.missing_dimensions < 3) {
    starters.push(`GREAT_PROGRESS: Inventory looks solid with ${itemStats.total} items. Ask if they'd like a summary, want to review anything, or are ready to plan their move.`);
  }

  // Low item count with rooms
  if (collections.length > 0 && itemStats.total < 5 && itemStats.total > 0) {
    starters.push(`GETTING_STARTED: Only ${itemStats.total} items logged across ${collections.length} rooms. Encourage them to keep going — offer to work room by room.`);
  }

  return starters;
}

// ── Quick-Start Chips ────────────────────────────────────────────────────────────

/**
 * Return up to 3 contextual quick-start chips based on inventory state.
 * Each chip has { label, message } — label is what the user sees, message is sent on click.
 */
async function getQuickStartChips(userId) {
  const locations = await db.any(
    `SELECT id, name FROM locations WHERE user_id = $1`, [userId]
  );
  const collections = await db.any(
    `SELECT c.id, c.name, COUNT(i.id)::int AS item_count
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id`, [userId]
  );
  const itemStats = await db.oneOrNone(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN weight_lbs IS NULL OR weight_lbs = 0 THEN 1 END)::int AS missing_weight,
            COUNT(CASE WHEN length_in IS NULL OR width_in IS NULL OR height_in IS NULL THEN 1 END)::int AS missing_dimensions,
            COUNT(CASE WHEN picture_url IS NULL OR picture_url = '' THEN 1 END)::int AS missing_photos
     FROM items WHERE user_id = $1`, [userId]
  ) || { total: 0, missing_weight: 0, missing_dimensions: 0, missing_photos: 0 };

  const candidates = [];
  const totalItems = itemStats.total;
  const roomNames = collections.map(c => c.name.toLowerCase());
  const emptyRooms = collections.filter(c => c.item_count === 0);
  const sparseRooms = collections.filter(c => c.item_count > 0 && c.item_count < 3);
  const populatedRooms = collections.filter(c => c.item_count > 5);
  const hasKitchen = roomNames.some(r => r.includes('kitchen'));
  const hasLivingRoom = roomNames.some(r => r.includes('living'));

  // ── Priority 100: New user, moving focus ──
  if (locations.length === 0) {
    candidates.push({ label: "I'm planning a move", message: "I'm planning a move", priority: 100 });
  }

  // ── Priority 90: New user alternatives ──
  if (locations.length === 0) {
    candidates.push({ label: 'Help me get organized', message: 'I want to catalog and organize my stuff', priority: 90 });
    candidates.push({ label: "Let's go room by room", message: "Let's go room by room and catalog everything", priority: 90 });
  }

  // ── Priority 80: Early stage ──
  if (emptyRooms.length > 0 && totalItems < 10) {
    const room = emptyRooms[0].name;
    candidates.push({ label: `Let's catalog the ${room}`, message: `Let's catalog the ${room}`, priority: 80 });
  }
  if (collections.length > 0 && totalItems < 10) {
    candidates.push({ label: 'Scan a room with my camera', message: 'I want to scan a room with a photo or video', priority: 80 });
  }
  if (collections.length < 3 || !hasKitchen || !hasLivingRoom) {
    candidates.push({ label: 'What rooms should I add?', message: 'What rooms am I missing?', priority: 80 });
  }

  // ── Priority 60: Mid stage ──
  if (emptyRooms.length > 0 && totalItems >= 10) {
    const room = emptyRooms[0].name;
    candidates.push({ label: `Catalog my ${room}`, message: `Let's add items to the ${room}`, priority: 60 });
  }
  if (itemStats.missing_weight > 10) {
    candidates.push({ label: 'Add weights to my items', message: 'Can you help estimate weights for items missing them?', priority: 60 });
  }
  if (itemStats.missing_dimensions > 10) {
    candidates.push({ label: `Add dimensions to ${itemStats.missing_dimensions} items`, message: 'Help me add dimensions to items that need them', priority: 60 });
  }
  if (sparseRooms.length > 0) {
    const room = sparseRooms[0].name;
    candidates.push({ label: `Scan ${room} with a photo`, message: `I want to take a photo of my ${room} to catalog it`, priority: 60 });
  }

  // ── Priority 50: Data completeness ──
  if (populatedRooms.length > 0) {
    const room = populatedRooms[0].name;
    candidates.push({ label: `Review my ${room}`, message: `Can you review what's in my ${room}?`, priority: 50 });
  }
  if (totalItems > 10 && itemStats.missing_photos > totalItems * 0.3) {
    candidates.push({ label: `${itemStats.missing_photos} items need photos`, message: 'Which items are missing photos?', priority: 50 });
  }
  if (totalItems > 10) {
    candidates.push({ label: 'What am I missing?', message: 'What items or rooms might I be forgetting?', priority: 50 });
  }

  // ── Priority 45: Move planning (Vector-oriented) ──
  if (totalItems > 15) {
    candidates.push({ label: 'How big is my move?', message: 'Based on my inventory, how big is my move?', priority: 45 });
  }
  if (totalItems > 20) {
    candidates.push({ label: 'Estimate my costs', message: 'Can you estimate the cost of my move?', priority: 45 });
  }
  if (totalItems > 20) {
    candidates.push({ label: 'What truck do I need?', message: 'What size truck do I need for my move?', priority: 45 });
  }

  // ── Priority 40: Advanced ──
  if (totalItems > 15) {
    candidates.push({ label: 'Show my inventory summary', message: 'Give me a summary of my inventory', priority: 40 });
  }
  if (totalItems > 20) {
    candidates.push({ label: "How's my progress?", message: 'How complete is my inventory? What still needs work?', priority: 40 });
  }

  // ── Priority 30: Fill ──
  const nonEmptyRooms = collections.filter(c => c.item_count > 0);
  if (nonEmptyRooms.length > 0) {
    const room = nonEmptyRooms[0].name;
    candidates.push({ label: `Add items to ${room}`, message: `I want to add more items to ${room}`, priority: 30 });
  }
  if (nonEmptyRooms.length > 1) {
    const room = nonEmptyRooms[1].name;
    candidates.push({ label: `What's in my ${room}?`, message: `What do I have in my ${room}?`, priority: 30 });
  }

  // Sort by priority descending, take top 3
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, 3).map(({ label, message }) => ({ label, message }));
}

module.exports = {
  getInventorySnapshot,
  getConversationStarters,
  getQuickStartChips,
  getMissingContext,
  getTypicalItems,
  scoreConfidence,
  REFERENCE_ROOMS,
  TYPICAL_ITEMS,
};
