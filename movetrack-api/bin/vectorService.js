'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('./db');
const db = conn.db;
const census = require('./censusService');
const { generateItemEstimate } = require('../services/itemEstimationService');
const {
  haversineDistanceMiles,
  estimateRoadDistance,
  estimateDriveHours,
} = require('../services/distanceUtils');

// ── Gemini Client ───────────────────────────────────────────────────────────────

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[vectorService] Gemini configured');
}

const GEMINI_MODELS = {
  basic: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

// ── Knex (for transactional inserts) ────────────────────────────────────────────

const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE,
  },
  pool: { min: 0, max: 5 },
});

// ── Truck sizing constants ──────────────────────────────────────────────────────

const TRUCK_SIZES = [
  { label: 'Cargo Van', cuFt: 250, maxLbs: 3000, code: 'van' },
  { label: '10-ft Truck', cuFt: 400, maxLbs: 4500, code: '10ft' },
  { label: '12-ft Truck', cuFt: 450, maxLbs: 4500, code: '12ft' },
  { label: '15-ft Truck', cuFt: 700, maxLbs: 6000, code: '15ft' },
  { label: '17-ft Truck', cuFt: 850, maxLbs: 6000, code: '17ft' },
  { label: '20-ft Truck', cuFt: 1100, maxLbs: 7500, code: '20ft' },
  { label: '22-ft Truck', cuFt: 1200, maxLbs: 7500, code: '22ft' },
  { label: '26-ft Truck', cuFt: 1600, maxLbs: 10000, code: '26ft' },
];

// ── Cost estimation constants ───────────────────────────────────────────────────

const COST_PARAMS = {
  laborRatePerHour: 35,          // per mover per hour
  minMovers: 2,
  fuelCostPerMile: 0.50,         // truck fuel ~8 mpg @ $4/gal
  truckRentalPerDay: 80,         // average rental per day
  overnightStopCost: 150,        // hotel per stop
  packingMaterialsBase: 50,      // base packing materials
  packingMaterialsPerItem: 1.50, // per item
  loadingMinutesPerCuFt: 0.8,    // minutes to load per cubic foot
  unloadingMinutesPerCuFt: 0.6,  // unloading is faster
};

// ── System Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Vector, the MoveTrack move planning AI. You help people understand the size and logistics of their move.

PERSONALITY:
- Analytical, precise, reassuring. Like a seasoned logistics coordinator who makes complex moves feel manageable.
- Present numbers clearly with context ("That's about a 20-ft truck worth of stuff").
- Flag potential issues early and suggest solutions.
- Keep messages concise — use bullet points for data-heavy responses.

MISSION:
Help the user understand the size, logistics, and cost of their move based on their inventory.

USER CONTEXT:
{{USER_CONTEXT}}

CURRENT INVENTORY SNAPSHOT:
{{INVENTORY_SNAPSHOT}}

CAPABILITIES:
1. **Move Size Analysis**: Calculate total weight, volume, and recommend truck size from inventory.
2. **Weight/Dimension Estimation**: Estimate missing weights and dimensions for items that don't have them.
3. **Distance & Route**: Calculate driving distance, time, and fuel costs between locations.
4. **Labor Estimation**: Estimate loading/unloading time and crew size needed.
5. **Cost Estimation**: Provide rough DIY and professional moving cost estimates.
6. **Anomaly Detection**: Flag oversized items, fragile items needing special handling, items that may not fit through standard doors.

RULES:
1. When the user first asks about their move, call get_move_summary to understand the full picture.
2. If many items are missing weights/dimensions, call estimate_missing_items to fill gaps before calculating totals.
3. When estimating costs, always present a RANGE (low-high), never a single number.
4. Always caveat cost estimates: "These are rough estimates. Actual costs vary by season, location, and provider."
5. For distance calculations, use the user's origin and destination if set. If not, ask for them.
6. If the user has fewer than 5 items, tell them the estimates will be very rough and suggest adding more items first.
7. Flag items over 300 lbs or over 84 inches in any dimension as needing special handling.
8. When recommending truck size, add 15-20% buffer to the raw volume for packing inefficiency.
9. NEVER invent data. If you don't have enough information, say so and suggest what's needed.
10. If the user asks about things outside your scope (adding items, scanning rooms), suggest they use the Inventory assistant instead.

INLINE BUTTONS:
When presenting the user with a choice, use inline buttons so they can tap instead of typing. Format:

[BUTTONS]
Button Label|message to send when tapped
Another Option|different message to send
[/BUTTONS]

