'use strict';

/**
 * Labor Estimation Service
 *
 * Crew sizing and loading/unloading time estimation.
 */

const { COST_PARAMS } = require('./moveCostService');

/**
 * Estimate labor requirements for a move.
 *
 * @param {object} totals - inventory totals
 * @param {object} args - { num_movers, has_stairs, has_elevator }
 * @returns {object} - labor hours, cost, recommended crew size
 */
function estimateLabor(totals, args) {
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

  // More movers = faster (diminishing returns)
  const moverFactor = 2 / numMovers;
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
}

module.exports = {
  estimateLabor,
};
