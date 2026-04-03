'use strict';

/**
 * Move Cost Service
 *
 * DIY and professional move cost estimation.
 */

const { TRUCK_SIZES } = require('./trucksService');

const COST_PARAMS = {
  laborRatePerHour: 35,
  minMovers: 2,
  fuelCostPerMile: 0.50,
  truckRentalPerDay: 80,
  overnightStopCost: 150,
  packingMaterialsBase: 50,
  packingMaterialsPerItem: 1.50,
  loadingMinutesPerCuFt: 0.8,
  unloadingMinutesPerCuFt: 0.6,
};

/**
 * Estimate move cost (DIY + professional ranges).
 *
 * @param {object} totals - inventory totals from getInventoryTotals
 * @param {object} args - { distance_miles, num_movers, include_packing }
 * @returns {object} - { diy, professional, caveat, dataWarning }
 */
function estimateMoveCost(totals, args) {
  const distanceMiles = args.distance_miles || 0;
  const numMovers = Math.max(args.num_movers || COST_PARAMS.minMovers, COST_PARAMS.minMovers);
  const isLocal = distanceMiles <= 50;

  // --- DIY estimate ---
  const truckRec = TRUCK_SIZES.find(
    t => t.cuFt >= totals.totalVolumeCuFt * 1.2 && t.maxLbs >= totals.totalWeight
  ) || TRUCK_SIZES[TRUCK_SIZES.length - 1];

  const rentalDays = isLocal ? 1 : Math.ceil(distanceMiles / 400) + 1;
  const truckRental = COST_PARAMS.truckRentalPerDay * rentalDays;
  const fuelCost = distanceMiles * COST_PARAMS.fuelCostPerMile;
  const packingCost = COST_PARAMS.packingMaterialsBase + (totals.totalItems * COST_PARAMS.packingMaterialsPerItem);
  const overnightStops = Math.max(0, Math.ceil(distanceMiles / 400) - 1);
  const overnightCost = overnightStops * COST_PARAMS.overnightStopCost;

  const diyLow = Math.round(truckRental + fuelCost + packingCost * 0.5);
  const diyHigh = Math.round(truckRental + fuelCost + packingCost + overnightCost + 200);

  // --- Professional estimate ---
  let loadingMinutes = totals.totalVolumeCuFt * COST_PARAMS.loadingMinutesPerCuFt;
  let unloadingMinutes = totals.totalVolumeCuFt * COST_PARAMS.unloadingMinutesPerCuFt;
  const laborHours = (loadingMinutes + unloadingMinutes) / 60;
  const laborCost = laborHours * numMovers * COST_PARAMS.laborRatePerHour;

  let proLow, proHigh;
  if (isLocal) {
    proLow = Math.round(laborCost * 0.85);
    proHigh = Math.round(laborCost * 1.4);
  } else {
    const weightRate = totals.totalWeight * 0.50;
    const distanceRate = distanceMiles * 0.80;
    proLow = Math.round((weightRate + distanceRate) * 0.85);
    proHigh = Math.round((weightRate + distanceRate) * 1.3);
  }

  if (args.include_packing) {
    const packingSurcharge = Math.round(totals.totalItems * 8);
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
}

module.exports = {
  COST_PARAMS,
  estimateMoveCost,
};
