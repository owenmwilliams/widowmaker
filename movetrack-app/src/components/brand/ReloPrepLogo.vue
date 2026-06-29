<template>
  <img
    class="reloprep-logo"
    :src="resolvedSrc"
    :alt="alt"
    :width="width"
    :height="height"
    loading="lazy"
    decoding="async"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';

const WHITE_LOGO = 'https://storage.googleapis.com/widowmaker-site-images/wordlogo_white.png';
const DARK_LOGO = 'https://storage.googleapis.com/widowmaker-site-images/wordlogo_dark.png';

const props = defineProps({
  width: {
    type: [String, Number],
    default: 160
  },
  height: {
    type: [String, Number],
    default: 40
  },
  alt: {
    type: String,
    default: 'Nexus Moves logo'
  },
  logoSrc: {
    type: String,
    default: ''
  }
});

const $q = useQuasar();

const resolvedSrc = computed(() => {
  if (props.logoSrc) return props.logoSrc;
  return $q.dark.isActive ? WHITE_LOGO : DARK_LOGO;
});
</script>

<style scoped>
.reloprep-logo {
  display: block;
  max-width: 100%;
  border: 0;
  object-fit: contain;
  padding: 0;
  margin: 0;
  vertical-align: middle;
}
</style>
