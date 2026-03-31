'use strict';

const conn = require('../infra/db');
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
    `SELECT c.id, c.name, c.location_id, COUNT(i.id)::int AS item_count,
            COALESCE(SUM(i.weight_lbs * i.quantity), 0) AS total_weight
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id ORDER BY c.name`, [userId]
  );

  // Deficiency stats — single query instead of loading every item
  const gaps = await db.oneOrNone(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(SUM(quantity), 0)::int AS total_qty,
       COALESCE(SUM(weight_lbs * quantity), 0) AS total_weight,
       COALESCE(SUM(CASE WHEN length_in IS NOT NULL AND width_in IS NOT NULL AND height_in IS NOT NULL
                     THEN (length_in * width_in * height_in / 1728.0) * quantity ELSE 0 END), 0) AS total_volume,
       COUNT(CASE WHEN weight_lbs IS NULL OR weight_lbs = 0 THEN 1 END)::int AS missing_weight,
       COUNT(CASE WHEN length_in IS NULL OR width_in IS NULL OR height_in IS NULL THEN 1 END)::int AS missing_dimensions,
       COUNT(CASE WHEN picture_url IS NULL OR picture_url = '' THEN 1 END)::int AS missing_photos
     FROM items WHERE user_id = $1`, [userId]
  ) || { total: 0, total_qty: 0, total_weight: 0, total_volume: 0, missing_weight: 0, missing_dimensions: 0, missing_photos: 0 };

  const lines = [];
  const sparseRooms = [];

  for (const loc of locations) {
    const addr = [loc.address, loc.city, loc.state].filter(Boolean).join(', ');
    lines.push(`Location: "${loc.name}" (${loc.location_type})${addr ? ' — ' + addr : ''}`);

    const roomsInLoc = collections.filter(c => String(c.location_id) === String(loc.id));
    if (roomsInLoc.length === 0) {
      lines.push('  No rooms yet.');
    }
    for (const room of roomsInLoc) {
      const tag = room.item_count < 5 ? ' [needs more items]' : '';
      lines.push(`  Room: "${room.name}" — ${room.item_count} items, ~${Math.round(room.total_weight)} lbs${tag}`);
      if (room.item_count < 5) {
        sparseRooms.push(`${room.name} (${room.item_count})`);
      }
    }
  }

  lines.push('');
  lines.push(`Totals: ${gaps.total_qty} items, ~${Math.round(gaps.total_weight)} lbs, ~${Math.round(gaps.total_volume)} cu ft`);

  // Deficiency summary — guides the agent toward useful next steps
  const gapLines = [];
  if (gaps.missing_weight > 0) gapLines.push(`${gaps.missing_weight} of ${gaps.total} items missing weight`);
  if (gaps.missing_dimensions > 0) gapLines.push(`${gaps.missing_dimensions} of ${gaps.total} missing dimensions`);
  if (gaps.missing_photos > 0) gapLines.push(`${gaps.missing_photos} of ${gaps.total} missing photos`);
  if (gapLines.length > 0) lines.push(`Gaps: ${gapLines.join(', ')}`);
  if (sparseRooms.length > 0) lines.push(`Sparse rooms (<5 items): ${sparseRooms.join(', ')}`);

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

// ── Readiness Assessment ─────────────────────────────────────────────────────

/**
 * Evaluate how ready a user's inventory is to share with moving companies.
 * Returns a structured report with scores and actionable next steps.
 *
 * Scores: 0-100 per category, overall weighted average.
 */
async function getReadinessAssessment(userId) {
  const locations = await db.any(
    `SELECT id, name, location_type FROM locations WHERE user_id = $1`, [userId]
  );

  if (locations.length === 0) {
    return {
      overall: 0,
      status: 'not_started',
      summary: 'No locations set up yet. The user needs to start by adding their home.',
      categories: {},
      nextSteps: [
        'Set up your home location and rooms',
        'Start cataloging items room by room',
        'Take photos or videos of each room',
      ],
    };
  }

  const collections = await db.any(
    `SELECT c.id, c.name, c.location_id, COUNT(i.id)::int AS item_count
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id`, [userId]
  );

  const itemStats = await db.oneOrNone(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN weight_lbs IS NOT NULL AND weight_lbs > 0 THEN 1 END)::int AS has_weight,
            COUNT(CASE WHEN length_in IS NOT NULL AND width_in IS NOT NULL AND height_in IS NOT NULL THEN 1 END)::int AS has_dimensions,
            COUNT(CASE WHEN picture_url IS NOT NULL AND picture_url != '' THEN 1 END)::int AS has_photo,
            COUNT(CASE WHEN fragile IS NOT NULL THEN 1 END)::int AS has_fragile_flag,
            COALESCE(SUM(weight_lbs * COALESCE(quantity, 1)), 0)::int AS total_weight,
            COALESCE(SUM(CASE WHEN length_in IS NOT NULL AND width_in IS NOT NULL AND height_in IS NOT NULL
              THEN (length_in * width_in * height_in / 1728.0) * COALESCE(quantity, 1) ELSE 0 END), 0)::int AS total_volume_cuft
     FROM items WHERE user_id = $1`, [userId]
  ) || { total: 0, has_weight: 0, has_dimensions: 0, has_photo: 0, has_fragile_flag: 0, total_weight: 0, total_volume_cuft: 0 };

  const total = itemStats.total;
  const emptyRooms = collections.filter(c => c.item_count === 0);
  const sparseRooms = collections.filter(c => c.item_count > 0 && c.item_count < 3);

  // Check for potential duplicates (same name in same room)
  const duplicates = await db.any(
    `SELECT LOWER(i.name) AS item_name, c.name AS room_name, COUNT(*)::int AS cnt
     FROM items i JOIN collections c ON i.collection_id = c.id
     WHERE i.user_id = $1
     GROUP BY LOWER(i.name), c.name
     HAVING COUNT(*) > 1`, [userId]
  );

  // ── Category scores ──────────────────────────────────────────────────────

  // Room coverage: penalize empty rooms heavily, sparse rooms moderately
  let roomScore = 100;
  if (collections.length === 0) {
    roomScore = 0;
  } else {
    const emptyPenalty = (emptyRooms.length / collections.length) * 60;
    const sparsePenalty = (sparseRooms.length / collections.length) * 25;
    roomScore = Math.max(0, Math.round(100 - emptyPenalty - sparsePenalty));
  }

  // Item completeness: weight coverage
  const weightScore = total > 0 ? Math.round((itemStats.has_weight / total) * 100) : 0;

  // Dimension coverage
  const dimensionScore = total > 0 ? Math.round((itemStats.has_dimensions / total) * 100) : 0;

  // Photo coverage
  const photoScore = total > 0 ? Math.round((itemStats.has_photo / total) * 100) : 0;

  // Data quality: fragile flags + no duplicates
  let qualityScore = 100;
  if (total > 0) {
    const fragilePct = itemStats.has_fragile_flag / total;
    // Expect at least some fragile marking if > 10 items
    if (total > 10 && fragilePct < 0.1) qualityScore -= 20;
    if (duplicates.length > 0) qualityScore -= Math.min(40, duplicates.length * 10);
    qualityScore = Math.max(0, qualityScore);
  } else {
    qualityScore = 0;
  }

  // Item count: are there enough items for this to be a real inventory?
  // Typical move: 50-150 items. Below 15 is very early.
  let itemCountScore;
  if (total === 0) itemCountScore = 0;
  else if (total < 10) itemCountScore = 20;
  else if (total < 20) itemCountScore = 40;
  else if (total < 35) itemCountScore = 60;
  else if (total < 50) itemCountScore = 80;
  else itemCountScore = 100;

  // Weighted overall
  const overall = Math.round(
    roomScore * 0.15 +
    weightScore * 0.20 +
    dimensionScore * 0.15 +
    photoScore * 0.10 +
    qualityScore * 0.10 +
    itemCountScore * 0.30
  );

  // Status label
  let status;
  if (overall >= 85) status = 'ready';
  else if (overall >= 65) status = 'almost_ready';
  else if (overall >= 40) status = 'in_progress';
  else if (overall > 0) status = 'early';
  else status = 'not_started';

  // ── Build next steps (priority-ordered) ──────────────────────────────────

  const nextSteps = [];

  if (emptyRooms.length > 0) {
    const names = emptyRooms.slice(0, 3).map(r => r.name).join(', ');
    nextSteps.push(`Catalog items in empty rooms: ${names}`);
  }

  if (total > 0 && total < 20) {
    nextSteps.push(`Keep adding items — ${total} logged so far, most moves have 50+`);
  }

  if (sparseRooms.length > 0) {
    const names = sparseRooms.slice(0, 3).map(r => `${r.name} (${r.item_count})`).join(', ');
    nextSteps.push(`Add more items to sparse rooms: ${names}`);
  }

  if (total > 5 && itemStats.has_weight < total * 0.5) {
    nextSteps.push(`Add weight estimates — only ${itemStats.has_weight} of ${total} items have weights`);
  }

  if (total > 5 && itemStats.has_dimensions < total * 0.5) {
    nextSteps.push(`Add dimensions — only ${itemStats.has_dimensions} of ${total} items have measurements`);
  }

  if (duplicates.length > 0) {
    const examples = duplicates.slice(0, 3).map(d => `"${d.item_name}" in ${d.room_name}`).join(', ');
    nextSteps.push(`Review potential duplicates: ${examples}`);
  }

  if (total > 10 && itemStats.has_photo < total * 0.3) {
    nextSteps.push(`Add photos — only ${itemStats.has_photo} of ${total} items have one`);
  }

  // Cap at 3 next steps
  const topSteps = nextSteps.slice(0, 3);

  return {
    overall,
    status,
    summary: `${total} items across ${collections.length} rooms. ${Math.round(itemStats.total_weight)} lbs, ~${itemStats.total_volume_cuft} cu ft.`,
    categories: {
      roomCoverage: { score: roomScore, detail: `${emptyRooms.length} empty, ${sparseRooms.length} sparse of ${collections.length} rooms` },
      itemCount: { score: itemCountScore, detail: `${total} items logged` },
      weights: { score: weightScore, detail: `${itemStats.has_weight}/${total} have weights` },
      dimensions: { score: dimensionScore, detail: `${itemStats.has_dimensions}/${total} have dimensions` },
      photos: { score: photoScore, detail: `${itemStats.has_photo}/${total} have photos` },
      dataQuality: { score: qualityScore, detail: `${duplicates.length} potential duplicates` },
    },
    nextSteps: topSteps,
  };
}

module.exports = {
  getInventorySnapshot,
  getConversationStarters,
  getQuickStartChips,
  getMissingContext,
  getTypicalItems,
  scoreConfidence,
  getReadinessAssessment,
  REFERENCE_ROOMS,
  TYPICAL_ITEMS,
};
