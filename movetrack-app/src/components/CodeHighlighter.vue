<template>
    <pre><code ref="codeBlock" class="language-solidity">{{ codeText }}</code></pre>
  </template>
  
  <script setup lang="ts">
  import { ref, onMounted, watch } from 'vue';
  import Prism from 'prismjs';
  import 'prismjs/components/prism-solidity';
  // import loadLanguages from 'prismjs/components/';
  
  import "prismjs/themes/prism-tomorrow.css"; // You can choose other themes
  
  // loadLanguages(['javascript', 'css', 'markup', 'sol', 'solidity'])

  // Prop
  const props = defineProps<{
    codeText: string;
  }>();
  
  const codeBlock = ref<HTMLElement | null>(null);
  
  onMounted(() => {
    if (codeBlock.value) {
      Prism.highlightElement(codeBlock.value);
    }
  });
  
  watch(() => props.codeText, () => {
    if (codeBlock.value) {
      Prism.highlightElement(codeBlock.value);
    }
  });
  </script>
  
  <style scoped>
  pre {
    background-color: #282c34; /* Dark background for the code block */
    color: #abb2bf; /* Light text color */
    padding: 16px;
    overflow-x: auto;
  }
  </style>
  