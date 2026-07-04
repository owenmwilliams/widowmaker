// Pure move-cost math shared by the desktop move planner (and reusable by
// future surfaces). No Vue reactivity, no store access — inputs in, numbers
// out — so the pricing model stays testable in isolation.

// ---------------------------------------------------------------------------
// Cost-of-living multipliers
// ---------------------------------------------------------------------------

export const colMultipliers: Record<string, number> = {
  // Very High CoL (1.4x - 1.6x)
  'san francisco': 1.6, 'sf': 1.6, 'bay area': 1.6, 'silicon valley': 1.6,
  'new york': 1.5, 'nyc': 1.5, 'manhattan': 1.5, 'brooklyn': 1.5,
  'los angeles': 1.4, 'la': 1.4, 'santa monica': 1.4, 'beverly hills': 1.4,
  'boston': 1.4, 'cambridge': 1.4,
  'seattle': 1.4, 'bellevue': 1.4,
  'washington': 1.4, 'dc': 1.4,

  // High CoL (1.2x - 1.3x)
  'san diego': 1.3, 'san jose': 1.3, 'oakland': 1.3,
  'chicago': 1.2, 'denver': 1.2, 'portland': 1.2, 'austin': 1.2,
  'miami': 1.2, 'honolulu': 1.5,

  // Medium CoL (1.0x - baseline)
  'atlanta': 1.0, 'dallas': 1.0, 'houston': 1.0, 'phoenix': 1.0,
  'philadelphia': 1.1, 'minneapolis': 1.0, 'charlotte': 1.0,

  // Low CoL (0.8x - 0.9x)
  'nashville': 0.9, 'indianapolis': 0.85, 'columbus': 0.85,
  'milwaukee': 0.85, 'kansas city': 0.8, 'oklahoma city': 0.75,
  'memphis': 0.75, 'detroit': 0.8
};

export const colMultiplierForName = (locationName: string): number => {
  const normalized = locationName.toLowerCase();
  for (const [city, multiplier] of Object.entries(colMultipliers)) {
    if (normalized.includes(city)) {
      return multiplier;
    }
  }
  return 1.0;
};

// ---------------------------------------------------------------------------
// Truck sizing
// ---------------------------------------------------------------------------

export interface TruckRecommendation {
  size: string;
  capacity: number;
  description: string;
  suitable: string;
  utilization: number;
}

export const recommendTruck = (volumeCuFt: number): TruckRecommendation => {
  // Add 30% buffer for irregular packing and space between items
  const adjustedVolume = volumeCuFt * 1.3;

  if (adjustedVolume <= 400) {
    return {
      size: '10 ft',
      capacity: 400,
      description: 'Small moving truck',
      suitable: 'Studio or small 1-bedroom apartment',
      utilization: (adjustedVolume / 400) * 100
    };
  } else if (adjustedVolume <= 700) {
    return {
      size: '15 ft',
      capacity: 700,
      description: 'Medium moving truck',
      suitable: '1-2 bedroom apartment',
      utilization: (adjustedVolume / 700) * 100
    };
  } else if (adjustedVolume <= 1100) {
    return {
      size: '20 ft',
      capacity: 1100,
      description: 'Large moving truck',
      suitable: '2-3 bedroom home',
      utilization: (adjustedVolume / 1100) * 100
    };
  } else {
    return {
      size: '26 ft',
      capacity: 1600,
      description: 'Extra large moving truck',
      suitable: '3-5 bedroom home',
      utilization: (adjustedVolume / 1600) * 100
    };
  }
};

// ---------------------------------------------------------------------------
// Dedicated movers pricing
// ---------------------------------------------------------------------------

export interface DedicatedMoversPricingParams {
  distance: number;
  totalHours: number;
  weight: number;
  volume: number;
  colMultiplier: number;
  totalPackingHours: number;
  professionalMaterialsCost: number;
  furnitureBreakdownTime: number;
  furniturePadsCost: number;
  shrinkWrapCost: number;
  cornerProtectorsCost: number;
  packingServicesRequired: 'none' | 'partial' | 'full';
}

export interface DedicatedMoversPricingResult {
  professionalLow: number;
  professionalHigh: number;
  packingCostLow: number;
  packingCostHigh: number;
  adjustedPackingCostLow: number;
  adjustedPackingCostHigh: number;
  partialPackingMaterials: number;
}

