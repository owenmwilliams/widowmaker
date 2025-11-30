<template>
  <img
    class="movetrack-logo"
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
    default: 'MoveTrack logo'
  },
  logoSrc: {
    type: String,
    default: 'https://storage.googleapis.com/widowmaker-site-images/movetrack-logo-_app-bar_.png'
  }
});
</script>

<style scoped>
.movetrack-logo {
  display: inline-block;
  max-width: 100%;
  border: 0;
  object-fit: contain;
  padding: 0;
  margin: 0;
}
</style>
