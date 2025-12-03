<script setup lang="ts">
import { ref, computed } from 'vue';

const current = ref(0);
const total = ref(10000);
const isRunning = ref(false);

const percentage = computed(() => {
  if (total.value === 0) return 0;
  return Math.round((current.value / total.value) * 100);
});

const buttonLabel = computed(() => {
  if (!isRunning.value) {
    return 'Upload and take me to my inventory';
  }

  if (percentage.value === 100) {
    return 'Complete!';
  }

  if (percentage.value < 33) {
    return `Creating containers...`;
  } else if (percentage.value < 100) {
    return `Adding items...`;
  }

  return `Uploading...`;
});

// Show percentage instead of loading spinner
const buttonIcon = computed(() => {
  if (isRunning.value && percentage.value < 100) {
    return undefined; // No icon during upload
  }
  return 'arrow_forward';
});

const startProgress = () => {
  if (isRunning.value) return;

  isRunning.value = true;
  current.value = 0;

  const interval = setInterval(() => {
    if (current.value >= total.value) {
      clearInterval(interval);
      isRunning.value = false;
      return;
    }

    // Increment by 100 to make it faster
    current.value += 100;
    if (current.value > total.value) {
      current.value = total.value;
    }
  }, 50); // Update every 50ms for smooth animation
};

const reset = () => {
  current.value = 0;
  isRunning.value = false;
};
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page class="test-page">
        <div class="test-container">
          <h1 class="test-title">Progress Button Animation Test</h1>
          <p class="test-description">
            Testing animated border that fills clockwise as progress increases from 0 to 10,000
          </p>

          <div class="progress-stats">
            <div class="stat">
              <div class="stat-label">Current</div>
              <div class="stat-value">{{ current.toLocaleString() }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Total</div>
              <div class="stat-value">{{ total.toLocaleString() }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Progress</div>
              <div class="stat-value">{{ percentage }}%</div>
            </div>
          </div>

          <div class="button-showcase">
            <q-btn
              class="fab-button fab-pill progress-btn"
              unelevated
              :disable="isRunning"
              :style="{
                '--progress-percentage': `${percentage}%`
              }"
              @click="startProgress"
            >
              <div class="button-content">
                <span class="button-label">{{ buttonLabel }}</span>
                <span v-if="isRunning && percentage < 100" class="button-percentage">{{ percentage }}%</span>
                <q-icon v-else-if="buttonIcon" :name="buttonIcon" size="20px" />
              </div>
            </q-btn>
          </div>

          <div class="controls">
            <q-btn
              label="Reset"
              color="grey-7"
              outline
              @click="reset"
              :disable="isRunning"
            />
          </div>

          <div class="info-card">
            <h3>How it works:</h3>
            <ul>
              <li>Click the button to start counting from 1 to 10,000</li>
              <li>Watch the green border grow clockwise around the button</li>
              <li>Button label updates in real-time showing progress</li>
              <li>Border fills completely at 100%</li>
              <li>Uses conic-gradient for smooth circular animation</li>
            </ul>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.test-page {
  min-height: 100vh;
  background: #f8f9fd;
  padding: 40px 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.test-container {
  max-width: 800px;
  width: 100%;
}

.test-title {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 8px;
  text-align: center;
}

.test-description {
  color: #6b7280;
  text-align: center;
  margin-bottom: 40px;
}

.progress-stats {
  display: flex;
  gap: 24px;
  justify-content: center;
  margin-bottom: 40px;
  padding: 24px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.stat {
  text-align: center;
}

.stat-label {
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  margin-bottom: 8px;
  font-weight: 600;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
}

.button-showcase {
  display: flex;
  justify-content: center;
  padding: 60px 20px;
  background: white;
  border-radius: 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
  margin-bottom: 24px;
}

.controls {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 40px;
}

.info-card {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 16px;
  padding: 24px;
  color: #1e40af;
}

.info-card h3 {
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 1.25rem;
  color: #1e3a8a;
}

.info-card ul {
  margin: 0;
  padding-left: 20px;
}

.info-card li {
  margin-bottom: 8px;
  line-height: 1.6;
}

/* Progress Button Styles */
.fab-button {
  box-shadow: 0 10px 24px rgba(39, 70, 144, 0.28);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  background: linear-gradient(135deg, #274690, #1ca1c1, #7dd3fc);
  background-size: 240% 240%;
  animation: fabShimmer 2.8s ease-in-out infinite;
  position: relative;
  overflow: visible;
}

.fab-pill {
  border-radius: 999px;
  padding: 14px 28px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: white;
  /* Fixed size to prevent layout shift */
  min-width: 400px;
  min-height: 56px;
}

.fab-button :deep(.q-btn__content) {
  gap: 10px;
  font-size: 1rem;
}

/* Custom button content layout */
.button-content {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  width: 100%;
}

.button-label {
  flex: 0 0 auto;
  white-space: nowrap;
}

.button-percentage {
  font-size: 1.1rem;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.2);
  padding: 4px 12px;
  border-radius: 999px;
  min-width: 55px;
  text-align: center;
  backdrop-filter: blur(4px);
}

.fab-button:hover {
  transform: scale(1.05);
  box-shadow: 0 12px 28px rgba(39, 70, 144, 0.32);
}

.fab-button:active {
  transform: scale(0.96);
  box-shadow: 0 8px 18px rgba(39, 70, 144, 0.25);
}

@keyframes fabShimmer {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
    box-shadow: 0 12px 28px rgba(39, 70, 144, 0.34);
  }
  100% {
    background-position: 0% 50%;
  }
}

/* Progress border animation */
.progress-btn {
  --progress-percentage: 0%;
}

.progress-btn::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: inherit;
  background: conic-gradient(
    from 0deg at 50% 50%,
    #10b981 0%,
    #059669 var(--progress-percentage),
    transparent var(--progress-percentage),
    transparent 100%
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box,
               linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  padding: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
  z-index: -1;
}

.progress-btn[style*="--progress-percentage"]:not([style*="--progress-percentage: 0%"])::after {
  opacity: 1;
}
</style>