Examples:
- After move summary: "Get cost estimate|Estimate the cost of my move" / "Recommend a truck|What truck size do I need?" / "Check special items|Flag any items needing special handling"
- After truck recommendation: "Get cost estimate|Now estimate the total cost" / "See room breakdown|Show me the breakdown by room"
Keep labels short (2-5 words). Include 2-4 options. Use buttons whenever the user can take a natural next step.

CONVERSATION STARTERS (for new sessions):
{{CONVERSATION_STARTERS}}`;

// ── Tool Declarations ───────────────────────────────────────────────────────────

const toolDeclarations = [
  {
    name: 'get_move_summary',
    description: 'Get a comprehensive summary of the move: total items, weight, volume, items missing data, rooms, and locations. This is the starting point for move planning.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'estimate_missing_items',
    description: 'Estimate weights and dimensions for items that are missing them. Returns the updated totals after estimation.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        max_items: { type: SchemaType.INTEGER, description: 'Maximum number of items to estimate at once (default 20, max 50)' },
      },
    },
  },
  {
    name: 'recommend_truck_size',
    description: 'Based on total volume and weight, recommend the right truck size with a packing buffer.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        buffer_pct: { type: SchemaType.NUMBER, description: 'Packing inefficiency buffer as decimal (default 0.20 = 20%)' },
      },
    },
  },
  {
    name: 'calculate_route',
    description: 'Calculate driving distance, time, and fuel cost between two locations. Uses the user\'s saved locations if origin_text and destination_text are not provided.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        origin_text:      { type: SchemaType.STRING, description: 'Origin city/address, e.g. "Austin, TX". If omitted, uses primary location.' },
        destination_text: { type: SchemaType.STRING, description: 'Destination city/address, e.g. "Denver, CO"' },
      },
    },
  },
  {
    name: 'estimate_labor',
    description: 'Estimate loading and unloading time based on inventory volume, plus recommended crew size.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        num_movers:   { type: SchemaType.INTEGER, description: 'Number of movers (default 2)' },
        has_stairs:   { type: SchemaType.BOOLEAN, description: 'Whether origin or destination has stairs (adds 30% time)' },
        has_elevator: { type: SchemaType.BOOLEAN, description: 'Whether building has an elevator (adds 20% time for wait/load cycles)' },
      },
    },
  },
  {
    name: 'estimate_move_cost',
    description: 'Generate a rough cost estimate for the move, including DIY and professional options.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        distance_miles:  { type: SchemaType.NUMBER, description: 'Distance in miles (if already calculated)' },
        num_movers:      { type: SchemaType.INTEGER, description: 'Number of movers for professional estimate (default 2)' },
        include_packing: { type: SchemaType.BOOLEAN, description: 'Include packing services in professional estimate' },
      },
    },
  },
  {
    name: 'flag_special_items',
    description: 'Identify items that need special handling: oversized, very heavy, fragile, or items that may not fit through standard doors (36" wide, 80" tall).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_room_breakdown',
    description: 'Get a detailed breakdown of items, weight, and volume by room.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
];

// ── Helper: get inventory totals ────────────────────────────────────────────────

async function getInventoryTotals(userId) {
  const items = await knex('items')
    .select(
      'items.id', 'items.name', 'items.quantity',
      'items.weight_lbs', 'items.length_in', 'items.width_in', 'items.height_in',
      'items.fragile', 'items.description', 'items.material',
      'collections.name as room_name'
    )
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId);

  let totalWeight = 0;
  let totalVolumeCuFt = 0;
  let totalItems = 0;
  let missingWeight = 0;
  let missingDimensions = 0;

  for (const item of items) {
    const qty = item.quantity || 1;
    totalItems += qty;

    if (item.weight_lbs) {
      totalWeight += item.weight_lbs * qty;
    } else {
      missingWeight += qty;
    }

    if (item.length_in && item.width_in && item.height_in) {
      const vol = (item.length_in * item.width_in * item.height_in) / 1728;
      totalVolumeCuFt += vol * qty;
    } else {
      missingDimensions += qty;
    }
  }

  return {
    items,
    totalItems,
    totalWeight: Math.round(totalWeight),
    totalVolumeCuFt: Math.round(totalVolumeCuFt * 100) / 100,
    missingWeight,
    missingDimensions,
  };
}

// ── Tool Handlers ───────────────────────────────────────────────────────────────

const toolHandlers = {
  async get_move_summary(args, userId) {
    const totals = await getInventoryTotals(userId);

    // Get locations
    const locations = await knex('locations')
      .select('id', 'name', 'address', 'city', 'state', 'zip', 'location_type')
      .where('user_id', userId);

    // Get rooms with item counts
    const rooms = await knex('collections')
      .select('collections.name')
      .count('items.id as item_count')
      .leftJoin('items', 'collections.id', 'items.collection_id')
      .where('collections.user_id', userId)
      .groupBy('collections.id', 'collections.name')
      .orderBy('collections.name');

    // Get saved moves
    const savedMoves = await knex('saved_moves')
      .select('id', 'name', 'origin_location_id', 'destination_location_id',
              'desired_start_date', 'desired_end_date')
      .where('user_id', userId)
      .orderBy('updated_at', 'desc')
      .limit(5);

    return {
      success: true,
      totalItems: totals.totalItems,
      totalWeight: totals.totalWeight,
      totalVolumeCuFt: totals.totalVolumeCuFt,
      missingWeight: totals.missingWeight,
      missingDimensions: totals.missingDimensions,
      dataCompleteness: totals.totalItems > 0
        ? Math.round((1 - (totals.missingWeight + totals.missingDimensions) / (totals.totalItems * 2)) * 100)
        : 0,
      rooms: rooms.map(r => ({ name: r.name, itemCount: parseInt(r.item_count) })),
      locations: locations.map(l => ({
        id: l.id, name: l.name, city: l.city, state: l.state,
        type: l.location_type,
      })),
      savedMoves: savedMoves.map(m => ({
        id: m.id, name: m.name,
        startDate: m.desired_start_date,
        endDate: m.desired_end_date,
      })),
    };
  },

  async estimate_missing_items(args, userId) {
    const maxItems = Math.min(args.max_items || 20, 50);

    // Find items missing weight or dimensions
    const items = await knex('items')
      .select('id', 'name', 'description', 'quantity', 'weight_lbs',
              'length_in', 'width_in', 'height_in', 'material', 'primary_color',
              'collections.name as collection_name')
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .where('items.user_id', userId)
      .where(function() {
        this.whereNull('items.weight_lbs')
          .orWhereNull('items.length_in')
          .orWhereNull('items.width_in')
          .orWhereNull('items.height_in');
      })
      .limit(maxItems);

    if (items.length === 0) {
      return { success: true, message: 'All items already have weight and dimension data.', estimated: 0 };
    }

    const results = [];
    let estimated = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const estimate = await generateItemEstimate({
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          collection_name: item.collection_name,
          material: item.material,
          primary_color: item.primary_color,
          weight_lbs: item.weight_lbs,
          length_in: item.length_in,
          width_in: item.width_in,
          height_in: item.height_in,
        });

        const updates = {};
        const est = estimate.estimate;

        if (!item.weight_lbs && est.weight_lbs?.value) {
          updates.weight_lbs = est.weight_lbs.value;
        }
        if (!item.length_in && est.dimensions?.length_in?.value) {
          updates.length_in = est.dimensions.length_in.value;
        }
        if (!item.width_in && est.dimensions?.width_in?.value) {
          updates.width_in = est.dimensions.width_in.value;
        }
        if (!item.height_in && est.dimensions?.height_in?.value) {
          updates.height_in = est.dimensions.height_in.value;
        }

        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date();
          await knex('items').where({ id: item.id, user_id: userId }).update(updates);
          estimated++;
          results.push({
            name: item.name,
            weight: updates.weight_lbs || item.weight_lbs,
            dimensions: updates.length_in
              ? `${updates.length_in || item.length_in}" × ${updates.width_in || item.width_in}" × ${updates.height_in || item.height_in}"`
              : null,
            confidence: est.confidence,
          });
        }
      } catch (err) {
        console.error(`[vector] Estimation failed for item ${item.id}:`, err.message);
        failed++;
      }
    }

    // Get updated totals
    const totals = await getInventoryTotals(userId);

    return {
      success: true,
      estimated,
      failed,
      remaining: totals.missingWeight + totals.missingDimensions,
      results,
      updatedTotals: {
        totalWeight: totals.totalWeight,
        totalVolumeCuFt: totals.totalVolumeCuFt,
        missingWeight: totals.missingWeight,
        missingDimensions: totals.missingDimensions,
      },
    };
  },

  async recommend_truck_size(args, userId) {
    const totals = await getInventoryTotals(userId);
    const buffer = args.buffer_pct || 0.20;
    const bufferedVolume = totals.totalVolumeCuFt * (1 + buffer);

    const recommendation = TRUCK_SIZES.find(
      t => t.cuFt >= bufferedVolume && t.maxLbs >= totals.totalWeight
    ) || TRUCK_SIZES[TRUCK_SIZES.length - 1]; // Largest if nothing fits

    const needsMultiple = bufferedVolume > TRUCK_SIZES[TRUCK_SIZES.length - 1].cuFt ||
      totals.totalWeight > TRUCK_SIZES[TRUCK_SIZES.length - 1].maxLbs;

    let multipleLoads = null;
    if (needsMultiple) {
      const largestTruck = TRUCK_SIZES[TRUCK_SIZES.length - 1];
      const tripsByVolume = Math.ceil(bufferedVolume / largestTruck.cuFt);
      const tripsByWeight = Math.ceil(totals.totalWeight / largestTruck.maxLbs);
      multipleLoads = {
        truckSize: largestTruck.label,
        trips: Math.max(tripsByVolume, tripsByWeight),
        reason: tripsByWeight > tripsByVolume ? 'weight' : 'volume',
      };
    }

    return {
      success: true,
      rawVolumeCuFt: totals.totalVolumeCuFt,
      bufferedVolumeCuFt: Math.round(bufferedVolume * 100) / 100,
      bufferPct: Math.round(buffer * 100),
      totalWeightLbs: totals.totalWeight,
      recommendation: {
        size: recommendation.label,
        code: recommendation.code,
        capacityCuFt: recommendation.cuFt,
        maxWeightLbs: recommendation.maxLbs,
        volumeUtilization: Math.round((bufferedVolume / recommendation.cuFt) * 100),
        weightUtilization: Math.round((totals.totalWeight / recommendation.maxLbs) * 100),
      },
      needsMultipleLoads: needsMultiple,
      multipleLoads,
      dataWarning: (totals.missingWeight > 0 || totals.missingDimensions > 0)
        ? `${totals.missingWeight} items missing weight, ${totals.missingDimensions} missing dimensions. Run estimate_missing_items for better accuracy.`
        : null,
    };
  },

  async calculate_route(args, userId) {
    let originCity, originState, destCity, destState;

    if (args.origin_text) {
      const parts = args.origin_text.split(',').map(s => s.trim());
      originCity = parts[0];
      originState = parts[1] || '';
    } else {
      // Use primary location
      const loc = await knex('locations')
        .select('city', 'state')
        .where({ user_id: userId, location_type: 'primary_residence' })
        .first();
      if (!loc) {
        return { success: false, error: 'No origin location found. Please provide an origin or set your primary location.' };
      }
      originCity = loc.city;
      originState = loc.state;
    }

    if (args.destination_text) {
      const parts = args.destination_text.split(',').map(s => s.trim());
      destCity = parts[0];
      destState = parts[1] || '';
    } else {
      return { success: false, error: 'Please provide a destination city/address.' };
    }

    if (!originCity) {
      return { success: false, error: 'Could not determine origin city.' };
    }

    // Try Google Maps Distance Matrix first
    let distanceMiles = null;
    let driveHours = null;
    let routeSource = 'estimated';

    try {
      const fetch = require('node-fetch');
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (apiKey) {
        const origin = `${originCity}, ${originState}`;
        const destination = `${destCity}, ${destState}`;
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&units=imperial&key=${apiKey}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const element = data.rows?.[0]?.elements?.[0];
        if (element?.status === 'OK') {
          distanceMiles = Math.round(element.distance.value / 1609.34);
          driveHours = Math.round((element.duration.value / 3600) * 10) / 10;
          routeSource = 'google_maps';
        }
      }
    } catch (err) {
      console.warn('[vector] Google Maps lookup failed:', err.message);
    }

    // Fallback: haversine estimate
    if (!distanceMiles) {
      // Use a simple lookup or haversine
      const straightLine = 500; // conservative fallback
      distanceMiles = Math.round(estimateRoadDistance(straightLine));
      driveHours = estimateDriveHours(distanceMiles);
      routeSource = 'haversine_estimate';
    }

    const fuelCost = Math.round(distanceMiles * COST_PARAMS.fuelCostPerMile);
    const driveDays = Math.ceil(driveHours / 8); // 8-hour driving days
    const overnightStops = Math.max(0, driveDays - 1);

    return {
      success: true,
      origin: `${originCity}, ${originState}`,
      destination: `${destCity}, ${destState}`,
      distanceMiles,
      driveHours,
      driveDays,
      overnightStops,
      estimatedFuelCost: fuelCost,
      overnightCost: overnightStops * COST_PARAMS.overnightStopCost,
      routeSource,
    };
  },

  async estimate_labor(args, userId) {
    const totals = await getInventoryTotals(userId);
    const numMovers = Math.max(args.num_movers || COST_PARAMS.minMovers, COST_PARAMS.minMovers);

    // Base loading/unloading time
    let loadingMinutes = totals.totalVolumeCuFt * COST_PARAMS.loadingMinutesPerCuFt;
    let unloadingMinutes = totals.totalVolumeCuFt * COST_PARAMS.unloadingMinutesPerCuFt;

    // Adjustments
    if (args.has_stairs) {
      loadingMinutes *= 1.3;
      unloadingMinutes *= 1.3;
    }
    if (args.has_elevator) {
      loadingMinutes *= 1.2;
      unloadingMinutes *= 1.2;
    }

    // More movers = faster (but not linearly — diminishing returns)
    const moverFactor = 2 / numMovers; // 2 movers is baseline
    loadingMinutes *= moverFactor;
    unloadingMinutes *= moverFactor;

    const loadingHours = Math.round(loadingMinutes / 60 * 10) / 10;
    const unloadingHours = Math.round(unloadingMinutes / 60 * 10) / 10;
    const totalLaborHours = loadingHours + unloadingHours;
    const laborCost = Math.round(totalLaborHours * numMovers * COST_PARAMS.laborRatePerHour);

    // Crew size recommendation
    let recommendedMovers = 2;
    if (totals.totalVolumeCuFt > 800) recommendedMovers = 3;
    if (totals.totalVolumeCuFt > 1400) recommendedMovers = 4;
    if (totals.totalWeight > 8000) recommendedMovers = Math.max(recommendedMovers, 3);

    return {
      success: true,
      volumeCuFt: totals.totalVolumeCuFt,
      totalWeightLbs: totals.totalWeight,
      numMovers,
      loadingHours,
      unloadingHours,
      totalLaborHours,
      laborCostEstimate: laborCost,
      recommendedMovers,
      adjustments: {
        stairs: args.has_stairs || false,
        elevator: args.has_elevator || false,
      },
    };
  },

  async estimate_move_cost(args, userId) {
    const totals = await getInventoryTotals(userId);
    const distanceMiles = args.distance_miles || 0;
    const numMovers = Math.max(args.num_movers || COST_PARAMS.minMovers, COST_PARAMS.minMovers);
    const isLocal = distanceMiles <= 50;

    // --- DIY estimate ---
    const truckRec = TRUCK_SIZES.find(
      t => t.cuFt >= totals.totalVolumeCuFt * 1.2 && t.maxLbs >= totals.totalWeight
    ) || TRUCK_SIZES[TRUCK_SIZES.length - 1];

    const rentalDays = isLocal ? 1 : Math.ceil(distanceMiles / 400) + 1; // ~400 miles/day
    const truckRental = COST_PARAMS.truckRentalPerDay * rentalDays;
    const fuelCost = distanceMiles * COST_PARAMS.fuelCostPerMile;
    const packingCost = COST_PARAMS.packingMaterialsBase + (totals.totalItems * COST_PARAMS.packingMaterialsPerItem);
    const overnightStops = Math.max(0, Math.ceil(distanceMiles / 400) - 1);
    const overnightCost = overnightStops * COST_PARAMS.overnightStopCost;

    const diyLow = Math.round(truckRental + fuelCost + packingCost * 0.5);
    const diyHigh = Math.round(truckRental + fuelCost + packingCost + overnightCost + 200); // +$200 for misc

    // --- Professional estimate ---
    let loadingMinutes = totals.totalVolumeCuFt * COST_PARAMS.loadingMinutesPerCuFt;
    let unloadingMinutes = totals.totalVolumeCuFt * COST_PARAMS.unloadingMinutesPerCuFt;
    const laborHours = (loadingMinutes + unloadingMinutes) / 60;
    const laborCost = laborHours * numMovers * COST_PARAMS.laborRatePerHour;

    let proLow, proHigh;
    if (isLocal) {
      // Local move: hourly rate
      proLow = Math.round(laborCost * 0.85);
      proHigh = Math.round(laborCost * 1.4);
    } else {
      // Long distance: weight-based + distance
      const weightRate = totals.totalWeight * 0.50; // ~$0.50/lb base
      const distanceRate = distanceMiles * 0.80;    // ~$0.80/mile
      proLow = Math.round((weightRate + distanceRate) * 0.85);
      proHigh = Math.round((weightRate + distanceRate) * 1.3);
    }

    if (args.include_packing) {
      const packingSurcharge = Math.round(totals.totalItems * 8); // ~$8/item for professional packing
      proLow += packingSurcharge;
      proHigh += Math.round(packingSurcharge * 1.3);
    }

    return {
      success: true,
      moveType: isLocal ? 'local' : 'long_distance',
      distanceMiles,
      totalItems: totals.totalItems,
      totalWeightLbs: totals.totalWeight,
      totalVolumeCuFt: totals.totalVolumeCuFt,
      diy: {
        low: diyLow,
        high: diyHigh,
        truckSize: truckRec.label,
        includes: ['truck rental', 'fuel', 'packing materials'],
        notes: 'Does not include helpers, insurance, or tolls.',
      },
      professional: {
        low: proLow,
        high: proHigh,
        movers: numMovers,
        includesPacking: args.include_packing || false,
        notes: isLocal
          ? 'Based on hourly labor rates. Does not include tips or insurance.'
          : 'Based on weight and distance. Actual quotes may vary by season and provider.',
      },
      caveat: 'These are rough estimates based on your inventory data. Actual costs vary by season, location, and provider. Get 3+ quotes for accurate pricing.',
      dataWarning: (totals.missingWeight > 0 || totals.missingDimensions > 0)
        ? `${totals.missingWeight} items missing weight, ${totals.missingDimensions} missing dimensions. Estimates may be low.`
        : null,
    };
  },

  async flag_special_items(args, userId) {
    const items = await knex('items')
      .select(
        'items.id', 'items.name', 'items.weight_lbs',
        'items.length_in', 'items.width_in', 'items.height_in',
        'items.fragile', 'items.description',
        'collections.name as room_name'
      )
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .where('items.user_id', userId);

    const flags = [];

    for (const item of items) {
      const issues = [];

      // Heavy items
      if (item.weight_lbs && item.weight_lbs > 300) {
        issues.push(`Very heavy (${item.weight_lbs} lbs) — may need extra movers or equipment`);
      }

      // Oversized items (won't fit through standard door: 36" wide, 80" tall)
      const dims = [item.length_in, item.width_in, item.height_in].filter(Boolean).sort((a, b) => b - a);
      if (dims.length >= 2) {
        if (dims[0] > 84) {
          issues.push(`Very tall/long (${dims[0]}") — check doorways and hallways`);
        }
        if (dims[1] > 36) {
          issues.push(`Wide (${dims[1]}") — may not fit through standard 36" doorway`);
        }
      }

      // Fragile items
      if (item.fragile) {
        issues.push('Fragile — needs special packing/handling');
      }

      if (issues.length > 0) {
        flags.push({
          name: item.name,
          room: item.room_name,
          weight: item.weight_lbs,
          dimensions: dims.length === 3 ? `${dims[0]}" × ${dims[1]}" × ${dims[2]}"` : null,
          issues,
        });
      }
    }

    return {
      success: true,
      flaggedCount: flags.length,
      items: flags,
      summary: flags.length === 0
        ? 'No items flagged for special handling.'
        : `${flags.length} item(s) need special attention.`,
    };
  },

  async get_room_breakdown(args, userId) {
    const items = await knex('items')
      .select(
        'items.quantity', 'items.weight_lbs',
        'items.length_in', 'items.width_in', 'items.height_in',
        'collections.name as room_name'
      )
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .where('items.user_id', userId);

    const rooms = {};
    for (const item of items) {
      const room = item.room_name || 'Uncategorized';
      if (!rooms[room]) {
        rooms[room] = { itemCount: 0, weightLbs: 0, volumeCuFt: 0 };
      }
      const qty = item.quantity || 1;
      rooms[room].itemCount += qty;
      if (item.weight_lbs) rooms[room].weightLbs += item.weight_lbs * qty;
      if (item.length_in && item.width_in && item.height_in) {
        rooms[room].volumeCuFt += (item.length_in * item.width_in * item.height_in) / 1728 * qty;
      }
    }

    // Round values
    const breakdown = Object.entries(rooms).map(([name, data]) => ({
      room: name,
      items: data.itemCount,
      weightLbs: Math.round(data.weightLbs),
      volumeCuFt: Math.round(data.volumeCuFt * 100) / 100,
    }));

    breakdown.sort((a, b) => b.volumeCuFt - a.volumeCuFt);

    return {
      success: true,
      rooms: breakdown,
      totals: {
        rooms: breakdown.length,
        items: breakdown.reduce((s, r) => s + r.items, 0),
        weightLbs: breakdown.reduce((s, r) => s + r.weightLbs, 0),
        volumeCuFt: Math.round(breakdown.reduce((s, r) => s + r.volumeCuFt, 0) * 100) / 100,
      },
    };
  },
};

