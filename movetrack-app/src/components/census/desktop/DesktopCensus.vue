<script setup lang="ts">
import CensusChat from '../CensusChat.vue';

defineProps<{ user: string }>();
</script>

<template>
  <div class="desktop-census">
    <div class="chat-container">
      <CensusChat :user="user" />
    </div>
  </div>
</template>

<style scoped>
.desktop-census {
  display: flex;
  justify-content: center;
  height: 100vh;
  background: #f0f2f5;
  padding: 24px;
}

.chat-container {
  width: 100%;
  max-width: 720px;
  background: white;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
</style>
