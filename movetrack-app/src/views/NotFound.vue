<script setup lang="ts">
import router from '../router';
</script>

<template>
    <div stacked class="window-height window-width column justify-center items-center">
        <q-img src="https://storage.googleapis.com/take-stock-design-assets/Logos/404_1.png" style="width: 25vw;" />
        <h3 class="my_font_class q-pa-none text-primary">PAGE NOT FOUND</h3>
        <q-btn flat no-caps class="text-weight-thin" label="go home" @click="router.push({name: 'home'})" />
    </div>
    
</template>

<style scoped>
.my_font_class {
    font-family: 'Exo 2';
    font-weight: 800;
}
</style>