<script setup lang="ts">

</script>

<template>
  <div class="content">
    <div class="privacyPolicy">
      <RouterLink :to="'/privacypolicy'">Privacy Policy</RouterLink>
    </div>
    <div class="termsAndConditions">
      <RouterLink :to="'/terms'">Terms and Conditions</RouterLink>
    </div>    
  </div>
</template>

<style scoped>
.content {
  font-size: 12px;
  padding: 10px;
  width: 100%;
}

</style>
