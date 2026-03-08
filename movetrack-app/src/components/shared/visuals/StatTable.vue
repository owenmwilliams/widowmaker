<script setup lang="ts">
import type { PropType } from 'vue';

type Header = {
  label: string;
  align?: 'left' | 'right' | 'center';
};

const props = defineProps({
  headers: {
    type: Array as PropType<ReadonlyArray<Header>>,
    required: true
  },
  rows: {
    type: Array as PropType<any[]>,
    required: true
  },
  rowKey: {
    type: [String, Function] as PropType<string | ((row: any, index: number) => string | number)>,
    default: ''
  }
});

const getRowKey = (row: any, index: number) => {
  if (typeof props.rowKey === 'function') return props.rowKey(row, index);
  if (typeof props.rowKey === 'string' && props.rowKey) return row?.[props.rowKey] ?? index;
  return index;
};

const alignClass = (align?: Header['align']) => {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
};
</script>

<template>
  <q-markup-table dense flat class="stat-table">
    <thead>
      <tr>
        <th
          v-for="(header, index) in headers"
          :key="`${header.label}-${index}`"
          :class="alignClass(header.align)"
        >
          {{ header.label }}
        </th>
      </tr>
    </thead>
    <tbody>
      <template v-if="$slots.row">
        <slot
          name="row"
          v-for="(row, index) in rows"
          :key="getRowKey(row, index)"
          :row="row"
          :index="index"
        />
      </template>
      <tr v-else v-for="(row, index) in rows" :key="getRowKey(row, index)">
        <td v-for="(value, colIndex) in row" :key="colIndex">
          {{ value }}
        </td>
      </tr>
    </tbody>
  </q-markup-table>
</template>

<style scoped>
.stat-table th,
.stat-table td {
  padding-top: 8px;
  padding-bottom: 8px;
}
</style>