export const calculateDedicatedMoversCost = (params: DedicatedMoversPricingParams): DedicatedMoversPricingResult => {
  const {
    distance,
    totalHours,
    weight,
    volume,
    colMultiplier,
    totalPackingHours,
    professionalMaterialsCost,
    furnitureBreakdownTime,
    furniturePadsCost,
    shrinkWrapCost,
    cornerProtectorsCost,
    packingServicesRequired
  } = params;

  let professionalLow, professionalHigh, packingCostLow, packingCostHigh;

  if (distance < 100) {
    // Local move: hourly rate
    const hourlyRate = 150; // $150/hour for 2-person crew (2024 rates)
    professionalLow = hourlyRate * totalHours * 0.9 * colMultiplier;
    professionalHigh = hourlyRate * totalHours * 1.4 * colMultiplier;

    // Packing service: $50-75/hour per packer + materials (with 110% upcharge)
    packingCostLow = (totalPackingHours * 50) + professionalMaterialsCost;
    packingCostHigh = (totalPackingHours * 75) + professionalMaterialsCost;
  } else {
    // Long distance: More realistic formula based on distance + weight/volume
    // Base rate: $2-3 per pound for cross-country
    const baseCostPerPound = distance > 2000 ? 2.5 : (distance > 1000 ? 1.5 : 1.0);

    // Volume-based alternative (whichever is higher)
    const volumeCostMultiplier = distance > 2000 ? 12 : (distance > 1000 ? 10 : 8);

    const weightBased = weight * baseCostPerPound;
    const volumeBased = volume * volumeCostMultiplier;
    const baseCost = Math.max(weightBased, volumeBased);

    // Add distance-based surcharge for very long moves
    const distanceSurcharge = distance > 2000 ? 1500 : (distance > 1000 ? 800 : 0);

    professionalLow = (baseCost + distanceSurcharge) * 0.85 * colMultiplier;
    professionalHigh = (baseCost + distanceSurcharge) * 1.25 * colMultiplier;

    // Packing for long distance: labor + materials (with 110% upcharge)
    // $60-85/hour per packer for long distance (higher skilled)
    packingCostLow = (totalPackingHours * 60) + professionalMaterialsCost;
    packingCostHigh = (totalPackingHours * 85) + professionalMaterialsCost;
  }

  // Adjust packing costs based on packingServicesRequired toggle
  let adjustedPackingCostLow = 0;
  let adjustedPackingCostHigh = 0;
  let partialPackingMaterials = 0;

  if (packingServicesRequired === 'full') {
    // Full packing: all labor + all materials
    adjustedPackingCostLow = packingCostLow;
    adjustedPackingCostHigh = packingCostHigh;
  } else if (packingServicesRequired === 'partial') {
    // Partial packing: furniture protection only (no box packing labor)
    // Only include furniture protection materials + minimal labor for wrapping
    partialPackingMaterials = (furniturePadsCost + shrinkWrapCost + cornerProtectorsCost) * 1.10;
    const furnitureWrappingHours = furnitureBreakdownTime; // Just furniture wrapping, no box packing

    if (distance < 100) {
      adjustedPackingCostLow = (furnitureWrappingHours * 50) + partialPackingMaterials;
      adjustedPackingCostHigh = (furnitureWrappingHours * 75) + partialPackingMaterials;
    } else {
      adjustedPackingCostLow = (furnitureWrappingHours * 60) + partialPackingMaterials;
      adjustedPackingCostHigh = (furnitureWrappingHours * 85) + partialPackingMaterials;
    }
  }
  // else 'none': packing costs remain 0

  return {
    professionalLow,
    professionalHigh,
    packingCostLow,
    packingCostHigh,
    adjustedPackingCostLow,
    adjustedPackingCostHigh,
    partialPackingMaterials
  };
};

// ---------------------------------------------------------------------------
// Van line pricing
// ---------------------------------------------------------------------------

export interface VanLinePricingParams {
  distance: number;
  weight: number;
  volume: number;
  colMultiplier: number;
  adjustedPackingCostLow: number;
  adjustedPackingCostHigh: number;
  totalDifficultyPremium: number;
  professionalLow: number;
  professionalHigh: number;
  miscCosts: number;
  multiStopPremium: number;
  isFlexible: boolean;
  intermediateStops: number;
}

