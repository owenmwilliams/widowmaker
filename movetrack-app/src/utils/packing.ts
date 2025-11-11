/**
 * Lightweight packing helpers.
 *
 * While optimal 3D bin packing is NP-hard, in practice heuristics like
 * First Fit Decreasing (FFD) with a shelf or layer strategy perform well
 * for moving/packing scenarios. Here we provide a simple feasibility check
 * that compares aggregate weight/volume and the single largest dimension
 * against a container's constraints. This can be extended with a proper
 * FFD implementation later.
 */

export interface PackingDimensions {
  length: number;
  width: number;
  height: number;
}

export interface PackingItem {
  id: number;
  weight: number;
  dimensions?: PackingDimensions | null;
}

export interface PackingContainer {
  maxWeight?: number | null;
  maxVolume?: number | null;
  innerDimensions?: PackingDimensions;
}

export interface PackingAssessment {
  weightOk: boolean;
  volumeOk: boolean;
  maxDimensionOk: boolean;
  blockingReason?: string;
}

export function evaluatePackingFit(
  items: PackingItem[],
  container: PackingContainer
): PackingAssessment {
  const totalWeight = items.reduce((sum, item) => sum + (item.weight || 0), 0);
  const totalVolume =
    items.reduce((sum, item) => {
      if (!item.dimensions) return sum;
      return sum + item.dimensions.length * item.dimensions.width * item.dimensions.height;
    }, 0) / 1728;

  const hasWeightLimit = typeof container.maxWeight === 'number' && !Number.isNaN(container.maxWeight);
  const hasVolumeLimit = typeof container.maxVolume === 'number' && !Number.isNaN(container.maxVolume);

  const weightOk =
    !hasWeightLimit || totalWeight <= (container.maxWeight as number) + 0.01;
  const volumeOk =
    !hasVolumeLimit || totalVolume <= (container.maxVolume as number) + 0.01;

  let maxDimensionOk = true;
  if (container.innerDimensions) {
    const sortedContainerDims = [
      container.innerDimensions.length,
      container.innerDimensions.width,
      container.innerDimensions.height
    ].sort((a, b) => b - a);

    for (const item of items) {
      if (!item.dimensions) continue;
      const sortedItemDims = [
        item.dimensions.length,
        item.dimensions.width,
        item.dimensions.height
      ].sort((a, b) => b - a);
      for (let i = 0; i < 3; i++) {
        if (sortedItemDims[i] > sortedContainerDims[i]) {
          maxDimensionOk = false;
          break;
        }
      }
      if (!maxDimensionOk) break;
    }
  }

  let blockingReason: string | undefined;
  if (hasWeightLimit && !weightOk) blockingReason = 'Weight limit exceeded';
  else if (hasVolumeLimit && !volumeOk) blockingReason = 'Volume limit exceeded';
  else if (container.innerDimensions && !maxDimensionOk) {
    blockingReason = 'Item dimensions exceed box dimensions';
  }

  return {
    weightOk,
    volumeOk,
    maxDimensionOk,
    blockingReason
  };
}