// ── Conversation Loop ───────────────────────────────────────────────────────────

async function processMessage(userId, message, attachments = [], plan = 'basic') {
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY is not configured');
  }

  // ── 1. Resolve active session (one per user, session_type = 'vector') ────
  let session = await db.oneOrNone(
    `SELECT * FROM nexus_sessions WHERE user_id = $1 AND is_active = TRUE AND session_type = 'vector'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  if (!session) {
    session = await db.one(
      `INSERT INTO nexus_sessions (user_id, session_type) VALUES ($1, 'vector') RETURNING *`, [userId]
    );
    console.log(`[vector] New session for user: ${session.id}`);
  }
  const sessionId = session.id;

  // ── 2. Load conversation history with context consolidation ───────────────
  const contextSummaryText = session.context_summary || null;
  let historyRows;

  if (session.summary_through_id) {
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1 AND id > $2
       ORDER BY created_at ASC`,
      [sessionId, session.summary_through_id]
    );
  } else {
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at DESC LIMIT 60`,
      [sessionId]
    );
    historyRows.reverse();
  }

  // ── 3. Build Gemini contents from history ─────────────────────────────────
  const contents = [];
  for (const row of historyRows) {
    if (row.role === 'user') {
      const parts = [];
      if (row.content) parts.push({ text: row.content });
      contents.push({ role: 'user', parts });
    } else if (row.role === 'model') {
      const parts = [];
      if (row.content) parts.push({ text: row.content });
      contents.push({ role: 'model', parts });
    } else if (row.role === 'tool_call') {
      contents.push({
        role: 'model',
        parts: [{
          functionCall: { name: row.tool_name, args: row.tool_args || {} }
        }],
      });
    } else if (row.role === 'tool_result') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: row.tool_name,
            response: row.tool_response || {},
          }
        }],
      });
    }
  }

  // ── 4. Add current user message ───────────────────────────────────────────
  const userParts = [];
  if (message) userParts.push({ text: message });
  if (userParts.length === 0) userParts.push({ text: '(empty message)' });
  contents.push({ role: 'user', parts: userParts });

  // Persist user message
  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content)
     VALUES ($1, 'user', $2)`,
    [sessionId, message]
  );

  // ── 5. Build system prompt with context ───────────────────────────────────
  const inventorySnapshot = await census.getInventorySnapshot(userId);
  const user = await db.oneOrNone(
    `SELECT first_name, last_name, email, onboarding_completed FROM users WHERE user_id = $1`,
    [userId]
  );
  const userContext = user
    ? `Name: ${user.first_name || 'Unknown'} ${user.last_name || ''}\nOnboarding completed: ${user.onboarding_completed}`
    : 'Unknown user';

  let conversationStarters = '';
  if (historyRows.length === 0) {
    conversationStarters = [
      '- Ask about move size and truck recommendation',
      '- Ask for a cost estimate',
      '- Ask about items needing special handling',
    ].join('\n');
  }

  let systemInstruction = SYSTEM_PROMPT
    .replace('{{USER_CONTEXT}}', userContext)
    .replace('{{INVENTORY_SNAPSHOT}}', inventorySnapshot)
    .replace('{{CONVERSATION_STARTERS}}', conversationStarters || 'N/A (returning user)');

  if (contextSummaryText) {
    systemInstruction += `\n\nCONVERSATION HISTORY SUMMARY (older messages, summarized):\n${contextSummaryText}`;
  }

  // ── 6. Call Gemini ────────────────────────────────────────────────────────
  const modelId = GEMINI_MODELS[plan] || GEMINI_MODELS.basic;
  const model = geminiClient.getGenerativeModel({
    model: modelId,
    systemInstruction,
    tools: [{ functionDeclarations: toolDeclarations }],
    generationConfig: { maxOutputTokens: 4096 },
  });

  const actions = [];
  let maxToolRounds = 8;

  let result = await model.generateContent({ contents });

  while (maxToolRounds > 0) {
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) break;

    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => p.text);

    if (functionCalls.length === 0) {
      const reply = textParts.map(p => p.text).join('\n');

      // Persist model reply
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, reply]
      );

      // Update session title for new sessions
      if (!session.title) {
        await db.none(
          `UPDATE nexus_sessions SET title = $1, updated_at = NOW() WHERE id = $2`,
          [message.substring(0, 100), sessionId]
        );
      } else {
        await db.none(
          `UPDATE nexus_sessions SET updated_at = NOW() WHERE id = $1`,
          [sessionId]
        );
      }

      // Fire-and-forget context summary generation
      generateContextSummary(sessionId).catch(err =>
        console.error('[vector] Summary generation failed:', err.message)
      );

      return { reply, actions, sessionId };
    }

    // Execute function calls
    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      console.log(`[vector] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

      let toolResult;
      try {
        const handler = toolHandlers[name];
        if (!handler) {
          toolResult = { success: false, error: `Unknown tool: ${name}` };
        } else {
          toolResult = await handler(args, userId);
        }
      } catch (err) {
        console.error(`[vector] Tool ${name} failed:`, err.message);
        toolResult = { success: false, error: err.message };
      }

      actions.push({ tool: name, args, result: toolResult });

      // Persist tool call and result
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, tool_name, tool_args) VALUES ($1, 'tool_call', $2, $3)`,
        [sessionId, name, JSON.stringify(args)]
      );
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, tool_name, tool_response) VALUES ($1, 'tool_result', $2, $3)`,
        [sessionId, name, JSON.stringify(toolResult)]
      );

      toolResponses.push({
        functionResponse: { name, response: toolResult },
      });
    }

    // Send tool results back to Gemini
    contents.push({ role: 'model', parts: functionCalls.map(p => ({ functionCall: p.functionCall })) });
    contents.push({ role: 'user', parts: toolResponses });

    result = await model.generateContent({ contents });
    maxToolRounds--;
  }

  // Fallback if we hit max rounds
  const fallbackReply = 'I\'ve finished analyzing your move. Let me know what else you\'d like to know!';
  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
    [sessionId, fallbackReply]
  );
  return { reply: fallbackReply, actions, sessionId };
}

// ── Context Summary Generation ──────────────────────────────────────────────────

const SUMMARY_THRESHOLD = 20;

async function generateContextSummary(sessionId) {
  if (!geminiClient) return;

  const session = await db.oneOrNone(
    `SELECT id, context_summary, summary_through_id FROM nexus_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!session) return;

  const whereAfter = session.summary_through_id
    ? `AND id > ${parseInt(session.summary_through_id)}`
    : '';
  const { cnt } = await db.one(
    `SELECT COUNT(*)::int AS cnt FROM nexus_messages
     WHERE session_id = $1 AND role IN ('user', 'model') ${whereAfter}`,
    [sessionId]
  );

  if (cnt < SUMMARY_THRESHOLD) return;

  const allUserModel = await db.any(
    `SELECT id, role, content FROM nexus_messages
     WHERE session_id = $1 AND role IN ('user', 'model') AND content IS NOT NULL
     ORDER BY created_at ASC`,
    [sessionId]
  );

  if (allUserModel.length <= SUMMARY_THRESHOLD) return;

  const toSummarize = allUserModel.slice(0, -20);
  const newSummaryThroughId = toSummarize[toSummarize.length - 1].id;

  const newMessages = session.summary_through_id
    ? toSummarize.filter(m => m.id > session.summary_through_id)
    : toSummarize;

  if (newMessages.length === 0) return;

  const transcript = newMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Vector'}: ${m.content}`)
    .join('\n');

  const existingSummary = session.context_summary || '';
  const summaryPrompt = existingSummary
    ? `Here is the existing conversation summary:\n${existingSummary}\n\nHere are newer messages to incorporate:\n${transcript}\n\nCreate an updated, consolidated summary.`
    : `Summarize this conversation:\n${transcript}`;

  const summaryModel = geminiClient.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: `Summarize this conversation between a user and Vector (an AI move planning assistant).
Focus on: move details discussed, cost estimates given, truck recommendations, distances calculated, any concerns flagged.
Keep it under 300 words. Write in third person: "The user..." not "You..."`,
  });

  const result = await summaryModel.generateContent(summaryPrompt);
  const summary = result.response.text();

  await db.none(
    `UPDATE nexus_sessions SET context_summary = $1, summary_through_id = $2, updated_at = NOW()
     WHERE id = $3`,
    [summary, newSummaryThroughId, sessionId]
  );

  console.log(`[vector] Summary updated for session ${sessionId} (through msg ${newSummaryThroughId})`);
}

module.exports = { processMessage, generateContextSummary };
