'use strict';

/**
 * Truck Sizing Service
 *
 * Truck size recommendation based on inventory volume and weight.
 */

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

/**
 * Recommend a truck size based on inventory totals.
 *
 * @param {object} totals - { totalVolumeCuFt, totalWeight, missingWeight, missingDimensions }
 * @param {number} [bufferPct=0.20] - Packing buffer percentage
 * @returns {object} - recommendation with truck size, utilization, multi-load info
 */
function recommendTruckSize(totals, bufferPct) {
  const buffer = bufferPct || 0.20;
  const bufferedVolume = totals.totalVolumeCuFt * (1 + buffer);

  const recommendation = TRUCK_SIZES.find(
    t => t.cuFt >= bufferedVolume && t.maxLbs >= totals.totalWeight
  ) || TRUCK_SIZES[TRUCK_SIZES.length - 1];

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
}

module.exports = {
  TRUCK_SIZES,
  recommendTruckSize,
};
