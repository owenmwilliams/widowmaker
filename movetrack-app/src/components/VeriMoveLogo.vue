<template>
  <img
    class="verimove-logo"
    :src="logoSrc"
    :alt="alt"
    :width="width"
    :height="height"
    loading="lazy"
    decoding="async"
  />
</template>

<script setup lang="ts">
defineProps({
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
    default: 'VeriMove logo'
  },
  logoSrc: {
    type: String,
    default: 'https://storage.googleapis.com/widowmaker-site-images/verimove_logo.png?v=2'
  }
});
</script>

<style scoped>
.verimove-logo {
  display: inline-block;
  max-width: 100%;
  border: 0;
  object-fit: contain;
  padding: 0;
  margin: 0;
}
</style>
