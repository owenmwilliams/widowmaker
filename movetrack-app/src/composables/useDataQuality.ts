import { computed } from 'vue';

export const weightIsTracked = (value: any) => {
  const weight = Number(value);
  return Number.isFinite(weight) && weight > 0;
};

export const dataQualityDefinitions = [
  {
    key: 'picture',
    label: 'Missing Photos',
    description: 'Items without any pictures',
    color: 'secondary',
    predicate: (item: any) => !item.picture_url
  },
  {
    key: 'weight',
    label: 'Missing Weight',
    description: 'Items without recorded weight',
    color: 'info',
    predicate: (item: any) => !weightIsTracked(item.weight_lbs)
  },
  {
    key: 'dimensions',
    label: 'Missing Dimensions',
    description: 'Items without length, width, and height',
    color: 'accent',
    predicate: (item: any) => {
      return !(item.length_in && item.width_in && item.height_in);
    }
  },
  {
    key: 'container',
    label: 'Unpacked Items',
    description: 'Items not assigned to a container (excludes loose items like furniture)',
    color: 'primary',
    predicate: (item: any) => {
      // Exclude items tagged as "loose" (furniture, large appliances, etc.)
      const isLoose = Array.isArray(item.tags) && item.tags.some((tag: string) =>
        tag.toLowerCase() === 'loose'
      );
      return !item.container && !isLoose;
    }
  }
] as const;

type ReviewIssue = {
  key: typeof dataQualityDefinitions[number]['key'];
  label: typeof dataQualityDefinitions[number]['label'];
  color: typeof dataQualityDefinitions[number]['color'];
};

export type ReviewQueueItem = {
  id: number;
  name: string;
  collection: string;
  container: string;
  issues: ReviewIssue[];
  missingCount: number;
};

const buildIssuesForItem = (item: any): ReviewIssue[] =>
  dataQualityDefinitions
    .filter(def => def.predicate(item))
    .map(def => ({ key: def.key, label: def.label, color: def.color }));

export const useDataQuality = (store: {
  items: any[];
  collections: any[];
  containers: any[];
}) => {
  const totalItems = computed(() => store.items.length);

  const missingAttributeSummary = computed(() => {
    return dataQualityDefinitions
      .map(def => {
        const missing = store.items.filter(def.predicate).length;
        const pct = totalItems.value > 0 ? (missing / totalItems.value) * 100 : 0;

        // Color logic: >85% red, 50-85% yellow, <50% green
        let color: string;
        if (pct > 85) {
          color = 'negative';
        } else if (pct >= 50) {
          color = 'warning';
        } else {
          color = 'positive';
        }

        return {
          ...def,
          missing,
          total: totalItems.value,
          pct,
          color // Override the default color with dynamic color
        };
      })
      .sort((a, b) => b.missing - a.missing);
  });

  const bulkReviewQueueDetailed = computed<ReviewQueueItem[]>(() => {
    return store.items
      .map(item => {
        const issues = buildIssuesForItem(item);
        if (issues.length === 0) return null;
        const collection =
          store.collections.find(c => c.value === item.collection)?.label ||
          'Unassigned';
        const container =
          store.containers.find(c => c.value === item.container)?.label ||
          'No container';
        return {
          id: item.value,
          name: item.label || 'Untitled Item',
          collection,
          container,
          issues,
          missingCount: issues.length
        };
      })
      .filter((item): item is ReviewQueueItem => item !== null)
      .sort(
        (a, b) =>
          b.missingCount - a.missingCount || a.name.localeCompare(b.name)
      );
  });

  return {
    missingAttributeSummary,
    bulkReviewQueueDetailed
  };
};
