<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';

type TrendPoint = {
  label: string;
  value: number;
  key?: string;
};

const props = defineProps({
  data: {
    type: Array as PropType<TrendPoint[]>,
    required: true
  },
  minBarHeight: {
    type: Number,
    default: 12
  },
  zeroBarHeight: {
    type: Number,
    default: 6
  }
});

const maxValue = computed(() => {
  const values = props.data.map(point => point.value);
  return Math.max(...values, 1);
});

const normalized = computed(() => {
  return props.data.map((point, index) => {
    const height = point.value === 0
      ? props.zeroBarHeight
      : Math.max((point.value / maxValue.value) * 100, props.minBarHeight);

    return {
      ...point,
      key: point.key ?? `${point.label}-${index}`,
      height: Math.min(100, height)
    };
  });
});
</script>

<template>
  <div class="trend-chart">
    <div
      v-for="point in normalized"
      :key="point.key"
      class="trend-bar"
      :class="{ 'trend-bar--active': point.value > 0 }"
    >
      <div class="trend-bar-track">
        <div
          class="trend-bar-fill"
          :style="{ height: `${point.height}%` }"
        >
          <span v-if="point.value" class="trend-bar-count">{{ point.value }}</span>
        </div>
      </div>
      <div class="trend-bar-label">{{ point.label }}</div>
    </div>
  </div>
</template>

<style scoped>
.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  min-height: 220px;
  padding-top: 12px;
  flex: 1;
  margin-top: 8px;
}

.trend-bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  min-width: 32px;
}

.trend-bar-track {
  width: 100%;
  height: 200px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(39,70,144,0.08), rgba(39,70,144,0.02));
  border: 1px solid rgba(39, 70, 144, 0.08);
  padding: 4px;
  display: flex;
  align-items: flex-end;
}

.trend-bar-fill {
  width: 100%;
  border-radius: 8px;
  background: #e0e0e0;
  position: relative;
  transition: height 0.2s ease;
}

.trend-bar--active .trend-bar-fill {
  background: linear-gradient(180deg, #1CA1C1, #274690);
}

.trend-bar-count {
  position: absolute;
  top: -22px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #274690);
}

.trend-bar-label {
  margin-top: 8px;
  font-size: 12px;
  color: #666;
}
</style>
