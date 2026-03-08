<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';

type Variant = 'card' | 'inline';

type ValueType = string | number;

type IconConfig = {
  name: string;
  color?: string;
  size?: string;
};

const props = defineProps({
  value: {
    type: [String, Number] as PropType<ValueType>,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  caption: {
    type: String,
    default: ''
  },
  subcaption: {
    type: String,
    default: ''
  },
  valuePrefix: {
    type: String,
    default: ''
  },
  valueSuffix: {
    type: String,
    default: ''
  },
  icon: {
    type: Object as PropType<IconConfig | null>,
    default: null
  },
  variant: {
    type: String as PropType<Variant>,
    default: 'card'
  }
});

const displayValue = computed(() => `${props.valuePrefix}${props.value}${props.valueSuffix}`);
const iconSize = computed(() => props.icon?.size ?? 'md');
const iconColor = computed(() => props.icon?.color ?? 'primary');
</script>

<template>
  <q-card v-if="variant === 'card'" flat bordered class="big-number-card">
    <q-card-section>
      <div class="row items-center q-mb-sm">
        <q-icon v-if="icon" :name="icon.name" :size="iconSize" :color="iconColor" />
        <span
          class="text-h6 text-primary"
          :class="{ 'q-ml-sm': icon }"
        >
          {{ displayValue }}
        </span>
      </div>
      <div class="text-subtitle2 text-grey-8">{{ title }}</div>
      <div v-if="caption" class="text-caption text-grey-6">{{ caption }}</div>
      <div v-if="subcaption" class="text-caption text-grey-5">{{ subcaption }}</div>
    </q-card-section>
  </q-card>

  <div v-else class="big-number-inline">
    <q-icon v-if="icon" :name="icon.name" size="sm" :color="iconColor" />
    <div :class="{ 'q-ml-sm': icon }">
      <div class="text-body1 text-weight-medium">{{ displayValue }}</div>
      <div class="text-caption text-grey-6">{{ title }}</div>
      <div v-if="caption" class="text-caption text-grey-5">{{ caption }}</div>
      <div v-if="subcaption" class="text-caption text-grey-5">{{ subcaption }}</div>
    </div>
  </div>
</template>

<style scoped>
.big-number-card {
  background: white;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.big-number-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.big-number-inline {
  display: flex;
  align-items: flex-start;
  padding: 8px;
}
</style>
