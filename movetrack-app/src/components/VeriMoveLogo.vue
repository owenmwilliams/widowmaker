<template>
  <svg
    :width="width"
    :height="height"
    viewBox="0 0 420 220"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="VeriMove shield logo"
  >
    <title>VeriMove — Shield with Check</title>

    <!-- Shield outline (classic heater shape with top ridge, pointed bottom) -->
    <path
      fill="none"
      :stroke="color"
      stroke-width="10"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M110 20
         C144 20, 168 32, 184 40
         L184 98
         C184 142, 154 170, 110 192
         C66 170, 36 142, 36 98
         L36 40
         C52 32, 76 20, 110 20 Z" />

    <!-- Centered check, slightly forward/right -->
    <path
      fill="none"
      :stroke="checkColor"
      stroke-width="10"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M70 112 L96 138 L148 86" />

    <!-- VERIMOVE Text -->
    <text
      x="240"
      y="120"
      font-family="Manrope, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Liberation Sans, sans-serif"
      font-size="48"
      font-weight="700"
      :fill="color"
    >
      VERIMOVE
    </text>
  </svg>
</template>

<script setup lang="ts">
defineProps({
  width: {
    type: [String, Number],
    default: 120
  },
  height: {
    type: [String, Number],
    default: 32
  },
  color: {
    type: String,
    default: '#274690' // VeriMove blue
  },
  checkColor: {
    type: String,
    default: '#1CA1C1' // Sky blue for check
  }
});
</script>
