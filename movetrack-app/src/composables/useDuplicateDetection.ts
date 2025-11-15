import { computed, ref } from 'vue';

// Levenshtein distance algorithm for string similarity
function levenshteinDistance(str1: string, str2: string): number {
  const track = Array(str2.length + 1).fill(null).map(() =>
    Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i += 1) {
    track[0][i] = i;
  }
  for (let j = 0; j <= str2.length; j += 1) {
    track[j][0] = j;
  }
  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator, // substitution
      );
    }
  }
  return track[str2.length][str1.length];
}

// Calculate similarity percentage between two strings
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  // Normalize strings: lowercase and trim
  const normalized1 = str1.toLowerCase().trim();
  const normalized2 = str2.toLowerCase().trim();

  if (normalized1 === normalized2) return 100;

  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);
  const similarity = ((maxLength - distance) / maxLength) * 100;

  return Math.round(similarity * 10) / 10; // Round to 1 decimal
}

export type DuplicatePair = {
  itemA: any;
  itemB: any;
  similarity: number;
  pairKey: string; // Unique key for this pair
};

const SIMILARITY_THRESHOLD = 70; // Minimum similarity % to flag as potential duplicate
const DISMISSED_PAIRS_KEY = 'movetrack_dismissed_duplicate_pairs';

// Get dismissed pairs from localStorage
function getDismissedPairs(): Set<string> {
  const stored = localStorage.getItem(DISMISSED_PAIRS_KEY);
  if (!stored) return new Set();
  try {
    return new Set(JSON.parse(stored));
  } catch {
    return new Set();
  }
}

// Save dismissed pairs to localStorage
function saveDismissedPairs(pairs: Set<string>): void {
  localStorage.setItem(DISMISSED_PAIRS_KEY, JSON.stringify([...pairs]));
}

// Create a unique key for a pair (order-independent)
function createPairKey(idA: number, idB: number): string {
  const [smaller, larger] = idA < idB ? [idA, idB] : [idB, idA];
  return `${smaller}-${larger}`;
}

export const useDuplicateDetection = (store: {
  items: any[];
  collections: any[];
  containers: any[];
}) => {
  // Make dismissed pairs reactive
  const dismissedPairsSet = ref<Set<string>>(getDismissedPairs());

  const duplicatePairs = computed<DuplicatePair[]>(() => {
    const items = store.items;
    const pairs: DuplicatePair[] = [];
    const dismissedPairs = dismissedPairsSet.value;

    // Compare each item with every other item
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const itemA = items[i];
        const itemB = items[j];

        const pairKey = createPairKey(itemA.value, itemB.value);

        // Skip if this pair has been dismissed
        if (dismissedPairs.has(pairKey)) {
          continue;
        }

        // Calculate name similarity
        const nameSimilarity = calculateSimilarity(
          itemA.label || '',
          itemB.label || ''
        );

        // Boost similarity if in same collection
        let adjustedSimilarity = nameSimilarity;
        if (itemA.collection && itemB.collection && itemA.collection === itemB.collection) {
          adjustedSimilarity += 10; // 10% boost for same collection
        }

        // Check if similarity meets threshold
        if (adjustedSimilarity >= SIMILARITY_THRESHOLD) {
          pairs.push({
            itemA,
            itemB,
            similarity: Math.min(adjustedSimilarity, 100), // Cap at 100%
            pairKey
          });
        }
      }
    }

    // Sort by similarity (highest first)
    return pairs.sort((a, b) => b.similarity - a.similarity);
  });

  const duplicateCount = computed(() => duplicatePairs.value.length);

  const dismissPair = (pairKey: string) => {
    // Create a new Set to trigger reactivity
    const newSet = new Set(dismissedPairsSet.value);
    newSet.add(pairKey);
    dismissedPairsSet.value = newSet;
    saveDismissedPairs(newSet);
  };

  const clearDismissedPairs = () => {
    localStorage.removeItem(DISMISSED_PAIRS_KEY);
    dismissedPairsSet.value = new Set();
  };

  return {
    duplicatePairs,
    duplicateCount,
    dismissPair,
    clearDismissedPairs
  };
};
