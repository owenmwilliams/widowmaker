<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

const goHome = () => {
  router.push({ name: 'home' });
};

const goBack = () => {
  router.back();
};
</script>

<template>
  <div class="not-found-page">
    <div class="content-wrapper">
      <q-img
        src="https://storage.googleapis.com/take-stock-design-assets/Logos/404_1.png"
        class="not-found-image"
        fit="contain"
      />

      <div class="text-h3 text-primary q-mt-md text-weight-bold brand-font">
        Page Not Found
      </div>

      <div class="text-body1 text-grey-7 q-mt-sm q-mb-lg">
        The page you're looking for doesn't exist or has been moved.
      </div>

      <div class="button-group">
        <q-btn
          unelevated
          color="primary"
          label="Go Home"
          icon="home"
          @click="goHome"
          class="action-btn"
        />
        <q-btn
          outline
          color="primary"
          label="Go Back"
          icon="arrow_back"
          @click="goBack"
          class="action-btn"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%);
}

.content-wrapper {
  text-align: center;
  max-width: 500px;
}

.not-found-image {
  width: 100%;
  max-width: 300px;
  margin: 0 auto;
}

.brand-font {
  font-family: 'Exo 2', sans-serif;
}

.button-group {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}

.action-btn {
  min-width: 140px;
}

@media (max-width: 600px) {
  .not-found-image {
    max-width: 200px;
  }

  .text-h3 {
    font-size: 1.75rem;
  }

  .button-group {
    flex-direction: column;
    width: 100%;
  }

  .action-btn {
    width: 100%;
  }
}
</style>