export interface VanLinePricingResult {
  vanLineTotalLow: number;
  vanLineTotalHigh: number;
  adjustedVanLineLow: number;
  adjustedVanLineHigh: number;
  chargeableWeight: number;
  deliveryWindow: string;
  breakdown: {
    linehaul: number;
    fuelSurcharge: number;
    destinationLabor: number;
    shuttleFee: number;
  };
}

export const calculateVanLineCost = (params: VanLinePricingParams): VanLinePricingResult => {
  const {
    distance,
    weight,
    volume,
    colMultiplier,
    adjustedPackingCostLow,
    adjustedPackingCostHigh,
    totalDifficultyPremium,
    professionalLow,
    professionalHigh,
    miscCosts,
    multiStopPremium,
    isFlexible,
    intermediateStops
  } = params;

  // 1. Chargeable Weight: Greater of actual weight or volumetric weight (7 lbs/cu ft)
  const chargeableWeight = Math.max(weight, volume * 7);

  // 2. Linehaul Rate: Lower tariff for shared load, tiered by distance
  // Rates: >2000mi: $0.75/lb, >1000mi: $0.85/lb, <1000mi: $1.00/lb
  const vanLineRatePerLb = distance > 2000 ? 0.75 : (distance > 1000 ? 0.85 : 1.00);
  const linehaul = chargeableWeight * vanLineRatePerLb;

  // 3. Mandatory Fees
  const fuelSurcharge = linehaul * 0.12; // 12% Fuel Surcharge
  const destinationLabor = chargeableWeight * 0.25; // $0.25/lb for destination services

  // 4. Shuttle / Access Fees for High CoL Areas
  // If CoL multiplier > 1.3 (e.g. SF, NYC), assume shuttle or long carry is needed
  const shuttleFee = colMultiplier > 1.3 ? 750 : 0;

  // 5. Delivery Window Calculation
  const deliveryWindowMin = Math.max(5, Math.ceil(distance / 500) + 2);
  const deliveryWindowMax = Math.max(14, Math.ceil(distance / 300) + 5);
  const deliveryWindow = `${deliveryWindowMin}-${deliveryWindowMax} days`;

  // Total Van Line Cost
  const vanLineBase = linehaul + fuelSurcharge + destinationLabor + shuttleFee;
  // Apply CoL multiplier to the base cost as well to reflect local labor rates
  const vanLineTotalLow = (vanLineBase * colMultiplier) + adjustedPackingCostLow + (totalDifficultyPremium * 1.2);
  const vanLineTotalHigh = (vanLineBase * 1.25 * colMultiplier) + adjustedPackingCostHigh + (totalDifficultyPremium * 1.2);

  // Van line vs dedicated cost guardrail
  // For long-distance, heavy, flexible moves, ensure van lines are cheaper
  let adjustedVanLineLow = vanLineTotalLow;
  let adjustedVanLineHigh = vanLineTotalHigh;

  const shouldVanLinesBeCheaper = distance >= 500 && weight >= 2000 && isFlexible && intermediateStops === 0;

  if (shouldVanLinesBeCheaper) {
    const dedicatedMid = (professionalLow + adjustedPackingCostLow + miscCosts + totalDifficultyPremium + multiStopPremium +
                          professionalHigh + adjustedPackingCostHigh + miscCosts + totalDifficultyPremium + multiStopPremium) / 2;
    const vanMid = (vanLineTotalLow + vanLineTotalHigh) / 2;
    const ratio = vanMid / dedicatedMid;

    // If van lines are more expensive than 95% of dedicated, adjust them down
    if (ratio > 0.95) {
      const adjustmentFactor = 0.95 / ratio;
      adjustedVanLineLow = vanLineTotalLow * adjustmentFactor;
      adjustedVanLineHigh = vanLineTotalHigh * adjustmentFactor;
    }
  }

  return {
    vanLineTotalLow,
    vanLineTotalHigh,
    adjustedVanLineLow,
    adjustedVanLineHigh,
    chargeableWeight,
    deliveryWindow,
    breakdown: {
      linehaul,
      fuelSurcharge,
      destinationLabor,
      shuttleFee
    }
  };
};
